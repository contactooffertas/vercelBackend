const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  auth: {
    user:"a3acea001@smtp-brevo.com",
    pass: "6tN0BnSAkdxP2H94",
  },
});


const sendEmail = async (to, subject, text, html) => {
  try {
    const info = await transporter.sendMail({
      from: '"Offertas" <contacto.offertas@gmail.com>',
      to: Array.isArray(to) ? to.join(",") : to,
      subject,
      text,
      html: html || text,
    });
    return info;
  } catch (err) {
    throw err;
  }
};

module.exports = sendEmail;

