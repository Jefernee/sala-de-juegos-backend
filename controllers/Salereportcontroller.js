import Sale       from '../models/sale.js';
import SaleReport  from '../models/Salereport.js';

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
const NOMBRES_MES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function rangoCR(año, mes) {
  const inicio = new Date(Date.UTC(año, mes - 1, 1, 6, 0, 0, 0));
  const fin    = new Date(Date.UTC(año, mes,     1, 6, 0, 0, 0));
  return { inicio, fin };
}

function diaCR(fechaUTC) {
  return new Date(fechaUTC.getTime() - 6 * 60 * 60 * 1000).getUTCDate();
}

// ─────────────────────────────────────────────────────────────────
// Lógica central: construir el reporte de un mes
// ─────────────────────────────────────────────────────────────────
async function buildMonthReport(año, mes) {
  const { inicio, fin } = rangoCR(año, mes);

  const ventas = await Sale.find({ fecha: { $gte: inicio, $lt: fin } }).lean();
  if (!ventas.length) return null;

  // ── Acumuladores globales ────────────────────────────────────────
  let totalRecaudado       = 0;
  let totalMontoPagado     = 0;
  let totalVuelto          = 0;
  let totalUnidadesVendidas = 0;
  let totalCosto           = 0;

  const empleadoMap = new Map(); // key: nombreUsuario
  const productoMap = new Map(); // key: productoId.toString()
  const diaMap      = new Map(); // key: número de día

  for (const venta of ventas) {
    const rec      = venta.total    || 0;
    const costo    = venta.totalCosto || 0;   // ← campo nuevo en Sale
    const ganancia = venta.ganancia  || rec - costo;

    totalRecaudado   += rec;
    totalMontoPagado += venta.montoPagado || 0;
    totalVuelto      += venta.vuelto      || 0;
    totalCosto       += costo;

    // ── Por empleado ────────────────────────────────────────────────
    const empKey = venta.nombreUsuario || 'Desconocido';
    if (!empleadoMap.has(empKey)) {
      empleadoMap.set(empKey, {
        usuarioId:      venta.usuario       || null,
        nombre:         venta.nombreUsuario || 'Desconocido',
        email:          venta.emailUsuario  || '',
        totalVentas:    0,
        totalRecaudado: 0,
        totalCosto:     0,
        ganancia:       0,
      });
    }
    const emp = empleadoMap.get(empKey);
    emp.totalVentas    += 1;
    emp.totalRecaudado += rec;
    emp.totalCosto     += costo;
    emp.ganancia       += ganancia;

    // ── Por día CR ──────────────────────────────────────────────────
    const dia = diaCR(new Date(venta.fecha));
    if (!diaMap.has(dia)) {
      diaMap.set(dia, { dia, totalVentas: 0, totalRecaudado: 0, ganancia: 0 });
    }
    const diaEntry = diaMap.get(dia);
    diaEntry.totalVentas    += 1;
    diaEntry.totalRecaudado += rec;
    diaEntry.ganancia       += ganancia;

    // ── Por producto ────────────────────────────────────────────────
    for (const item of venta.productos || []) {
      const pid         = item.productoId?.toString() || item.nombre;
      const uds         = item.cantidad      || 0;
      const sub         = item.subtotal      || 0;
      const costoItem   = item.costoSubtotal || 0;   // ← campo nuevo en Sale
      const gananciaItem = sub - costoItem;

      totalUnidadesVendidas += uds;

      if (!productoMap.has(pid)) {
        productoMap.set(pid, {
          productoId:     item.productoId || null,
          nombre:         item.nombre     || 'Sin nombre',
          totalVendido:   0,
          totalRecaudado: 0,
          totalCosto:     0,
          ganancia:       0,
          vecesEnVentas:  0,
        });
      }
      const prod = productoMap.get(pid);
      prod.totalVendido   += uds;
      prod.totalRecaudado += sub;
      prod.totalCosto     += costoItem;
      prod.ganancia       += gananciaItem;
      prod.vecesEnVentas  += 1;
    }
  }

  // ── Post-procesado ───────────────────────────────────────────────
  const totalVentas    = ventas.length;
  const gananciaTotal  = totalRecaudado - totalCosto;
  const margenPromedio = totalRecaudado > 0
    ? Math.round((gananciaTotal / totalRecaudado) * 100 * 10) / 10
    : 0;
  const ticketPromedio = totalVentas > 0 ? totalRecaudado / totalVentas : 0;

  const porEmpleado = [...empleadoMap.values()]
    .map((e) => ({
      ...e,
      ticketPromedio: e.totalVentas > 0 ? e.totalRecaudado / e.totalVentas : 0,
    }))
    .sort((a, b) => b.totalRecaudado - a.totalRecaudado);

  const productosMasVendidos = [...productoMap.values()]
    .sort((a, b) => b.totalVendido - a.totalVendido);

  const porDia = [...diaMap.values()].sort((a, b) => a.dia - b.dia);

  return {
    año,
    mes,
    nombreMes:            NOMBRES_MES[mes],
    totalVentas,
    totalRecaudado,
    totalMontoPagado,
    totalVuelto,
    ticketPromedio,
    totalUnidadesVendidas,
    totalCosto,
    gananciaTotal,
    margenPromedio,
    porEmpleado,
    productosMasVendidos,
    porDia,
    ultimaActualizacion:  new Date(),
    periodoInicio:        inicio,
    periodoFin:           fin,
    ventasIncluidas:      totalVentas,
  };
}

