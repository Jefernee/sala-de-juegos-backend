//models/Inventario.js
import mongoose from "mongoose";

const Schema = mongoose.Schema;

// Helper: fecha actual en zona horaria de Costa Rica
const getFechaCostaRica = () => {
  const cr = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }));
  return new Date(Date.UTC(cr.getFullYear(), cr.getMonth(), cr.getDate(), 6, 0, 0, 0));
};

// ─────────────────────────────────────────────────────────────────
// Hecho por Claude Code — Sub-schema para cada ingrediente de una receta.
// Almacena la referencia al producto del inventario y la cantidad
// necesaria por unidad vendida de la receta (ej. 1 cono necesita 2
// bolas de helado → cantidad: 2).
// ─────────────────────────────────────────────────────────────────
const ingredienteRecetaSchema = new Schema({
  ingredienteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inventario',
    required: true,
  },
  nombre: { type: String, required: true }, // guardado para referencia rápida sin populate
  cantidad: { type: Number, required: true, min: 0.01 }, // cantidad usada por unidad de receta
}, { _id: false });

const inventarioSchema = new Schema({
  nombre: { type: String, required: true },
  cantidad: { type: Number, required: true, default: 0 },
  precioCompra: { type: Number, required: true },
  precioVenta: { type: Number, required: true },
  fechaCompra: {
    type: Date,
    required: true,
    default: getFechaCostaRica, // ✅ Se asigna automáticamente si no viene en el payload
  },
  imagen: { type: String },

  seVende: {
    type: Boolean,
    default: true,
    required: true,
  },

  // ─────────────────────────────────────────────────────────────────
  // Hecho por Claude Code — tipo de ítem en inventario:
  //   'producto' → artículo simple con stock propio (comportamiento anterior)
  //   'receta'   → producto compuesto que descuenta sus ingredientes al venderse.
  //                No tiene stock propio; su disponibilidad se calcula
  //                a partir del stock de sus ingredientes.
  // Todos los documentos existentes sin este campo se comportan como 'producto'.
  // ─────────────────────────────────────────────────────────────────
  tipo: {
    type: String,
    enum: ['producto', 'receta'],
    default: 'producto',
  },

  // Para ingredientes a granel (helado, sirope, etc.)
  // unidad: qué representa cada número (ej. "bolas", "ml", "gr", "unidades")
  // cantidadPorEnvase: cuántas unidades trae 1 compra (ej. 500 para botella de 500ml)
  // nombreEnvase: cómo se llama el envase (ej. "botella", "balde", "paquete")
  // Cuando cantidadPorEnvase está definido, el admin puede reponer por envases
  // y el sistema multiplica automáticamente.
  unidad: { type: String, default: 'unidades', trim: true },
  cantidadPorEnvase: { type: Number, default: null, min: 0.01 },
  nombreEnvase: { type: String, default: null, trim: true },

  // ─────────────────────────────────────────────────────────────────
  // Hecho por Claude Code — Lista de ingredientes que componen la receta.
  // Solo se usa cuando tipo === 'receta'.
  // Cada elemento referencia un ítem de Inventario (tipo: 'producto')
  // e indica cuántas unidades se consumen por cada unidad de receta vendida.
  // ─────────────────────────────────────────────────────────────────
  receta: {
    type: [ingredienteRecetaSchema],
    default: [],
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: false,
});

// Middlewares
inventarioSchema.pre('findOneAndUpdate', async function() {
  this.set({ updatedAt: new Date() });
});

inventarioSchema.pre('save', async function() {
  this.updatedAt = new Date();
});

// Índices
inventarioSchema.index({ createdBy: 1, createdAt: -1 });
inventarioSchema.index({ nombre: 1 });
inventarioSchema.index({ seVende: 1 });
inventarioSchema.index({ tipo: 1 }); // Hecho por Claude Code — índice para filtrar por tipo

export default mongoose.model("Inventario", inventarioSchema);