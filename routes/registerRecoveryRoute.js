const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const sendEmail = require('../utils/sendMail');

const router = express.Router();

function verificationEmailHTML(code, name) {
  return `<!DOCTYPE html>
  <html lang="es">
  <head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Verificá tu cuenta</title></head>
  <body style="margin:0;padding:0;background:#f4f4f4;font-family:'Segoe UI',Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:560px;width:100%;">
          <tr><td style="background:linear-gradient(135deg,#f97316,#ea580c);padding:36px 40px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:28px;font-weight:900;">Rosario<span style="color:#fed7aa;">Market</span></h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Tu marketplace de Rosario</p>
          </td></tr>
          <tr><td style="padding:40px 40px 32px;">
            <h2 style="margin:0 0 12px;color:#111827;font-size:22px;font-weight:700;">¡Hola, ${name}!</h2>
            <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6;">Para activar tu cuenta, ingresá el siguiente código:</p>
            <div style="background:#fff7ed;border:2px dashed #f97316;border-radius:12px;padding:28px;text-align:center;margin-bottom:28px;">
              <span style="font-size:42px;font-weight:900;color:#f97316;letter-spacing:10px;font-family:'Courier New',monospace;">${code}</span>
              <p style="margin:12px 0 0;color:#9ca3af;font-size:12px;">Válido por 10 minutos</p>
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
  </html>`;
}

router.post('/register', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const role = ['user', 'seller'].includes(req.body?.role) ? req.body.role : 'user';
    const terminosAceptados = req.body?.terminosAceptados === true;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Completá nombre, email y contraseña.' });
    }
    if (!terminosAceptados) {
      return res.status(400).json({ message: 'Debés aceptar los Términos y Condiciones para registrarte.' });
    }
    if (!process.env.JWT_SECRET) {
      console.error('[register] JWT_SECRET no configurado');
      return res.status(500).json({ message: 'Error de configuración del servidor' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    let user = await User.findOne({ email });

    if (user?.verified) {
      return res.status(400).json({ message: 'Email ya registrado' });
    }

    if (user) {
      user.name = name;
      user.password = hashed;
      user.role = role;
      user.verificationCode = code;
      user.verificationCodeExpires = expires;
      user.terminosAceptados = true;
      user.terminosAceptadosAt = new Date();
      await user.save();
    } else {
      user = await User.create({
        name,
        email,
        password: hashed,
        role,
        verificationCode: code,
        verificationCodeExpires: expires,
        terminosAceptados: true,
        terminosAceptadosAt: new Date(),
      });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    try {
      await sendEmail(
        email,
        'Código de verificación — Rosario Market',
        `Tu código de verificación es: ${code}. Válido por 10 minutos.`,
        verificationEmailHTML(code, name)
      );
    } catch (emailErr) {
      console.error('[register] Error enviando email de verificación:', emailErr.message);
    }

    return res.status(user.createdAt?.getTime() === user.updatedAt?.getTime() ? 201 : 200).json({
      message: 'Usuario registrado. Verificá tu email.',
      token,
      user,
    });
  } catch (err) {
    console.error('[register] Error:', err);
    if (err?.code === 11000) {
      return res.status(409).json({ message: 'Ese email ya está en uso' });
    }
    return res.status(500).json({ message: 'Error servidor' });
  }
});

module.exports = router;
