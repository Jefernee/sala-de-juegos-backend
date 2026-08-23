// models/Sale.js
import mongoose from 'mongoose';
import { METODOS_PAGO, METODO_EFECTIVO } from '../config/metodosPago.js';

// ─────────────────────────────────────────────────────────────────
// Qué se descontó del inventario por esta venta, ítem por ítem.
//
// Es el registro EXACTO del movimiento, no una receta para recalcularlo. Al
// borrar la venta se devuelve esto tal cual, sin volver a mirar el producto.
//
// Hace falta porque una receta puede cambiar entre la venta y el borrado: el
// "Helado con Gelatina" llegó a tener 44 vasos por unidad mal digitados y se
// corrigió después. Recalculando desde la receta de hoy se devolverían 1 vaso
// donde se habían descontado 44, y el inventario quedaría mal en silencio.
//
// Para una receta hay una línea por INGREDIENTE; para un producto simple, una
// sola línea con el producto mismo.
// ─────────────────────────────────────────────────────────────────
const descuentoInventarioSchema = new mongoose.Schema(
  {
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Inventario',
      required: true,
    },
    // Copia del nombre al momento de la venta: si el ítem se borra del
    // inventario, todavía se puede decir qué no se pudo devolver.
    nombre: { type: String, default: '' },
    cantidad: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

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
  // Cómo se cobró: efectivo o SINPE. Sirve para separar la caja física de las
  // transferencias en el reporte del mes.
  //
  // NO es required a propósito: las ventas viejas no traen el campo y ponerlo
  // obligatorio haría que cualquier .save() sobre una de ellas (editar la
  // fecha, por ejemplo) fallara por validación. Con el default, tanto los
  // documentos viejos al leerse como las ventas de un frontend viejo que no
  // mande el campo quedan como "efectivo", que es lo que realmente fueron.
  metodoPago: {
    type: String,
    enum: METODOS_PAGO,
    default: METODO_EFECTIVO
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
  },
  // Movimientos de inventario de esta venta. Las ventas anteriores a esta
  // función no lo tienen: al borrarlas, la devolución se estima desde la
  // receta/producto actual (ver restaurarInventarioDeVenta).
  descuentosInventario: {
    type: [descuentoInventarioSchema],
    default: [],
  }
}, {
  timestamps: true
});

saleSchema.index({ fecha: -1 });
saleSchema.index({ metodoPago: 1 });
saleSchema.index({ usuario: 1 });
saleSchema.index({ 'productos.productoId': 1 });

export default mongoose.model('Sale', saleSchema);