const SearchKeyword = require("../models/searchKeywordModel");
const ForbiddenTerm = require("../models/forbiddenTermModel");
const Category = require("../models/categoryModel");
const Business = require("../models/businessModel");
const Product = require("../models/productoModel");
const {
  normalizeText,
  ensureCategories,
  ensureSearchSeeds,
  getSuggestions,
  resolveIntent,
  seedForCategory,
} = require("../utils/searchService");

function slugify(value) {
  return normalizeText(value).replace(/\s+/g, "-").replace(/-+/g, "-");
}

exports.publicCategories = async (_req, res) => {
  try {
    await ensureCategories();
    const categories = await Category.find({ active: true }).sort({ order: 1, name: 1 }).lean();
    res.json({ categories });
  } catch (error) {
    res.status(500).json({ message: "No se pudieron cargar las categorías" });
  }
};

exports.suggest = async (req, res) => {
  try {
    const q = String(req.query.q || "");
    const limit = Math.min(12, Math.max(1, Number(req.query.limit || 8)));
    const suggestions = await getSuggestions(q, limit);
    res.json({
      suggestions: suggestions.map(s => ({
        text: s.keyword,
        category: s.category,
        source: s.source,
      })),
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudieron cargar sugerencias" });
  }
};

exports.resolve = async (req, res) => {
  try {
    const q = String(req.query.q || "");
    const intent = await resolveIntent(q);
    res.json(intent);
  } catch (error) {
    res.status(500).json({ message: "No se pudo interpretar la búsqueda" });
  }
};

exports.smartSearch = async (req, res) => {
  try {
    await ensureSearchSeeds();
    const q = String(req.query.q || "");
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radius = Number(req.query.radius || 10000);
    const limit = Math.min(60, Math.max(1, Number(req.query.limit || 30)));
    const intent = await resolveIntent(q);

    const regexParts = intent.terms.map(t => t.replace(/[.*+?^$()|[\]\\]/g, "\\$&")).filter(Boolean);
    const termRegex = regexParts.length ? new RegExp(regexParts.join("|"), "i") : null;

    const productQuery = { blocked: { $ne: true } };
    if (termRegex || intent.categories.length) {
      productQuery.$or = [];
      if (termRegex) {
        productQuery.$or.push({ name: termRegex }, { description: termRegex });
      }
      if (intent.categories.length) {
        productQuery.$or.push({ category: { $in: intent.categories } });
      }
    }

    const products = await Product.find(productQuery)
      .limit(limit)
      .populate("businessId", "name city logo verified rating totalRatings categories location blocked")
      .lean();

    const productBusinessIds = [...new Set(products.map(p => p.businessId?._id?.toString()).filter(Boolean))];
    let businesses = [];

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const geoQuery = { blocked: { $ne: true } };
      if (intent.categories.length) {
        geoQuery.$or = [
          { categories: { $in: intent.categories } },
          { _id: { $in: productBusinessIds } },
        ];
      } else if (productBusinessIds.length) {
        geoQuery._id = { $in: productBusinessIds };
      }
      businesses = await Business.aggregate([
        {
          $geoNear: {
            near: { type: "Point", coordinates: [lng, lat] },
            distanceField: "distanceMeters",
            maxDistance: radius > 0 ? radius : 999999999,
            spherical: true,
            query: geoQuery,
          },
        },
        { $limit: 30 },
        {
          $project: {
            name: 1, description: 1, city: 1, logo: 1, rating: 1,
            totalRatings: 1, verified: 1, categories: 1, address: 1,
            phone: 1, followers: 1, distanceMeters: 1, location: 1,
          },
        },
      ]);
    } else {
      const bizQuery = { blocked: { $ne: true } };
      if (intent.categories.length) {
        bizQuery.$or = [
          { categories: { $in: intent.categories } },
          { _id: { $in: productBusinessIds } },
        ];
      } else if (productBusinessIds.length) {
        bizQuery._id = { $in: productBusinessIds };
      }
      businesses = await Business.find(bizQuery)
        .limit(30)
        .select("name description city logo rating totalRatings verified categories address phone followers location")
        .lean();
    }

    const mappedBusinesses = businesses.map(b => ({
      ...b,
      distanceLabel: typeof b.distanceMeters === "number"
        ? (b.distanceMeters < 1000 ? Math.round(b.distanceMeters) + " m" : (b.distanceMeters / 1000).toFixed(1) + " km")
        : undefined,
    }));

    const mappedProducts = products
      .filter((product) => !product.businessId?.blocked)
      .map((product) => ({
        ...product,
        business: product.businessId
          ? {
              _id: product.businessId._id,
              name: product.businessId.name,
              city: product.businessId.city,
              logo: product.businessId.logo,
              verified: product.businessId.verified,
              rating: product.businessId.rating,
              totalRatings: product.businessId.totalRatings,
              categories: product.businessId.categories,
              location: product.businessId.location,
            }
          : null,
      }));

    res.json({
      query: q,
      intent,
      products: mappedProducts,
      businesses: mappedBusinesses,
    });
  } catch (error) {
    console.error("smartSearch:", error);
    res.status(500).json({ message: "No pudimos completar la búsqueda" });
  }
};

// ADMIN
exports.adminGetDictionary = async (_req, res) => {
  try {
    await ensureSearchSeeds();
    const [categories, keywords, forbidden] = await Promise.all([
      Category.find().sort({ order: 1, name: 1 }).lean(),
      SearchKeyword.find().sort({ category: 1, keyword: 1 }).lean(),
      ForbiddenTerm.find().sort({ term: 1 }).lean(),
    ]);
    res.json({ categories, keywords, forbidden });
  } catch (error) {
    res.status(500).json({ message: "Error cargando diccionario" });
  }
};

exports.adminCreateKeyword = async (req, res) => {
  try {
    const keyword = String(req.body.keyword || "").trim();
    const category = String(req.body.category || "").trim();
    if (!keyword || !category) return res.status(400).json({ message: "Palabra y categoría son obligatorias" });
    const normalized = normalizeText(keyword);
    const item = await SearchKeyword.findOneAndUpdate(
      { normalized, category },
      { $set: { keyword, normalized, category, source: "admin", active: true }, $inc: { usageCount: 1 } },
      { upsert: true, new: true }
    );
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: "Error guardando palabra clave" });
  }
};

