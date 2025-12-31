//models/Inventario.js
import mongoose from "mongoose";

const Schema = mongoose.Schema;

const inventarioSchema = new Schema({
  nombre: { type: String, required: true },
  cantidad: { type: Number, required: true },
  precioCompra: { type: Number, required: true },
  precioVenta: { type: Number, required: true },
  fechaCompra: { type: Date, required: true },
  imagen: { type: String },
  
  seVende: { 
    type: Boolean, 
    default: true,
    required: true 
  },
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false
});

// ✅ MIDDLEWARE CON ASYNC/AWAIT (más moderno y sin problemas de next)
inventarioSchema.pre('findOneAndUpdate', async function() {
  this.set({ updatedAt: new Date() });
});

inventarioSchema.pre('save', async function() {
  this.updatedAt = new Date();
});

// Índices
inventarioSchema.index({ nombre: 1 });
inventarioSchema.index({ seVende: 1 });
inventarioSchema.index({ seVende: 1, nombre: 1 });
inventarioSchema.index({ createdBy: 1 });
inventarioSchema.index({ createdAt: -1 });

export default mongoose.model("Inventario", inventarioSchema);



