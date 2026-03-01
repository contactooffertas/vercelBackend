// routes/authRoute.js
const express        = require('express');
const router         = express.Router();
const login          = require('../authController/login');
const {
  register,
  verifyUser,
  resendVerificationCode,
  forgotPassword,
  resetPassword,
} = require('../authController/register');
const authMiddleware  = require('../middleware/authMiddleware');
const userController  = require('../authController/userController');

router.post('/register',         register);
router.post('/resend',           resendVerificationCode);
router.post('/verify',           verifyUser);
router.post('/login',            login);
router.post('/forgot-password',  forgotPassword);
router.post('/reset-password',   resetPassword);
router.put('/update', authMiddleware, userController.updateProfile);




// Ruta temporal de diagnóstico — BORRALA después de confirmar que funciona
router.get('/test-email', async (req, res) => {
  const sendEmail = require('../utils/sendMail');
  try {
    await sendEmail(
      'contacto.offertas@gmail.com', // mandarte a vos mismo
      '🧪 Test email Offerton',
      'Si ves esto, el email funciona.',
      '<h1>✅ Email funcionando correctamente</h1>'
    );
    res.json({ ok: true, message: 'Email enviado correctamente' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, stack: err.stack });
  }
});

module.exports = router;

