//models/Inventario.js
import mongoose from "mongoose";

const Schema = mongoose.Schema;

// Helper: fecha actual en zona horaria de Costa Rica
const getFechaCostaRica = () => {
  const cr = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }));
  return new Date(Date.UTC(cr.getFullYear(), cr.getMonth(), cr.getDate(), 6, 0, 0, 0));
};

const inventarioSchema = new Schema({
  nombre: { type: String, required: true },
  cantidad: { type: Number, required: true },
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

export default mongoose.model("Inventario", inventarioSchema);