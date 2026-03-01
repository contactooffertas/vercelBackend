const mongoose = require("mongoose");

const SeccionSchema = new mongoose.Schema(
  {
    titulo: { type: String, required: true, trim: true },
    contenido: { type: String, required: true },
  },
  { _id: false }
);

const TerminosSchema = new mongoose.Schema(
  {
    secciones: { type: [SeccionSchema], required: true },
    fechaActualizacion: { type: Date, default: Date.now },
    actualizadoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Terminos", TerminosSchema);