// ─────────────────────────────────────────────────────────────────
// POST /api/ventas-reports/generate   { año, mes }
// ─────────────────────────────────────────────────────────────────
export const generateMonthReport = async (req, res) => {
  const { año, mes } = req.body;
  if (!año || !mes || mes < 1 || mes > 12) {
    return res.status(400).json({ error: 'Parámetros inválidos. Envía año y mes (1-12).' });
  }
  try {
    const datos = await buildMonthReport(Number(año), Number(mes));
    if (!datos) {
      return res.status(404).json({ ok: false, error: 'No se encontraron ventas para este período.' });
    }
    const reporte = await SaleReport.findOneAndUpdate(
      { año: datos.año, mes: datos.mes },
      datos,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(200).json({ ok: true, reporte });
  } catch (err) {
    console.error('❌ generateMonthReport:', err);
    return res.status(500).json({ error: 'Error al generar el reporte.', detalle: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// POST /api/ventas-reports/generate-year   { año }
// ─────────────────────────────────────────────────────────────────
export const generateYearReports = async (req, res) => {
  const { año } = req.body;
  if (!año) return res.status(400).json({ error: 'Falta el parámetro año.' });
  try {
    const resultados = [];
    for (let mes = 1; mes <= 12; mes++) {
      const datos = await buildMonthReport(Number(año), mes);
      if (!datos) continue;
      const reporte = await SaleReport.findOneAndUpdate(
        { año: datos.año, mes: datos.mes },
        datos,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      resultados.push({ mes, nombreMes: NOMBRES_MES[mes], ok: true, ventasIncluidas: reporte.ventasIncluidas });
    }
    return res.status(200).json({ ok: true, año: Number(año), mesesGenerados: resultados.length, detalle: resultados });
  } catch (err) {
    console.error('❌ generateYearReports:', err);
    return res.status(500).json({ error: 'Error al generar el reporte anual.', detalle: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/ventas-reports/:año/:mes
// ─────────────────────────────────────────────────────────────────
export const getMonthReport = async (req, res) => {
  const año = Number(req.params.año);
  const mes = Number(req.params.mes);
  if (!año || !mes || mes < 1 || mes > 12) {
    return res.status(400).json({ error: 'Parámetros inválidos.' });
  }
  try {
    const reporte = await SaleReport.findOne({ año, mes });
    if (!reporte) {
      return res.status(404).json({ ok: false, error: 'Reporte no encontrado. Presiona Regenerar para generarlo.' });
    }
    return res.status(200).json({ ok: true, reporte });
  } catch (err) {
    console.error('❌ getMonthReport:', err);
    return res.status(500).json({ error: 'Error al obtener el reporte.', detalle: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/ventas-reports/:año
// ─────────────────────────────────────────────────────────────────
export const getYearReport = async (req, res) => {
  const año = Number(req.params.año);
  if (!año) return res.status(400).json({ error: 'Falta el parámetro año.' });
  try {
    const meses = await SaleReport.find({ año })
      .select('mes nombreMes totalVentas totalRecaudado totalCosto gananciaTotal margenPromedio ticketPromedio totalUnidadesVendidas ultimaActualizacion')
      .sort({ mes: 1 })
      .lean();

    const calendario = Array.from({ length: 12 }, (_, i) => {
      return meses.find((m) => m.mes === i + 1) || {
        mes:                   i + 1,
        nombreMes:             NOMBRES_MES[i + 1],
        totalVentas:           0,
        totalRecaudado:        0,
        totalCosto:            0,
        gananciaTotal:         0,
        margenPromedio:        0,
        ticketPromedio:        0,
        totalUnidadesVendidas: 0,
      };
    });

    return res.status(200).json({ ok: true, año, meses: calendario });
  } catch (err) {
    console.error('❌ getYearReport:', err);
    return res.status(500).json({ error: 'Error al obtener el reporte anual.', detalle: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/ventas-reports/anos-disponibles
// ─────────────────────────────────────────────────────────────────
export const getAnosDisponibles = async (req, res) => {
  try {
    const años = await SaleReport.distinct('año');
    const añoActual = new Date().getFullYear();
    if (!años.includes(añoActual)) años.push(añoActual);
    return res.status(200).json({ ok: true, años: años.sort((a, b) => b - a) });
  } catch (err) {
    console.error('❌ getAnosDisponibles:', err);
    return res.status(500).json({ error: 'Error al obtener años disponibles.', detalle: err.message });
  }
};