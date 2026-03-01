// utils/sendMail.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host:   'smtp.gmail.com',
  port:   465,
  secure: true,
  auth: {
    user: "contacto.offertas@gmail.com",
    pass: "dikd rskl kdcq qkpy",
  },
  connectionTimeout: 10000,
  greetingTimeout:   10000,
  socketTimeout:     10000,
});

const sendEmail = async (to, subject, text, html) => {
  await transporter.sendMail({
    from:    `"Offerton" <contacto.offertas@gmail.com>`,
    to,
    subject,
    text,
    html: html || text,
  });
};

module.exports = sendEmail;

  

