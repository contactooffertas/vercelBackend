const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: "contacto.offertas@gmail.com",
    pass: "dikd rskl kdcq qkpy",
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
    console.log("✅ Email enviado:", info.messageId);
    return info;
  } catch (err) {
    console.error("❌ Error enviando email:", err);
    throw err;
  }
};

module.exports = sendEmail;
