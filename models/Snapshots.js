// ============================================
// models/Snapshot.js
// Snapshot: fotografía COMPLETA del sistema en un periodo cerrado
// SOLO INSERT - Nunca se actualiza ni se borra
// ============================================
import mongoose from 'mongoose';

const snapshotSchema = new mongoose.Schema({
  
  // ==========================================
  // IDENTIFICACIÓN DEL PERIODO
  // ==========================================
  
  periodoTipo: {
    type: String,
    enum: ['mensual', 'anual'],
    required: true,
    index: true
  },
  
  año: {
    type: Number,
    required: true,
    index: true
  },
  
  mes: {
    type: Number,
    min: 1,
    max: 12,
    required: function() {
      return this.periodoTipo === 'mensual';
    }
  },
  
  periodoLabel: {
    type: String,
    required: true
    // Ejemplo: "2024" o "Enero 2024"
  },
  
  // ==========================================
  // RESUMEN GENERAL DEL SISTEMA
  // ==========================================
  
  resumenGeneral: {
    totalVentasTienda: {
      type: Number,
      default: 0
      // Total $ de todas las ventas (Sale)
    },
    totalVentasPlays: {
      type: Number,
      default: 0
      // Total $ de todos los plays
    },
    totalPedidos: {
      type: Number,
      default: 0
      // Total $ de todos los pedidos
    },
    ingresoTotal: {
      type: Number,
      default: 0
      // Suma de todo: ventas + plays + pedidos
    },
    numeroVentas: {
      type: Number,
      default: 0
      // Cantidad de ventas (Sale)
    },
    numeroPlays: {
      type: Number,
      default: 0
      // Cantidad de sesiones de play
    },
    numeroPedidos: {
      type: Number,
      default: 0
      // Cantidad de pedidos
    }
  },
  
  // ==========================================
  // DATOS DE VENTAS (Sale)
  // ==========================================
  
  ventas: {
    total: {
      type: Number,
      default: 0
    },
    numeroTransacciones: {
      type: Number,
      default: 0
    },
    ticketPromedio: {
      type: Number,
      default: 0
    },
    // Array de productos vendidos
    productos: [{
      productoId: mongoose.Schema.Types.ObjectId,
      nombreProducto: String,
      cantidadVendida: Number,
      totalVentas: Number,
      precioPromedio: Number
    }],
    // Top 5 productos más vendidos
    topProductos: [{
      productoId: mongoose.Schema.Types.ObjectId,
      nombreProducto: String,
      cantidadVendida: Number,
      totalVentas: Number
    }]
  },
  
  // ==========================================
  // DATOS DE PLAYS
  // ==========================================
  
  plays: {
    totalGeneral: {
      type: Number,
      default: 0
    },
    totalPlay4: {
      type: Number,
      default: 0
    },
    totalPlay5: {
      type: Number,
      default: 0
    },
    totalPingPong: {
      type: Number,
      default: 0
    },
    numeroSesiones: {
      type: Number,
      default: 0
    },
    horasTotales: {
      type: Number,
      default: 0
      // Total de horas jugadas
    },
    ticketPromedio: {
      type: Number,
      default: 0
    },
    // Estadísticas por lugar
    porLugar: [{
      lugar: String,
      numeroSesiones: Number,
      totalGenerado: Number,
      horasTotales: Number
    }],
    // Estadísticas por empleado
    porEmpleado: [{
      empleado: String,
      numeroSesiones: Number,
      totalGenerado: Number
    }]
  },
  
  // ==========================================
  // DATOS DE PEDIDOS
  // ==========================================
  
  pedidos: {
    total: {
      type: Number,
      default: 0
    },
    numeroPedidos: {
      type: Number,
      default: 0
    },
    ticketPromedio: {
      type: Number,
      default: 0
    },
    // Por estado
    porEstado: {
      pendiente: { cantidad: Number, total: Number },
      confirmado: { cantidad: Number, total: Number },
      completado: { cantidad: Number, total: Number },
      cancelado: { cantidad: Number, total: Number }
    },
    // Productos más pedidos
    topProductos: [{
      productoId: mongoose.Schema.Types.ObjectId,
      productoNombre: String,
      cantidadPedidos: Number,
      totalGenerado: Number
    }]
  },
  
  // ==========================================
  // ESTADO DEL INVENTARIO (al momento del cierre)
  // ==========================================
  
  inventario: {
    totalProductos: {
      type: Number,
      default: 0
      // Cantidad de productos diferentes
    },
    totalUnidades: {
      type: Number,
      default: 0
      // Suma de todas las cantidades
    },
    valorInventario: {
      type: Number,
      default: 0
      // Suma de (cantidad × precioCompra)
    },
    productosActivos: {
      type: Number,
      default: 0
      // Productos con seVende: true
    },
    productosInactivos: {
      type: Number,
      default: 0
      // Productos con seVende: false
    }
  },
  
  // ==========================================
  // ESTADÍSTICAS DE USUARIOS
  // ==========================================
  
  usuarios: {
    totalUsuarios: {
      type: Number,
      default: 0
    },
    // Ventas por usuario
    porUsuario: [{
      usuarioId: mongoose.Schema.Types.ObjectId,
      nombreUsuario: String,
      numeroVentas: Number,
      totalGenerado: Number
    }]
  },
  
  // ==========================================
  // METADATA
  // ==========================================
  
  fechaCierre: {
    type: Date,
    required: true,
    immutable: true
    // Cuándo se cerró este periodo
  },
  
  cerrado: {
    type: Boolean,
    default: true,
    immutable: true
  }
  
}, {
  timestamps: { 
    createdAt: true,
    updatedAt: false
  }
});

// ==========================================
// ÍNDICES
// ==========================================

// ÚNICO: solo un snapshot por periodo
snapshotSchema.index({ 
  periodoTipo: 1, 
  año: 1, 
  mes: 1
}, { unique: true });

// Para consultas
snapshotSchema.index({ periodoTipo: 1, año: -1, mes: -1 });
snapshotSchema.index({ año: -1 });

// ==========================================
// PREVENCIÓN DE MODIFICACIONES
// ==========================================

snapshotSchema.pre('findOneAndUpdate', function() {
  throw new Error('⛔ Los snapshots son inmutables. Solo se permite INSERT.');
});

snapshotSchema.pre('updateOne', function() {
  throw new Error('⛔ Los snapshots son inmutables. Solo se permite INSERT.');
});

snapshotSchema.pre('remove', function() {
  throw new Error('⛔ Los snapshots no se pueden eliminar.');
});

export default mongoose.model('Snapshot', snapshotSchema);