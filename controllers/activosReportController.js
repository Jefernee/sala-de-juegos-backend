// controllers/activosReportController.js
// Hecho por Claude Code — Módulo de Reportes: Reporte de Activos de la Sala.
//
// Reporte tipo "snapshot": fotografía completa del estado actual de los activos.
// A diferencia de los reportes de ventas/plays (que son mensuales), los activos
// son un inventario de equipo, así que el reporte muestra TODO de una vez:
//   - Totales: cantidad de activos, inversión en compras, costo de reparaciones.
//   - Desglose por estado (En uso, En reparación, etc.).
//   - Desglose por tipo de registro (Nueva Compra / Reparación).
//   - Lista completa de activos con su número de placa.
//
// Nota sobre montos:
//   - "costo" se cuenta como inversión solo en registros de tipo "Nueva Compra"
//     (en una reparación, "costo" es el costo del producto y NO se vuelve a sumar).
//   - "costoReparacion" se cuenta solo en registros de tipo "Reparación".
import ActivoSala, { TIPOS_REGISTRO, ESTADOS_ACTIVO } from '../models/ActivoSala.js';

// ============================================
// GET /api/activos-reports
// Genera el reporte completo de activos al momento (no se almacena).
// ============================================
export const getReporteActivos = async (req, res) => {
  try {
    // Ordenados por número de placa ascendente (los sin placa quedan al final).
    const activos = await ActivoSala.find().sort({ numeroPlaca: 1, createdAt: 1 }).lean();

    // ── Totales generales ────────────────────────────
    let totalCompras = 0;
    let totalReparaciones = 0;
    let totalInvertidoCompras = 0;   // suma de "costo" en Nueva Compra
    let totalCostoReparaciones = 0;  // suma de "costoReparacion" en Reparación

    // ── Mapas de desglose ────────────────────────────
    // Inicializados con todos los valores posibles para que ninguno falte,
    // aunque tengan 0 (reporte "completo").
    const porEstado = {};
    for (const estado of ESTADOS_ACTIVO) {
      porEstado[estado] = { estado, cantidad: 0, costoTotal: 0 };
    }
    const porTipo = {};
    for (const tipo of TIPOS_REGISTRO) {
      porTipo[tipo] = { tipoRegistro: tipo, cantidad: 0, montoTotal: 0 };
    }

    for (const activo of activos) {
      const costo = activo.costo || 0;
      const costoRep = activo.costoReparacion || 0;

      if (activo.tipoRegistro === 'Reparación') {
        totalReparaciones++;
        totalCostoReparaciones += costoRep;
      } else {
        totalCompras++;
        totalInvertidoCompras += costo;
      }

      // Por estado: cantidad y suma del costo del producto.
      const estado = activo.estado || 'En uso';
      if (!porEstado[estado]) porEstado[estado] = { estado, cantidad: 0, costoTotal: 0 };
      porEstado[estado].cantidad++;
      porEstado[estado].costoTotal += costo;

      // Por tipo: cantidad y monto (compra usa costo, reparación usa costoReparacion).
      const tipo = activo.tipoRegistro || 'Nueva Compra';
      if (!porTipo[tipo]) porTipo[tipo] = { tipoRegistro: tipo, cantidad: 0, montoTotal: 0 };
      porTipo[tipo].cantidad++;
      porTipo[tipo].montoTotal += tipo === 'Reparación' ? costoRep : costo;
    }

    const inversionTotal = totalInvertidoCompras + totalCostoReparaciones;

    // ── Lista limpia de activos para mostrar ─────────
    const lista = activos.map((a) => ({
      _id: a._id,
      numeroPlaca: a.numeroPlaca ?? null,
      nombre: a.nombre,
      tipoRegistro: a.tipoRegistro,
      estado: a.estado,
      costo: a.costo || 0,
      costoReparacion: a.costoReparacion || null,
      descripcion: a.descripcion || null,
      numeroFactura: a.numeroFactura || null,
      problemaTecnico: a.problemaTecnico || null,
      reparadoPor: a.reparadoPor || null,
      fechaCompraReparacion: a.fechaCompraReparacion || null,
      imagenUrl: a.imagenUrl || null,
      createdAt: a.createdAt,
    }));

    return res.status(200).json({
      ok: true,
      reporte: {
        generadoEn: new Date(),
        totalActivos: activos.length,
        totalCompras,
        totalReparaciones,
        totalInvertidoCompras,
        totalCostoReparaciones,
        inversionTotal,
        porEstado: Object.values(porEstado),
        porTipo: Object.values(porTipo),
        activos: lista,
      },
    });
  } catch (error) {
    console.error('❌ Error generando reporte de activos:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.', error: error.message });
  }
};
