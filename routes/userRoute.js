// routes/userRoute.js
const express    = require('express');
const router     = express.Router();
const auth       = require('../middleware/authMiddleware');
const upload     = require('../middleware/upload');
const userController = require('../authController/userController');
const User       = require('../models/userModel');
const { formatFavoriteBusinesses } = require('../utils/favoriteBusinesses');

router.get('/profile',          auth,                          userController.getProfile);
router.put('/update',           auth,                          userController.updateProfile);
router.put('/change-password',  auth,                          userController.changePassword);
router.post('/avatar',          auth, upload.single('avatar'), userController.updateAvatar);
router.delete('/avatar',        auth,                          userController.deleteAvatar);

// ── Ubicación (comprador y vendedor) ─────────────────────────────────────────
router.put('/location',    auth, userController.saveLocation);
router.delete('/location', auth, userController.removeLocation);

// ── Tiendas seguidas ──────────────────────────────────────────────────────────
router.get('/following-businesses', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('followingBusinesses', 'name logo city verified')
      .lean();
    res.json(user?.followingBusinesses || []);
  } catch (err) {
    console.error('Error /following-businesses:', err);
    res.status(500).json({ message: 'Error al obtener tiendas seguidas' });
  }
});

router.get('/favorite-businesses', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('favoriteBusinesses')
      .populate('favoriteBusinesses', 'name city logo address description verified blocked').lean();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    res.json(formatFavoriteBusinesses(user.favoriteBusinesses));
  } catch (err) {
    res.status(500).json({ message: 'No se pudieron cargar los negocios favoritos' });
  }
});

module.exports = router;
