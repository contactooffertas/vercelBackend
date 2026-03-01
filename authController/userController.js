// authController/userController.js
const User     = require('../models/userModel');
const Product  = require('../models/productoModel');
const Business = require('../models/businessModel');
const cloudinary = require('../config/cloudinary');
const bcrypt   = require('bcryptjs');
const fs       = require('fs');

/* GET PROFILE + STATS */
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -verificationCode');
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    let productCount = 0;
    if (user.role === 'seller') {
      const business = await Business.findOne({ owner: req.user.id });
      if (business) {
        productCount = await Product.countDocuments({ businessId: business._id });
      }
    }

    res.json({
      ...user.toObject(),
      stats: {
        purchases:  user.purchases || 0,
        favorites:  user.favorites?.length || 0,
        products:   productCount,
      },
    });
  } catch (error) {
    console.error('getProfile error:', error);
    res.status(500).json({ message: 'Error obteniendo perfil' });
  }
};

/* UPDATE NOMBRE / EMAIL */
exports.updateProfile = async (req, res) => {
  try {
    const { name, email } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { name, email },
      { new: true }
    ).select('-password -verificationCode');
    res.json({ message: 'Perfil actualizado', user });
  } catch (error) {
    res.status(500).json({ message: 'Error actualizando perfil' });
  }
};

/* CHANGE PASSWORD */
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: 'Todos los campos son requeridos' });
    if (newPassword.length < 6)
      return res.status(400).json({ message: 'Mínimo 6 caracteres' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(400).json({ message: 'La contraseña actual es incorrecta' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    res.status(500).json({ message: 'Error cambiando contraseña' });
  }
};

/* UPDATE AVATAR */
exports.updateAvatar = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No se recibió ninguna imagen' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    if (user.avatarPublicId) {
      await cloudinary.uploader.destroy(user.avatarPublicId);
    }

    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'users/avatars',
      transformation: [{ width: 300, height: 300, crop: 'fill', gravity: 'face' }],
    });

    fs.unlinkSync(req.file.path);

    user.avatar         = result.secure_url;
    user.avatarPublicId = result.public_id;
    await user.save();

    res.json({ message: 'Avatar actualizado', avatar: result.secure_url });
  } catch (error) {
    console.error('updateAvatar error:', error);
    res.status(500).json({ message: 'Error subiendo avatar' });
  }
};

/* ── GUARDAR UBICACIÓN (comprador y vendedor) ─────────────────────────────────
   PUT /api/user/location
   body: { lat, lng }
   Sirve para que cualquier usuario (no solo sellers) guarde su posición y
   aparezca en los resultados de búsqueda por cercanía.
*/
exports.saveLocation = async (req, res) => {
  try {
    const lat = parseFloat(req.body.lat);
    const lng = parseFloat(req.body.lng);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ message: 'Coordenadas inválidas' });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: 'Coordenadas fuera de rango' });
    }

    await User.findByIdAndUpdate(req.user.id, {
      lat,
      lng,
      locationEnabled: true,
    });

    res.json({ ok: true, lat, lng });
  } catch (error) {
    console.error('saveLocation error:', error);
    res.status(500).json({ message: 'Error guardando ubicación' });
  }
};

/* ── DESACTIVAR UBICACIÓN ─────────────────────────────────────────────────────
   DELETE /api/user/location
*/
exports.removeLocation = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, {
      lat:             null,
      lng:             null,
      locationEnabled: false,
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: 'Error eliminando ubicación' });
  }
};