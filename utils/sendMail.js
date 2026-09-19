// utils/sendMail.js
const nodemailer = require('nodemailer');

const smtpUser = String(process.env.EMAIL_USER || '').trim();
const smtpPass = String(process.env.EMAIL_PASS || '').replace(/\s+/g, '').trim();

const sendEmail = async (to, subject, text, html) => {
  if (!smtpUser || !smtpPass) {
    throw new Error('SMTP no configurado: faltan EMAIL_USER o EMAIL_PASS');
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });

  const info = await transporter.sendMail({
    from: `"Rosario Market" <${smtpUser}>`,
    replyTo: smtpUser,
    to,
    subject,
    text,
    html: html || text,
  });

  console.log('[mail] enviado', {
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
  });

  return info;
};

module.exports = sendEmail;
