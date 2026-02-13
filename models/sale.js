// ============================================
// models/Sale.js - Modelo de venta CORREGIDO
// ============================================
import mongoose from 'mongoose';

const saleSchema = new mongoose.Schema({
  productos: [{
    productoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Inventario',  // ✅ CORREGIDO: debe ser 'Inventario' no 'Product'
      required: true
    },
    nombre: {
      type: String,
      required: true
    },
    cantidad: {
      type: Number,
      required: true,
      min: 1
    },
    precioVenta: {
      type: Number,
      required: true,
      min: 0
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0
    }
  }],
  total: {
    type: Number,
    required: true,
    min: 0
  },
  montoPagado: {
    type: Number,
    required: true,
    min: 0
  },
  vuelto: {
    type: Number,
    required: true
  },
  // ✅ NUEVOS CAMPOS DE USUARIO
  usuario: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  nombreUsuario: {
    type: String,
    required: true
  },
  emailUsuario: {
    type: String,
    required: true
  },
  fecha: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Índices para optimizar consultas
saleSchema.index({ fecha: -1 });
saleSchema.index({ usuario: 1 });
saleSchema.index({ 'productos.productoId': 1 });

export default mongoose.model('Sale', saleSchema);