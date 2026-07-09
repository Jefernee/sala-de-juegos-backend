// controllers/activosReportController.js
// Hecho por Claude Code — Módulo de Reportes: Reporte de Activos de la Sala.
//
// Reporte tipo "snapshot": fotografía completa del estado actual de los activos.
// Es "solo números": KPIs (tarjetas) + desgloses (por estado y con/sin reparación)
// + una tabla con un objeto por activo. SIN filtros ni buscador (eso vive en
// Administración). La respuesta va envuelta en { ok: true, reporte: {...} }.
//
// Montos:
//   - "costo" = inversión en la COMPRA del producto (cada activo tiene uno).
//   - reparaciones: se suma el costo de TODAS las reparaciones[].costo de cada activo.
import ActivoSala, { ESTADOS_ACTIVO } from '../models/ActivoSala.js';

// ============================================
// GET /api/activos-reports
// Genera el reporte completo de activos al momento (no se almacena).
// ============================================
export const getReporteActivos = async (req, res) => {
  try {
    // Ordenados por número de placa ascendente (los sin placa quedan al final).
    const activos = await ActivoSala.find().sort({ numeroPlaca: 1, createdAt: 1 }).lean();

    // ── KPIs ─────────────────────────────────────────
    let conReparacion = 0;
    let sinReparacion = 0;
    let totalReparaciones = 0;
    let totalInvertidoCompras = 0;
    let totalCostoReparaciones = 0;

    // ── Desglose por estado ──────────────────────────
    // Inicializado con los 5 estados SIEMPRE (en 0 si no hay). Cada fila lleva
    // DOS montos separados para no confundirlos:
    //   costoTotal        = suma del costo de COMPRA de los activos en ese estado.
    //   costoReparaciones = suma de reparaciones[].costo de los activos en ese estado.
    const porEstado = {};
    for (const estado of ESTADOS_ACTIVO) {
      porEstado[estado] = { estado, cantidad: 0, costoTotal: 0, costoReparaciones: 0 };
    }

    // ── Desglose con / sin reparación ────────────────
    //   montoTotal        = suma del costo de COMPRA de los activos del grupo.
    //   costoReparaciones = suma de reparaciones[].costo de los activos del grupo.
    const porRep = {
      con: { clave: 'con', label: 'Con reparación', cantidad: 0, montoTotal: 0, costoReparaciones: 0 },
      sin: { clave: 'sin', label: 'Sin reparación', cantidad: 0, montoTotal: 0, costoReparaciones: 0 },
    };

    // ── Tabla: un objeto por activo ──────────────────
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

    const inversionTotal = totalInvertidoCompras + totalCostoReparaciones;

    return res.status(200).json({
      ok: true,
      reporte: {
        generadoEn: new Date(),
        totalActivos: activos.length,
        conReparacion,
        sinReparacion,
        totalReparaciones,
        totalInvertidoCompras,
        totalCostoReparaciones,
        inversionTotal,
        porEstado: Object.values(porEstado),
        porReparacion: [porRep.con, porRep.sin],
        activos: lista,
      },
    });
  } catch (error) {
    console.error('❌ Error generando reporte de activos:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.', error: error.message });
  }
};
