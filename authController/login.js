const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const connectDB = require("../config/db");

module.exports = async (req, res) => {
  try {
    await connectDB();

    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password) {
      return res.status(400).json({ message: "Email y contraseña son requeridos" });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Credenciales inválidas" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Credenciales inválidas" });

    if (!user.verified) {
      return res.status(403).json({
        message: "Primero verificá tu correo electrónico.",
        requiresVerification: true,
        email: user.email,
      });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({ token, user });
  } catch (err) {
    console.error("❌ LOGIN:", err.message);
    return res.status(503).json({
      message: "El servicio está tardando en responder. Intentá nuevamente en unos segundos.",
    });
  }
};
