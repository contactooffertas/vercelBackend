// utils/sendMail.js
const nodemailer = require('nodemailer');

const smtpUser = String(process.env.SMTP_USER || process.env.EMAIL_USER || 'contacto.offertas@gmail.com').trim();
const smtpPass = String(process.env.SMTP_PASS || process.env.EMAIL_PASS || 'mure nbuc fqbh iwry').replace(/\s+/g, '').trim();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: smtpUser, pass: smtpPass },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 20000,
});

const sendEmail = async (to, subject, text, html) => {
  const info = await transporter.sendMail({
    from: `"Rosario Market" <${smtpUser}>`,
    to,
    subject,
    text,
    html: html || text,
  });
  console.log('[mail] enviado', { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected });
  return info;
};

module.exports = sendEmail;

  

