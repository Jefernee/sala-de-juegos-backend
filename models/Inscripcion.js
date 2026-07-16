// models/Inscripcion.js
// Hecho por Claude Code — Inscripción de una persona a un torneo/competición.
//
// Se crea desde el formulario público (sin login) y queda guardada para que el
// administrador/colaborador la vea en el módulo de Torneos (reemplaza el correo).
import mongoose from 'mongoose';

const inscripcionSchema = new mongoose.Schema(
  {
    torneoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Torneo',
      required: true,
    },
    // Nombre del torneo al momento de inscribirse (snapshot). Sirve para mostrar
    // la inscripción aunque el torneo se elimine después.
    torneoNombre: { type: String, default: null },
    nombre: {
      type: String,
      required: [true, 'El nombre del inscrito es obligatorio'],
      trim: true,
    },
    telefono: { type: String, default: null, trim: true },
    correo: { type: String, default: null, trim: true, lowercase: true },
    gamertag: { type: String, default: null, trim: true },
    nombreEquipo: { type: String, default: null, trim: true },
    // El admin la marca como revisada/procesada (para llevar control).
    atendida: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Listado de inscripciones de un torneo, más recientes primero.
inscripcionSchema.index({ torneoId: 1, createdAt: -1 });

export default mongoose.model('Inscripcion', inscripcionSchema);
