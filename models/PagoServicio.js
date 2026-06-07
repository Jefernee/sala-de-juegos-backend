// models/PagoServicio.js
// Hecho por Claude Code — Módulo de Administración: Pagos de Servicios
import mongoose from 'mongoose';

export const TIPOS_SERVICIO = [
  'Luz',
  'Agua',
  'Internet',
  'Patente',
  'PlayStation Plus',
  'Mantenimiento General',
];

const pagoServicioSchema = new mongoose.Schema(
  {
    servicio: {
      type: String,
      enum: {
        values: TIPOS_SERVICIO,
        message: 'Servicio inválido: {VALUE}',
      },
      required: [true, 'El servicio es obligatorio'],
    },
    monto: {
      type: Number,
      required: [true, 'El monto es obligatorio'],
      min: [1, 'El monto debe ser mayor a 0'],
    },
    descripcion: {
      type: String,
      default: null,
      trim: true,
    },
    // La fecha SIEMPRE la asigna el backend, el frontend nunca la envía
    fecha: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Índice para acelerar el filtro por mes/año
pagoServicioSchema.index({ fecha: 1 });

export default mongoose.model('PagoServicio', pagoServicioSchema);
