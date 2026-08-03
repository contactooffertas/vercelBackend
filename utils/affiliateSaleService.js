// utils/affiliateSaleService.js

const AffiliateOfferApplication = require('../models/AffiliateOfferApplication');
const AffiliateSellerApplication = require('../models/AffiliateSellerApplication');
const AffiliateSale = require('../models/AffiliateSale');

/**
 * @param {import('mongoose').Document} order - documento Order YA guardado
 *        con status "delivered" (se llama después de order.save()).
 */
async function registerAffiliateSaleForOrder(order) {
  try {
    if (!order.affiliateCode) return;
    if (order.affiliateSaleProcessed) return;

    const application = await AffiliateOfferApplication.findOne({
      affiliateCode: order.affiliateCode,
      status: 'accepted',
    }).populate('offer');

    if (!application || !application.offer) return;

    const offerProductId = String(application.offer.product);
    const matchingItems = order.items.filter(
      (item) => item.product && String(item.product) === offerProductId
    );

    if (matchingItems.length === 0) {
      // El link de afiliado no correspondía a ningún producto de esta
      // orden puntual (ej. el comprador cambió el carrito). Igual marcamos
      // la orden como procesada para no reintentar en vano.
      order.affiliateSaleProcessed = true;
      await order.save();
      return;
    }

    const sellerProfile = await AffiliateSellerApplication.findOne({
      user: application.seller,
    }).lean();
    const paymentTermDays = sellerProfile?.paymentTermDays === 15 ? 15 : 30;
    const termMs = paymentTermDays * 24 * 60 * 60 * 1000;

    const baseDate = order.date ? new Date(order.date) : new Date();

    let salesCreated = 0;
    for (const item of matchingItems) {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.price) || 0;
      if (quantity <= 0) continue;

      const commissionAmount =
        Math.round(((quantity * unitPrice * application.commissionPercentage) / 100) * 100) / 100;

      await AffiliateSale.create({
        application: application._id,
        offer: application.offer._id,
        seller: application.seller,
        affiliate: application.buyer,
        productName: item.name || 'Producto',
        quantity,
        unitPrice,
        commissionPercentage: application.commissionPercentage,
        commissionAmount,
        date: baseDate,
        dueDate: new Date(baseDate.getTime() + termMs),
      });
      salesCreated += 1;
    }

    if (salesCreated > 0) {
      application.salesCount = (application.salesCount || 0) + salesCreated;
      await application.save();
    }

    order.affiliateSaleProcessed = true;
    await order.save();
  } catch (err) {
    // No queremos que un error acá tumbe la confirmación de entrega del
    // comprador; solo lo logueamos para poder revisar manualmente.
    console.error('[affiliateSaleService.registerAffiliateSaleForOrder]', err);
  }
}

module.exports = { registerAffiliateSaleForOrder };
