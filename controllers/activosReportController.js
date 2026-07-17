// controllers/activosReportController.js
// Módulo de Reportes: Reporte de Activos de la Sala.
//
// Patrón "genera y guarda" (como ventas/plays): el reporte es una foto del
// estado ACTUAL del equipo. Se guarda UN snapshot (ActivosReport, clave 'actual')
// que se regenera en segundo plano en cada escritura de activos/reparaciones.
// El GET solo LEE ese snapshot → carga instantánea, sin recalcular.
//
// Montos: "costo" = compra del producto (cada activo tiene uno).
//         "costoReparaciones" = suma de reparaciones[].costo del activo.
import ActivoSala, { ESTADOS_ACTIVO } from '../models/ActivoSala.js';
import ActivosReport from '../models/ActivosReport.js';

// ─────────────────────────────────────────────────────────────
// Lógica central: construye (sin guardar) el payload del reporte.
// ─────────────────────────────────────────────────────────────
const construirReporteActivos = async () => {
  // Ordenados por número de placa ascendente (los sin placa quedan al final).
  const activos = await ActivoSala.find().sort({ numeroPlaca: 1, createdAt: 1 }).lean();

  // ── KPIs ──
  let conReparacion = 0;
  let sinReparacion = 0;
  let totalReparaciones = 0;
  let totalInvertidoCompras = 0;
  let totalCostoReparaciones = 0;

  // ── Desglose por estado (los 5 SIEMPRE, en 0 si no hay) ──
  //   costoTotal        = suma del costo de COMPRA de los activos en ese estado.
  //   costoReparaciones = suma de reparaciones[].costo de los activos en ese estado.
  const porEstado = {};
  for (const estado of ESTADOS_ACTIVO) {
    porEstado[estado] = { estado, cantidad: 0, costoTotal: 0, costoReparaciones: 0 };
  }

  // ── Desglose con / sin reparación ──
  const porRep = {
    con: { clave: 'con', label: 'Con reparación', cantidad: 0, montoTotal: 0, costoReparaciones: 0 },
    sin: { clave: 'sin', label: 'Sin reparación', cantidad: 0, montoTotal: 0, costoReparaciones: 0 },
  };

  const lista = [];

  for (const activo of activos) {
    const costo = activo.costo || 0;
    const reparaciones = activo.reparaciones || [];
    const numReparaciones = reparaciones.length;
    const costoReparaciones = reparaciones.reduce((suma, r) => suma + (r.costo || 0), 0);

    totalInvertidoCompras += costo;
    totalReparaciones += numReparaciones;
    totalCostoReparaciones += costoReparaciones;

    const grupo = numReparaciones > 0 ? porRep.con : porRep.sin;
    grupo.cantidad++;
    grupo.montoTotal += costo;
    grupo.costoReparaciones += costoReparaciones;
    if (numReparaciones > 0) conReparacion++;
    else sinReparacion++;

    const estado = activo.estado || 'En uso';
    if (!porEstado[estado]) porEstado[estado] = { estado, cantidad: 0, costoTotal: 0, costoReparaciones: 0 };
    porEstado[estado].cantidad++;
    porEstado[estado].costoTotal += costo;
    porEstado[estado].costoReparaciones += costoReparaciones;

    lista.push({
      numeroPlaca: activo.numeroPlaca ?? null,
      nombre: activo.nombre,
      categoria: activo.categoria || 'Otros',
      estado: activo.estado,
      estadoOverride: activo.estadoOverride ?? null,
      costo,
      numReparaciones,
      costoReparaciones,
      fechaCompra: activo.fechaCompra || null,
    });
  }

  return {
    generadoEn: new Date(),
    totalActivos: activos.length,
    conReparacion,
    sinReparacion,
    totalReparaciones,
    totalInvertidoCompras,
    totalCostoReparaciones,
    inversionTotal: totalInvertidoCompras + totalCostoReparaciones,
    porEstado: Object.values(porEstado),
    porReparacion: [porRep.con, porRep.sin],
    activos: lista,
  };
};

// ─────────────────────────────────────────────────────────────
// Regenera y GUARDA el snapshot. Background-safe: NUNCA lanza.
// Se llama tras crear/editar/eliminar activos o reparaciones.
// ─────────────────────────────────────────────────────────────
export const regenerarReporteActivos = async () => {
  try {
    const datos = await construirReporteActivos();
    await ActivosReport.findOneAndUpdate(
      { clave: 'actual' },
      { $set: { ...datos, clave: 'actual' } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    console.log('✅ Reporte de activos actualizado automáticamente');
  } catch (err) {
    console.error('⚠️ Error al regenerar el reporte de activos automáticamente:', err.message);
  }
};

// ============================================
// GET /api/activos-reports — Lee el snapshot guardado (rápido).
// Si aún no existe (primera vez), lo genera y guarda una vez.
// ============================================
export const getReporteActivos = async (req, res) => {
  try {
    let snapshot = await ActivosReport.findOne({ clave: 'actual' }).lean();

    if (!snapshot) {
      // Primera vez / no generado aún: construir y guardar.
      const datos = await construirReporteActivos();
      snapshot = await ActivosReport.findOneAndUpdate(
        { clave: 'actual' },
        { $set: { ...datos, clave: 'actual' } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();
    }

    // Devolver la misma forma de antes: { ok, reporte: {...} } (sin campos internos).
    const { _id, clave, createdAt, updatedAt, __v, ...reporte } = snapshot;
    return res.status(200).json({ ok: true, reporte });
  } catch (error) {
    console.error('❌ Error obteniendo reporte de activos:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.', error: error.message });
  }
};
