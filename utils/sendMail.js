// utils/sendMail.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host:   'smtp.gmail.com',
  port:   465,
  secure: true,
  auth: {
    user: "contacto.offertas@gmail.com",
    pass: "mure nbuc fqbh iwry",
  },
  connectionTimeout: 10000,
  greetingTimeout:   10000,
  socketTimeout:     10000,
});

const sendEmail = async (to, subject, text, html) => {
  await transporter.sendMail({
    from:    `"Rosario Market" <contacto.offertas@gmail.com>`,
    to,
    subject,
    text,
    html: html || text,
  });
};

module.exports = sendEmail;

  