exports.adminUpdateKeyword = async (req, res) => {
  try {
    const keyword = String(req.body.keyword || "").trim();
    const category = String(req.body.category || "").trim();
    const active = req.body.active !== false;
    const item = await SearchKeyword.findByIdAndUpdate(
      req.params.id,
      { keyword, normalized: normalizeText(keyword), category, active, source: "admin" },
      { new: true }
    );
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: "Error actualizando palabra clave" });
  }
};

exports.adminDeleteKeyword = async (req, res) => {
  await SearchKeyword.findByIdAndDelete(req.params.id).catch(()=>{});
  res.json({ ok: true });
};

exports.adminCreateForbidden = async (req, res) => {
  try {
    const term = String(req.body.term || "").trim();
    const exceptions = Array.isArray(req.body.exceptions) ? req.body.exceptions.map(v => normalizeText(v)).filter(Boolean) : [];
    if (!term) return res.status(400).json({ message: "Ingresá una palabra prohibida" });
    const normalized = normalizeText(term);
    const item = await ForbiddenTerm.findOneAndUpdate(
      { normalized },
      { $set: { term, normalized, exceptions, active: true, source: "admin" } },
      { upsert: true, new: true }
    );
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: "Error guardando palabra prohibida" });
  }
};

exports.adminUpdateForbidden = async (req, res) => {
  try {
    const term = String(req.body.term || "").trim();
    const exceptions = Array.isArray(req.body.exceptions) ? req.body.exceptions.map(v => normalizeText(v)).filter(Boolean) : [];
    const item = await ForbiddenTerm.findByIdAndUpdate(
      req.params.id,
      { term, normalized: normalizeText(term), exceptions, active: req.body.active !== false, source: "admin" },
      { new: true }
    );
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: "Error actualizando palabra prohibida" });
  }
};

exports.adminDeleteForbidden = async (req, res) => {
  await ForbiddenTerm.findByIdAndDelete(req.params.id).catch(()=>{});
  res.json({ ok: true });
};

exports.adminCreateCategory = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const slug = slugify(req.body.slug || name);
    const iconName = String(req.body.iconName || "Tag").trim();
    if (!name || !slug) return res.status(400).json({ message: "Nombre de categoría requerido" });

    const category = await Category.findOneAndUpdate(
      { slug },
      { $set: { name, slug, iconName, active: true, order: Number(req.body.order || 0) } },
      { upsert: true, new: true }
    );

    const seedWords = Array.isArray(req.body.keywords) ? req.body.keywords : seedForCategory(slug);
    for (const word of seedWords.slice(0,100)) {
      const normalized = normalizeText(word);
      if (!normalized) continue;
      await SearchKeyword.updateOne(
        { normalized, category: slug },
        { $setOnInsert: { keyword: word, normalized, category: slug, source: "admin", active: true, usageCount: 1 } },
        { upsert: true }
      ).catch(()=>{});
    }
    res.json(category);
  } catch (error) {
    res.status(500).json({ message: "Error creando categoría" });
  }
};

exports.adminUpdateCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: "Categoría no encontrada" });
    const oldSlug = category.slug;
    const newSlug = slugify(req.body.slug || category.slug);
    category.name = String(req.body.name || category.name).trim();
    category.slug = newSlug;
    category.iconName = String(req.body.iconName || category.iconName || "Tag").trim();
    category.active = req.body.active !== false;
    if (req.body.order !== undefined) category.order = Number(req.body.order);
    await category.save();

    if (oldSlug !== newSlug) {
      await SearchKeyword.updateMany({ category: oldSlug }, { $set: { category: newSlug } });
      await Product.updateMany({ category: oldSlug }, { $set: { category: newSlug } });
      await Business.updateMany({ categories: oldSlug }, { $set: { "categories.$[elem]": newSlug } }, { arrayFilters: [{ elem: oldSlug }] }).catch(()=>{});
    }
    res.json(category);
  } catch (error) {
    res.status(500).json({ message: "Error actualizando categoría" });
  }
};

exports.adminDeleteCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: "Categoría no encontrada" });
    category.active = false;
    await category.save();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: "Error desactivando categoría" });
  }
};
