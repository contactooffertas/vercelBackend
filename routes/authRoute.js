// routes/authRoute.js
const express = require('express');
const router = express.Router();

const login = require('../authController/login');
const { register, verifyUser, resendVerificationCode,forgotPassword,resetPassword } = require('../authController/register');
const authMiddleware = require('../middleware/authMiddleware');
const userController = require('../authController/userController');

router.post('/register', register);
router.post('/resend',   resendVerificationCode);
router.post('/verify',   verifyUser);
router.post('/login',    login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password',  resetPassword);
// Reemplaza actualizar.js directamente con userController.updateProfile
router.put('/update', authMiddleware, userController.updateProfile);

module.exports = router;