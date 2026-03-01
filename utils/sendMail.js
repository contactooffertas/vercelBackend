const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: "contacto.offertas@gmail.com",
    pass: "dikd rskl kdcq qkpy",
  },
});;

const sendEmail = async (to, subject, text, html) => {
  try {
    await transporter.sendMail({
      from: `"Offertas"- GRACIAS POR ESTAR`,
      to,
      subject,
      text,
      html: html || text,
    });
  } catch (err) {
    console.error('❌ Error enviando email:', err);
    throw err;
  }
};


module.exports = sendEmail;




