const mongoose = require("mongoose");

let connectionPromise = null;

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
      // Vercel puede levantar varias instancias en paralelo. Un pool pequeño
      // por instancia evita agotar las conexiones del clúster Atlas M0.
      maxPoolSize: 3,
      minPoolSize: 0,
      maxIdleTimeMS: 30000,
    })
      .then((conn) => {
        console.log("✅ MongoDB conectado");
        return conn;
      })
      .catch((err) => {
        connectionPromise = null;
        console.error("❌ MongoDB conexión:", err.message);
        throw err;
      });
  }

  return connectionPromise;
};

module.exports = connectDB;
