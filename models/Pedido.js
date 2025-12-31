// models/Pedido.js
import mongoose from 'mongoose';

const pedidoSchema = new mongoose.Schema({
  productoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inventario',  // ← Cambiar aquí de 'Producto' a 'Inventario'
    required: true
  },
  productoNombre: {
    type: String,
    required: true
  },
  precioVenta: {
    type: Number,
    required: true
  },
  nombreCliente: {
    type: String,
    required: true,
    trim: true
  },
  telefono: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  cantidad: {
    type: Number,
    required: true,
    min: 1
  },
  total: {
    type: Number,
    required: true
  },
  notas: {
    type: String,
    trim: true
  },
  estado: {
    type: String,
    enum: ['pendiente', 'confirmado', 'completado', 'cancelado'],
    default: 'pendiente'
  },
  fechaPedido: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

export default mongoose.model('Pedido', pedidoSchema);