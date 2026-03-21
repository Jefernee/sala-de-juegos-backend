import mongoose from 'mongoose';
 
// ─────────────────────────────────────────────
// Sub-schema: desglose por empleado
// ─────────────────────────────────────────────
const empleadoResumenSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true },
    totalSesiones: { type: Number, default: 0 },
    totalRecaudado: { type: Number, default: 0 },
    totalPlay4: { type: Number, default: 0 },
    totalPlay5: { type: Number, default: 0 },
    totalPingPong: { type: Number, default: 0 },
    totalControlesAdicionales: { type: Number, default: 0 },
    tiempoTotalMinutos: { type: Number, default: 0 },
  },
  { _id: false }
);
 
// ─────────────────────────────────────────────
// Sub-schema: desglose por lugar de juego
// ─────────────────────────────────────────────
const lugarResumenSchema = new mongoose.Schema(
  {
    lugar: { type: String, required: true },
    totalSesiones: { type: Number, default: 0 },
    totalRecaudado: { type: Number, default: 0 },
    tiempoTotalMinutos: { type: Number, default: 0 },
  },
  { _id: false }
);
 
// ─────────────────────────────────────────────
// Sub-schema: resumen de un día específico
// ─────────────────────────────────────────────
const diaResumenSchema = new mongoose.Schema(
  {
    dia: { type: Number, required: true },
    totalSesiones: { type: Number, default: 0 },
    totalRecaudado: { type: Number, default: 0 },
    totalPlay4: { type: Number, default: 0 },
    totalPlay5: { type: Number, default: 0 },
    totalPingPong: { type: Number, default: 0 },
  },
  { _id: false }
);
 
// ─────────────────────────────────────────────
// Sub-schema: juego más jugado
// ─────────────────────────────────────────────
const juegoResumenSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true },
    vecesJugado: { type: Number, default: 0 },
  },
  { _id: false }
);
 
// ─────────────────────────────────────────────
// Schema principal del reporte mensual
// ─────────────────────────────────────────────
const monthlyReportSchema = new mongoose.Schema(
  {
    año: { type: Number, required: true },
    mes: { type: Number, required: true, min: 1, max: 12 },
    nombreMes: {
      type: String,
      required: true,
      enum: [
        'Enero', 'Febrero', 'Marzo', 'Abril',
        'Mayo', 'Junio', 'Julio', 'Agosto',
        'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
      ],
    },
 
    // ── Totales generales ──────────────────────
    totalSesiones: { type: Number, default: 0 },
    totalRecaudado: { type: Number, default: 0 },
    totalSubtotales: { type: Number, default: 0 },
    totalCostosControles: { type: Number, default: 0 },
 
    // ── Totales por tipo de play ───────────────
    totalPlay4: { type: Number, default: 0 },
    totalPlay5: { type: Number, default: 0 },
    totalPingPong: { type: Number, default: 0 },
 
    // ── Sesiones por estado de pago ───────────
    sesionesCompletadas: { type: Number, default: 0 },
    sesionesPendientes: { type: Number, default: 0 },
    sesionesEnProceso: { type: Number, default: 0 },
 
    // ── Tiempos ───────────────────────────────
    tiempoTotalPagadoMinutos: { type: Number, default: 0 },
    tiempoTotalPendienteMinutos: { type: Number, default: 0 },
 
    // ── Controles adicionales ─────────────────
    totalControlesAdicionales: { type: Number, default: 0 },
 
    // ── Desgloses ─────────────────────────────
    porEmpleado: [empleadoResumenSchema],
    porLugar: [lugarResumenSchema],
    porDia: [diaResumenSchema],
 
    // ── Juegos más jugados ────────────────────
    // Ordenados de mayor a menor por vecesJugado
    juegosMasJugados: [juegoResumenSchema],
 
    // ── Metadata ──────────────────────────────
    ultimaActualizacion: { type: Date, default: Date.now },
    periodoInicio: { type: Date, required: true },
    periodoFin: { type: Date, required: true },
    playsIncluidos: { type: Number, default: 0 },
  },
  { timestamps: true }
);
 
monthlyReportSchema.index({ año: 1, mes: 1 }, { unique: true });
monthlyReportSchema.index({ año: 1 });
 
const MonthlyReport = mongoose.model('MonthlyReport', monthlyReportSchema);
 
export default MonthlyReport;