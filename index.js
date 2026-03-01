// server.js  –  versión Vercel (sin Socket.IO)
require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const connectDB = require('./config/db');

// ── Rutas ─────────────────────────────────────────────────────────────────────
const authRoutes           = require('./routes/authRoute');
const userRoutes           = require('./routes/userRoute');
const busiRoutes           = require('./routes/businessRoute');
const productRoutes        = require('./routes/productRoute');
const adminRoutes          = require('./routes/adminRoute');
const cartRoutes           = require('./routes/cartRoute');
const orderRoutes          = require('./routes/orderRoute');
const chatRoutes           = require('./routes/chatRoute');
const reportRoutes         = require('./routes/reportRoute');
const announcementRoutes   = require('./routes/announcementRoute');
const terminosRoutes       = require('./routes/terminosRoute');
const eliminaUsuarioRoutes = require('./routes/eliminarUsuarioRoute');
const { router: pushRoutes } = require('./routes/pushRoute');

const app = express();
connectDB();

// ── CORS ──────────────────────────────────────────────────────────────────────
const corsOptions = {
  origin: 'https://ofertas-lime-ten.vercel.app','http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Servidor de Offertas conectado (Vercel)' });
});

// ── Rutas de la API ───────────────────────────────────────────────────────────
app.use('/api/auth',            authRoutes);
app.use('/api/user',            userRoutes);
app.use('/api/business',        busiRoutes);
app.use('/api/products',        productRoutes);
app.use('/api/cart',            cartRoutes);
app.use('/api/orders',          orderRoutes);
app.use('/api/chat',            chatRoutes);
app.use('/api/push',            pushRoutes);
app.use('/api/reports',         reportRoutes);
app.use('/api/admin',           adminRoutes);
app.use('/api/announcements',   announcementRoutes);
app.use('/api/terminos',        terminosRoutes);
app.use('/api/elimina-usuario', eliminaUsuarioRoutes);

// ── Exportar app para Vercel ──────────────────────────────────────────────────
module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  });
}

