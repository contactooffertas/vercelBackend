// routes/userRoute.js
const express    = require('express');
const router     = express.Router();
const auth       = require('../middleware/authMiddleware');
const upload     = require('../middleware/upload');
const userController = require('../authController/userController');
const User       = require('../models/userModel');

router.get('/profile',          auth,                          userController.getProfile);
router.put('/update',           auth,                          userController.updateProfile);
router.put('/change-password',  auth,                          userController.changePassword);
router.post('/avatar',          auth, upload.single('avatar'), userController.updateAvatar);

// ── Ubicación (comprador y vendedor) ─────────────────────────────────────────
router.put('/location',    auth, userController.saveLocation);
router.delete('/location', auth, userController.removeLocation);

// ── Tiendas seguidas ──────────────────────────────────────────────────────────
router.get('/following-businesses', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('followingBusinesses', 'name logo city rating totalRatings verified')
      .lean();
    res.json(user?.followingBusinesses || []);
  } catch (err) {
    console.error('Error /following-businesses:', err);
    res.status(500).json({ message: 'Error al obtener tiendas seguidas' });
  }
});

module.exports = router;