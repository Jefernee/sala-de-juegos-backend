import mongoose from 'mongoose';

// ─────────────────────────────────────────────
// Sub-schema: desglose por empleado/cajero
// ─────────────────────────────────────────────
const empleadoResumenSchema = new mongoose.Schema(
  {
    usuarioId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    nombre:         { type: String, required: true },
    email:          { type: String, default: '' },
    totalVentas:    { type: Number, default: 0 },
    totalRecaudado: { type: Number, default: 0 },
    totalCosto:     { type: Number, default: 0 },
    ganancia:       { type: Number, default: 0 },
    ticketPromedio: { type: Number, default: 0 },
  },
  { _id: false }
);

// ─────────────────────────────────────────────
// Sub-schema: producto más vendido
// ─────────────────────────────────────────────
const productoResumenSchema = new mongoose.Schema(
  {
    productoId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Inventario' },
    nombre:         { type: String, required: true },
    totalVendido:   { type: Number, default: 0 },   // unidades
    totalRecaudado: { type: Number, default: 0 },   // ingresos
    totalCosto:     { type: Number, default: 0 },   // costo total
    ganancia:       { type: Number, default: 0 },   // ingreso - costo
    vecesEnVentas:  { type: Number, default: 0 },
  },
  { _id: false }
);

// ─────────────────────────────────────────────
// Sub-schema: resumen de un día
// ─────────────────────────────────────────────
const diaResumenSchema = new mongoose.Schema(
  {
    dia:            { type: Number, required: true },
    totalVentas:    { type: Number, default: 0 },
    totalRecaudado: { type: Number, default: 0 },
    ganancia:       { type: Number, default: 0 },
  },
  { _id: false }
);

// ─────────────────────────────────────────────
// Schema principal del reporte mensual de ventas
// ─────────────────────────────────────────────
const saleReportSchema = new mongoose.Schema(
  {
    año:      { type: Number, required: true },
    mes:      { type: Number, required: true, min: 1, max: 12 },
    nombreMes: {
      type: String,
      required: true,
      enum: ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
             'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'],
    },

    // ── Totales generales ──────────────────────────
    totalVentas:            { type: Number, default: 0 },
    totalRecaudado:         { type: Number, default: 0 },
    totalMontoPagado:       { type: Number, default: 0 },
    totalVuelto:            { type: Number, default: 0 },
    ticketPromedio:         { type: Number, default: 0 },
    totalUnidadesVendidas:  { type: Number, default: 0 },

    // ── Costos y ganancia ──────────────────────────
    totalCosto:             { type: Number, default: 0 },  // suma de costos
    gananciaTotal:          { type: Number, default: 0 },  // recaudado - costo
    margenPromedio:         { type: Number, default: 0 },  // ganancia / recaudado × 100

    // ── Desgloses ─────────────────────────────────
    porEmpleado:           [empleadoResumenSchema],
    productosMasVendidos:  [productoResumenSchema],
    porDia:                [diaResumenSchema],

    // ── Metadata ──────────────────────────────────
    ultimaActualizacion: { type: Date, default: Date.now },
    periodoInicio:       { type: Date, required: true },
    periodoFin:          { type: Date, required: true },
    ventasIncluidas:     { type: Number, default: 0 },
  },
  { timestamps: true }
);

saleReportSchema.index({ año: 1, mes: 1 }, { unique: true });
saleReportSchema.index({ año: 1 });

const SaleReport = mongoose.model('SaleReport', saleReportSchema);

export default SaleReport;