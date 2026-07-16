// models/Torneo.js
// Hecho por Claude Code — Módulo de Administración: Torneos y competiciones.
//
// El administrador/colaborador crea y edita torneos (nombre, fecha, etc.) que
// se muestran en la página pública. La gente se inscribe desde el sitio público
// y esas inscripciones quedan guardadas (ver models/Inscripcion.js) en vez de
// llegar por correo.
import mongoose from 'mongoose';

// abierto = acepta inscripciones | cerrado = ya no acepta (lleno o cerrado a mano)
export const ESTADOS_TORNEO = ['abierto', 'cerrado'];

const torneoSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: [true, 'El nombre del torneo es obligatorio'],
      trim: true,
    },
    // Fecha del torneo. Llega como "YYYY-MM-DD" y se guarda como Date en
    // medianoche de Costa Rica (ver parseFecha en el controlador).
    fecha: {
      type: Date,
      required: [true, 'La fecha del torneo es obligatoria'],
    },
    descripcion: { type: String, default: null, trim: true },
    // Afiche del torneo en Cloudinary (opcional).
    imagenUrl: { type: String, default: null },
    // Cupo máximo de inscritos. null = sin límite.
    cupoMaximo: {
      type: Number,
      default: null,
      min: [1, 'El cupo máximo debe ser mayor a 0'],
    },
    // Costo de inscripción en ₡. 0 = gratis.
    costoInscripcion: {
      type: Number,
      default: 0,
      min: [0, 'El costo de inscripción no puede ser negativo'],
    },
    estado: {
      type: String,
      enum: { values: ESTADOS_TORNEO, message: 'Estado inválido: {VALUE}' },
      default: 'abierto',
    },
  },
  { timestamps: true }
);

// Listado ordenado por fecha del torneo
torneoSchema.index({ fecha: -1 });

export default mongoose.model('Torneo', torneoSchema);
