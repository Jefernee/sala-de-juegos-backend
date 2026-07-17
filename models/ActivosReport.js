// models/ActivosReport.js
// Snapshot guardado del Reporte de Activos.
//
// A diferencia de ventas/plays (mensuales), el reporte de activos es una
// "foto" del estado ACTUAL de todo el equipo, así que se guarda UN solo
// documento (clave: 'actual') que se regenera en segundo plano cada vez que
// se crea/edita/elimina un activo o una reparación. Ver el reporte solo LEE
// este documento (rápido, sin recalcular).
import mongoose from 'mongoose';

const activosReportSchema = new mongoose.Schema(
  {
    // Clave fija: siempre hay un único snapshot "actual".
    clave: { type: String, default: 'actual', unique: true },

    generadoEn: { type: Date, default: Date.now },

    // ── KPIs ──
    totalActivos: { type: Number, default: 0 },
    conReparacion: { type: Number, default: 0 },
    sinReparacion: { type: Number, default: 0 },
    totalReparaciones: { type: Number, default: 0 },
    totalInvertidoCompras: { type: Number, default: 0 },
    totalCostoReparaciones: { type: Number, default: 0 },
    inversionTotal: { type: Number, default: 0 },

    // ── Desgloses y tabla (estructura flexible: son solo de lectura) ──
    porEstado: { type: [mongoose.Schema.Types.Mixed], default: [] },
    porReparacion: { type: [mongoose.Schema.Types.Mixed], default: [] },
    activos: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model('ActivosReport', activosReportSchema);
