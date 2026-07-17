// models/EstadoResultados.js
// Módulo de Reportes: Estado de Resultados mensual.
//
// Income statement del mes: junta INGRESOS (ventas + plays + otras ganancias) y
// EGRESOS (costo de ventas, servicios, reparaciones y compras de activos) y
// calcula las utilidades. Patrón "genera y guarda": un POST calcula desde las
// colecciones crudas y GUARDA aquí el resumen ya sumado; los GET solo leen.
// Así ver el reporte es barato y el resumen sobrevive aunque se borren los datos crudos.
import mongoose from 'mongoose';

export const NOMBRES_MES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// Sub-schema genérico: desglose { etiqueta → monto }.
const desgloseSchema = new mongoose.Schema(
  { tipo: { type: String, required: true }, monto: { type: Number, default: 0 } },
  { _id: false }
);

const estadoResultadosSchema = new mongoose.Schema(
  {
    año: { type: Number, required: true },
    mes: { type: Number, required: true, min: 1, max: 12 },
    nombreMes: { type: String, required: true },

    // Versión del formato del reporte. Si un doc guardado tiene una versión
    // menor a la actual (SCHEMA_VERSION en el controller), se regenera solo al
    // leerlo o en el backfill de arranque, para que tome los campos nuevos
    // (detalle, comparativo, ahorro, etc.) sin apretar "Regenerar" a mano.
    schemaVersion: { type: Number, default: 0 },

    // ── INGRESOS ──────────────────────────────
    ingresoVentas: { type: Number, default: 0 },     // Sale.total del mes
    ingresoPlays: { type: Number, default: 0 },      // Play.montoPagado del mes
    ingresoGanancias: { type: Number, default: 0 },  // Ganancia.monto del mes
    totalIngresos: { type: Number, default: 0 },
    gananciasPorTipo: [desgloseSchema],              // por tipo de ganancia

    // ── EGRESOS ───────────────────────────────
    costoVentas: { type: Number, default: 0 },        // Sale.totalCosto (COGS)
    egresoServicios: { type: Number, default: 0 },    // PagoServicio.monto
    egresoReparaciones: { type: Number, default: 0 }, // reparaciones[].costo por fecha
    inversionActivos: { type: Number, default: 0 },   // ActivoSala.costo por fechaCompra (capital)
    egresosOperativos: { type: Number, default: 0 },  // costoVentas + servicios + reparaciones
    totalEgresos: { type: Number, default: 0 },       // egresosOperativos + inversionActivos
    serviciosPorTipo: [desgloseSchema],               // por tipo de servicio

    // ── Detalle de renglones (estructura flexible, solo lectura) ──
    comprasActivos: { type: [mongoose.Schema.Types.Mixed], default: [] },       // qué equipo se compró
    ventasDetalle: { type: [mongoose.Schema.Types.Mixed], default: [] },        // qué productos se vendieron (top 15)
    reparacionesDetalle: { type: [mongoose.Schema.Types.Mixed], default: [] },  // qué se reparó

    // ── RESULTADOS ────────────────────────────
    utilidadBruta: { type: Number, default: 0 },      // totalIngresos - costoVentas
    utilidadOperativa: { type: Number, default: 0 },  // totalIngresos - egresosOperativos
    utilidadNeta: { type: Number, default: 0 },       // totalIngresos - totalEgresos
    margenBruto: { type: Number, default: 0 },        // %
    margenOperativo: { type: Number, default: 0 },    // %
    margenNeto: { type: Number, default: 0 },         // %

    // ── Conteos informativos ──────────────────
    ventasIncluidas: { type: Number, default: 0 },
    playsIncluidos: { type: Number, default: 0 },
    gananciasIncluidas: { type: Number, default: 0 },
    serviciosIncluidos: { type: Number, default: 0 },
    reparacionesIncluidas: { type: Number, default: 0 },
    comprasActivosIncluidas: { type: Number, default: 0 },

    // ── Metadata ──────────────────────────────
    periodoInicio: { type: Date, required: true },
    periodoFin: { type: Date, required: true },
    ultimaActualizacion: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

estadoResultadosSchema.index({ año: 1, mes: 1 }, { unique: true });
estadoResultadosSchema.index({ año: 1 });

export default mongoose.model('EstadoResultados', estadoResultadosSchema);
