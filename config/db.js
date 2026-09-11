const mongoose = require("mongoose");

let connectionPromise = null;

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
      maxPoolSize: 10,
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
