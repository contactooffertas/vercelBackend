const Terminos = require("../models/terminosModel");

// GET /api/terminos — público
const getTerminos = async (req, res) => {
  try {
    // Siempre hay un solo documento activo (el más reciente)
    const terminos = await Terminos.findOne().sort({ createdAt: -1 }).lean();
    if (!terminos) {
      return res.status(404).json({ message: "No se encontraron términos." });
    }
    return res.json(terminos);
  } catch (error) {
    console.error("getTerminos error:", error);
    return res.status(500).json({ message: "Error interno del servidor." });
  }
};

// POST /api/terminos — solo admin
const crearTerminos = async (req, res) => {
  try {
    const { secciones } = req.body;

    if (!secciones || !Array.isArray(secciones) || secciones.length === 0) {
      return res.status(400).json({ message: "Se requieren secciones válidas." });
    }

    const nuevos = await Terminos.create({
      secciones,
      fechaActualizacion: new Date(),
      actualizadoPor: req.user._id,
    });

    return res.status(201).json(nuevos);
  } catch (error) {
    console.error("crearTerminos error:", error);
    return res.status(500).json({ message: "Error al crear los términos." });
  }
};

// PUT /api/terminos/:id — solo admin
const actualizarTerminos = async (req, res) => {
  try {
    const { id } = req.params;
    const { secciones } = req.body;

    if (!secciones || !Array.isArray(secciones) || secciones.length === 0) {
      return res.status(400).json({ message: "Se requieren secciones válidas." });
    }

    const actualizado = await Terminos.findByIdAndUpdate(
      id,
      {
        secciones,
        fechaActualizacion: new Date(),
        actualizadoPor: req.user._id,
      },
      { new: true, runValidators: true }
    );

    if (!actualizado) {
      return res.status(404).json({ message: "Términos no encontrados." });
    }

    return res.json(actualizado);
  } catch (error) {
    console.error("actualizarTerminos error:", error);
    return res.status(500).json({ message: "Error al actualizar los términos." });
  }
};

module.exports = { getTerminos, crearTerminos, actualizarTerminos };