// models/Ganancia.js
// Módulo de Administración: Ganancias
import mongoose from 'mongoose';

export const TIPOS_GANANCIA = ['Maquinas Chinos', 'Maquinas Zapata', 'Futbolin', 'Peluches', 'Torneos'];

const gananciaSchema = new mongoose.Schema(
  {
    tipo: {
      type: String,
      enum: {
        values: TIPOS_GANANCIA,
        message: 'Tipo de ganancia inválido: {VALUE}',
      },
      required: [true, 'El tipo es obligatorio'],
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
    // Origen del registro: null = creado por el sistema; 'excel_contabilidad' = importado
    // del libro de contabilidad historico (scripts/importarContabilidadExcel.js).
    // Sirve para el rollback (borrar solo lo importado).
    origen: { type: String, default: null },
  },
  { timestamps: true }
);

// Índice para acelerar el filtro por mes/año
gananciaSchema.index({ fecha: 1 });

export default mongoose.model('Ganancia', gananciaSchema);
