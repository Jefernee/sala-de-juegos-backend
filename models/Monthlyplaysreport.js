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
    // Monto (₡) cobrado por controles extra de este empleado.
    totalCostosControles: { type: Number, default: 0 },
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
// Sub-schema: cliente del Top 10 del mes
// Se guarda solo lo que la tarjeta del reporte muestra; el detalle completo
// (todos los clientes, por semana/quincena/rango) sale del endpoint
// GET /api/monthly-reports/:año/:mes/clientes, que calcula al vuelo.
// ─────────────────────────────────────────────
const topClienteSchema = new mongoose.Schema(
  {
    posicion: { type: Number, default: 0 },
    cliente: { type: String, required: true },
    sesiones: { type: Number, default: 0 },
    tiempoTotalMinutos: { type: Number, default: 0 },
    montoTotal: { type: Number, default: 0 },
    totalPlay4: { type: Number, default: 0 },
    totalPlay5: { type: Number, default: 0 },
    totalPingPong: { type: Number, default: 0 },
    diasDistintos: { type: Number, default: 0 },
    ultimaVisita: { type: Date, default: null },
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

    // ── Top 10 de clientes que más jugaron ────
    // Ordenados por cantidad de sesiones, de mayor a menor.
    // Los reportes creados ANTES de esta función no lo traen: el GET del
    // reporte lo calcula al vuelo y lo guarda (ver getReporteMensual), así los
    // meses viejos no necesitan regenerarse a mano.
    topClientes: [topClienteSchema],
 
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