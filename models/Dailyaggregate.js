// ============================================
// models/DailyAggregate.js
// Modelo de datos para agregados diarios
// ============================================
import mongoose from 'mongoose';

const dailyAggregateSchema = new mongoose.Schema({
  
  // ==========================================
  // IDENTIFICADORES
  // ==========================================
  
  fecha: {
    type: Date,
    required: true,
    index: true
  },
  
  productoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inventario',
    required: true,
    index: true
  },
  
  nombreProducto: {
    type: String,
    required: true
  },
  
  // ==========================================
  // MÉTRICAS DE VENTAS
  // ==========================================
  
  cantidadVendida: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  
  totalVentas: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  
  numeroTransacciones: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  
  // ==========================================
  // COSTOS Y GANANCIAS
  // ==========================================
  
  costoTotal: {
    type: Number,
    default: 0,
    min: 0
  },
  
  gananciaTotal: {
    type: Number,
    default: 0
  },
  
  margenPromedio: {
    type: Number,
    default: 0
  },
  
  // ==========================================
  // PROMEDIOS
  // ==========================================
  
  precioPromedio: {
    type: Number,
    default: 0
  },
  
  ticketPromedio: {
    type: Number,
    default: 0
  },
  
  costoPromedio: {
    type: Number,
    default: 0
  },
  
  // ==========================================
  // SNAPSHOT DEL INVENTARIO
  // ==========================================
  
  stockFinal: {
    type: Number,
    default: 0
  },
  
  estadoStock: {
    type: String,
    enum: ['normal', 'bajo', 'agotado'],
    default: 'normal'
  },
  
  categoria: {
    type: String,
    default: ''
  },
  
  esVenta: {
    type: Boolean,
    default: true
  }
  
}, {
  timestamps: true
});

// ==========================================
// ÍNDICES
// ==========================================

dailyAggregateSchema.index({ fecha: 1, productoId: 1 }, { unique: true });
dailyAggregateSchema.index({ fecha: -1 });
dailyAggregateSchema.index({ fecha: -1, estadoStock: 1 });
dailyAggregateSchema.index({ fecha: -1, esVenta: 1 });

export default mongoose.model('DailyAggregate', dailyAggregateSchema);