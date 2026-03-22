// models/Sale.js
import mongoose from 'mongoose';

const saleSchema = new mongoose.Schema({
  productos: [{
    productoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Inventario',
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
    },
    // ── Nuevos campos de costo ─────────────────
    costoUnitario: {
      type: Number,
      default: 0,
      min: 0
    },
    costoSubtotal: {       // costoUnitario × cantidad
      type: Number,
      default: 0,
      min: 0
    },
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
  // ── Totales de costo y ganancia por venta ──
  totalCosto: {            // suma de todos los costoSubtotal
    type: Number,
    default: 0
  },
  ganancia: {              // total - totalCosto
    type: Number,
    default: 0
  },
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

saleSchema.index({ fecha: -1 });
saleSchema.index({ usuario: 1 });
saleSchema.index({ 'productos.productoId': 1 });

export default mongoose.model('Sale', saleSchema);