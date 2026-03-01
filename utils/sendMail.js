const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: "contacto.offertas@gmail.com",
    pass: "dikd rskl kdcq qkpy",
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
});

const sendEmail = async (to, subject, text, html) => {
  try {
    await transporter.sendMail({
      from: `"Offertas"- ${process.env.EMAIL_USER}`,
      to,
      subject,
      text,
      html: html || text,
    });
  } catch (err) {
    console.error("❌ Error enviando email:", err);
    throw err;
  }
};

  console.log('✅ Este es del sendMail');

module.exports = sendEmail;
