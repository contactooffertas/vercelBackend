const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB conectado a su base');
    console.log("URI ACTUAL:", process.env.MONGO_URI);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

module.exports = connectDB;
