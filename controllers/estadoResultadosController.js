// controllers/estadoResultadosController.js
// Módulo de Reportes: Estado de Resultados mensual.
//
// Patrón "genera y guarda" (igual que Plays/Ventas):
//   - POST generar / generar-anio: calcula desde las colecciones crudas y
//     hace upsert en EstadoResultados. Años pasados quedan bloqueados.
//   - GET: solo leen lo guardado (baratos, sin recalcular).
//
// Todas las sumas se hacen con AGREGACIÓN en Mongo ($group/$sum), no cargando
// colecciones a memoria de Node — seguro para Koyeb aunque los datos crezcan.
import EstadoResultados, { NOMBRES_MES } from '../models/EstadoResultados.js';
import Sale from '../models/sale.js';
import Play from '../models/plays.js';
import Ganancia from '../models/Ganancia.js';
import PagoServicio from '../models/PagoServicio.js';
import ActivoSala from '../models/ActivoSala.js';
import Ahorro from '../models/ahorro.js';
import AhorroMovimiento from '../models/AhorroMovimiento.js';
import { crearFiltroMes } from '../utils/dateUtils.js';

// Versión del formato del reporte. Subir este número cada vez que se agreguen
// campos nuevos: los docs guardados con versión menor se regeneran solos (al
// leerlos o en el backfill de arranque) para tomar los campos nuevos.
//   v1: totales + desgloses. v2: + detalle (comprasActivos/ventasDetalle/
//   reparacionesDetalle), comparativo y ahorro.
export const SCHEMA_VERSION = 2;

// Redondea a 1 decimal (para los márgenes en %), igual que SaleReport.
const redondear1 = (n) => Math.round(n * 10) / 10;

// Suma total (y cuenta) de un campo numérico de una colección para el mes dado.
// Devuelve { total, count }.
const sumarCampo = async (Modelo, campo, filtroFecha) => {
  const [agg] = await Modelo.aggregate([
    { $match: { fecha: filtroFecha } },
    { $group: { _id: null, total: { $sum: `$${campo}` }, count: { $sum: 1 } } },
  ]);
  return { total: agg?.total || 0, count: agg?.count || 0 };
};

// Desglose { tipo → monto } de una colección para el mes dado.
const desglosePorTipo = async (Modelo, campoTipo, campoMonto, filtroFecha) => {
  const rows = await Modelo.aggregate([
    { $match: { fecha: filtroFecha } },
    { $group: { _id: `$${campoTipo}`, monto: { $sum: `$${campoMonto}` } } },
    { $sort: { monto: -1 } },
  ]);
  return rows.map((r) => ({ tipo: r._id || 'Sin tipo', monto: r.monto || 0 }));
};

// ─────────────────────────────────────────────────────────────
// Lógica central: construye (sin guardar) el estado de resultados de un mes.
// ─────────────────────────────────────────────────────────────
const construirEstadoMes = async (año, mes) => {
  const filtroFecha = crearFiltroMes(mes, año); // { $gte, $lt }
  const inicio = filtroFecha.$gte;
  const fin = filtroFecha.$lt;

  // ── INGRESOS ──
  const ventas = await Sale.aggregate([
    { $match: { fecha: filtroFecha } },
    { $group: { _id: null, ingreso: { $sum: '$total' }, costo: { $sum: '$totalCosto' }, count: { $sum: 1 } } },
  ]);
  const ingresoVentas = ventas[0]?.ingreso || 0;
  const costoVentas = ventas[0]?.costo || 0;
  const ventasIncluidas = ventas[0]?.count || 0;

  const plays = await sumarCampo(Play, 'montoPagado', filtroFecha);
  const ingresoPlays = plays.total;
  const playsIncluidos = plays.count;

  const ganancias = await sumarCampo(Ganancia, 'monto', filtroFecha);
  const ingresoGanancias = ganancias.total;
  const gananciasIncluidas = ganancias.count;

  const gananciasPorTipo = await desglosePorTipo(Ganancia, 'tipo', 'monto', filtroFecha);

  const totalIngresos = ingresoVentas + ingresoPlays + ingresoGanancias;

  // ── EGRESOS ──
  const servicios = await sumarCampo(PagoServicio, 'monto', filtroFecha);
  const egresoServicios = servicios.total;
  const serviciosIncluidos = servicios.count;
  const serviciosPorTipo = await desglosePorTipo(PagoServicio, 'servicio', 'monto', filtroFecha);

  // Reparaciones: filtrar por la fecha de CADA reparación dentro del arreglo.
  const repAgg = await ActivoSala.aggregate([
    { $unwind: '$reparaciones' },
    { $match: { 'reparaciones.fecha': filtroFecha } },
    { $group: { _id: null, total: { $sum: '$reparaciones.costo' }, count: { $sum: 1 } } },
  ]);
  const egresoReparaciones = repAgg[0]?.total || 0;
  const reparacionesIncluidas = repAgg[0]?.count || 0;

  // Compras de activos: por fechaCompra dentro del mes (inversión de capital).
  const comprasAgg = await ActivoSala.aggregate([
    { $match: { fechaCompra: filtroFecha } },
    { $group: { _id: null, total: { $sum: '$costo' }, count: { $sum: 1 } } },
  ]);
  const inversionActivos = comprasAgg[0]?.total || 0;
  const comprasActivosIncluidas = comprasAgg[0]?.count || 0;

  // ── Detalle de renglones (para la tabla del reporte) ──
  // Compras de activos del mes (suma de .costo === inversionActivos).
  const comprasActivosDocs = await ActivoSala.find({ fechaCompra: filtroFecha })
    .select('nombre categoria costo numeroPlaca fechaCompra')
    .sort({ fechaCompra: 1 })
    .lean();
  const comprasActivos = comprasActivosDocs.map((a) => ({
    nombre: a.nombre,
    categoria: a.categoria || 'Otros',
    costo: a.costo || 0,
    numeroPlaca: a.numeroPlaca ?? null,
    fecha: a.fechaCompra || null,
  }));

  // Reparaciones del mes (suma de .costo === egresoReparaciones).
  const reparacionesDetalle = await ActivoSala.aggregate([
    { $unwind: '$reparaciones' },
    { $match: { 'reparaciones.fecha': filtroFecha } },
    { $sort: { 'reparaciones.fecha': 1 } },
    {
      $project: {
        _id: 0,
        activo: '$nombre',
        costo: '$reparaciones.costo',
        problemaTecnico: '$reparaciones.problemaTecnico',
        fecha: '$reparaciones.fecha',
      },
    },
  ]);

  // Ventas del mes agrupadas por producto (top 15 por ingreso). Si hay más de 15
  // productos distintos, se truncan; la suma de .ingreso puede no cuadrar con
  // ingresoVentas en ese caso (el resto queda fuera del top 15).
  const ventasDetalle = await Sale.aggregate([
    { $match: { fecha: filtroFecha } },
    { $unwind: '$productos' },
    {
      $group: {
        _id: '$productos.nombre',
        cantidad: { $sum: '$productos.cantidad' },
        ingreso: { $sum: '$productos.subtotal' },
        costo: { $sum: '$productos.costoSubtotal' },
      },
    },
    { $sort: { ingreso: -1 } },
    { $limit: 15 },
    { $project: { _id: 0, nombre: '$_id', cantidad: 1, ingreso: 1, costo: 1 } },
  ]);

  const egresosOperativos = costoVentas + egresoServicios + egresoReparaciones;
  const totalEgresos = egresosOperativos + inversionActivos;

  // ── RESULTADOS ──
  const utilidadBruta = totalIngresos - costoVentas;
  const utilidadOperativa = totalIngresos - egresosOperativos;
  const utilidadNeta = totalIngresos - totalEgresos;
  const pct = (parte) => (totalIngresos > 0 ? redondear1((parte / totalIngresos) * 100) : 0);

  return {
    schemaVersion: SCHEMA_VERSION,
    año,
    mes,
    nombreMes: NOMBRES_MES[mes],
    ingresoVentas,
    ingresoPlays,
    ingresoGanancias,
    totalIngresos,
    gananciasPorTipo,
    costoVentas,
    egresoServicios,
    egresoReparaciones,
    inversionActivos,
    egresosOperativos,
    totalEgresos,
    serviciosPorTipo,
    comprasActivos,
    ventasDetalle,
    reparacionesDetalle,
    utilidadBruta,
    utilidadOperativa,
    utilidadNeta,
    margenBruto: pct(utilidadBruta),
    margenOperativo: pct(utilidadOperativa),
    margenNeto: pct(utilidadNeta),
    ventasIncluidas,
    playsIncluidos,
    gananciasIncluidas,
    serviciosIncluidos,
    reparacionesIncluidas,
    comprasActivosIncluidas,
    periodoInicio: inicio,
    periodoFin: fin,
    ultimaActualizacion: new Date(),
  };
};

// Deriva { año, mes } en hora Costa Rica de una fecha UTC guardada.
const anioMesCR = (fecha) => {
  const cr = new Date(new Date(fecha).toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }));
  return { año: cr.getFullYear(), mes: cr.getMonth() + 1 };
};

// Regenera y GUARDA (upsert) el estado de resultados de un mes. Devuelve el doc.
// Puede lanzar: para uso HTTP donde queremos reportar el error.
export const regenerarEstadoDeMes = async (año, mes) => {
  const datos = await construirEstadoMes(año, mes);
  return EstadoResultados.findOneAndUpdate(
    { año, mes },
    { $set: datos },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
};

// Versión "en background" (como Plays/Ventas): regenera el/los mes(es) CR de las
// fechas dadas (sin duplicar), NUNCA lanza. Se llama tras crear/editar/eliminar
// en cualquier fuente (ventas, plays, ganancias, servicios, reparaciones, compras).
// Al editar algo que cambia de mes, pasar la fecha vieja Y la nueva.
export const regenerarEstadoDeFecha = async (...fechas) => {
  const vistos = new Set();
  for (const f of fechas) {
    if (!f) continue;
    const { año, mes } = anioMesCR(f);
    const key = `${año}-${mes}`;
    if (vistos.has(key)) continue;
    vistos.add(key);
    try {
      await regenerarEstadoDeMes(año, mes);
      console.log(`✅ Estado de resultados ${NOMBRES_MES[mes]} ${año} actualizado automáticamente`);
    } catch (err) {
      // No propagar: el dato ya se guardó; el estado se puede regenerar luego.
      console.error('⚠️ Error al regenerar estado de resultados automáticamente:', err.message);
    }
  }
};

// Adjunta datos DERIVADOS que no se guardan en el doc (para que nunca queden
// viejos): el comparativo con el mes anterior y el ahorro acumulado actual.
// El ahorro es SOLO informativo: no entra en ingresos, egresos ni utilidades.
const enriquecerReporte = async (reporte) => {
  const out = { ...reporte };

  // Comparativo: totales del mes anterior (si ya tiene reporte guardado).
  const mesAnt = reporte.mes === 1 ? 12 : reporte.mes - 1;
  const añoAnt = reporte.mes === 1 ? reporte.año - 1 : reporte.año;
  const prev = await EstadoResultados.findOne({ año: añoAnt, mes: mesAnt })
    .select('nombreMes totalIngresos totalEgresos utilidadOperativa utilidadNeta')
    .lean();
  if (prev) {
    out.comparativo = {
      nombreMesAnterior: prev.nombreMes,
      totalIngresos: prev.totalIngresos,
      totalEgresos: prev.totalEgresos,
      utilidadOperativa: prev.utilidadOperativa,
      utilidadNeta: prev.utilidadNeta,
    };
  }

  // Ahorro acumulado (fondo total al momento). Informativo.
  const ahorro = await Ahorro.findOne().select('totalAcumulado').lean();
  if (ahorro) out.ahorroAcumulado = ahorro.totalAcumulado || 0;

  // Ahorro del mes: suma de los movimientos con fecha dentro del mes.
  const [movMes] = await AhorroMovimiento.aggregate([
    { $match: { fecha: crearFiltroMes(reporte.mes, reporte.año) } },
    { $group: { _id: null, total: { $sum: '$monto' } } },
  ]);
  out.ahorroDelMes = movMes?.total || 0;

  return out;
};

// Valida que no se regenere un año ya cerrado (igual que Plays/Ventas).
const anioBloqueado = (año) => año < new Date().getFullYear();

// ─────────────────────────────────────────────────────────────
// POST /api/estado-resultados/generar   { año, mes }
// ─────────────────────────────────────────────────────────────
export const generarEstadoMes = async (req, res) => {
  try {
    const año = parseInt(req.body.año);
    const mes = parseInt(req.body.mes);
    if (!año || !mes || mes < 1 || mes > 12) {
      return res.status(400).json({ ok: false, mensaje: 'Se requieren año y mes (1-12) válidos.' });
    }
    if (anioBloqueado(año)) {
      return res.status(403).json({
        ok: false,
        mensaje: `No se puede regenerar un año anterior. El estado de resultados de ${NOMBRES_MES[mes]} ${año} está bloqueado.`,
      });
    }

    const doc = await regenerarEstadoDeMes(año, mes);
    const reporte = await enriquecerReporte(doc.toObject());
    return res.status(200).json({
      ok: true,
      mensaje: `Estado de resultados de ${NOMBRES_MES[mes]} ${año} generado.`,
      reporte,
    });
  } catch (error) {
    console.error('❌ Error generando estado de resultados:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/estado-resultados/generar-anio   { año }
// ─────────────────────────────────────────────────────────────
export const generarEstadoAnio = async (req, res) => {
  try {
    const año = parseInt(req.body.año);
    if (!año) return res.status(400).json({ ok: false, mensaje: 'Se requiere el año.' });
    if (anioBloqueado(año)) {
      return res.status(403).json({ ok: false, mensaje: `No se puede regenerar el año ${año} (está bloqueado).` });
    }

    const resumen = [];
    for (let mes = 1; mes <= 12; mes++) {
      const reporte = await regenerarEstadoDeMes(año, mes);
      resumen.push({ mes: NOMBRES_MES[mes], totalIngresos: reporte.totalIngresos, utilidadNeta: reporte.utilidadNeta });
    }
    return res.status(200).json({ ok: true, mensaje: `Estados de resultados del año ${año} generados.`, año, resumen });
  } catch (error) {
    console.error('❌ Error generando estados de resultados del año:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/estado-resultados/anos-disponibles
// (va ANTES de las rutas con :año para no colisionar)
// ─────────────────────────────────────────────────────────────
export const getAnosDisponibles = async (req, res) => {
  try {
    const años = await EstadoResultados.distinct('año');
    const añoActual = new Date().getFullYear();
    if (!años.includes(añoActual)) años.push(añoActual);
    años.sort((a, b) => b - a);
    return res.status(200).json({ ok: true, años });
  } catch (error) {
    console.error('❌ Error obteniendo años disponibles:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/estado-resultados/:año/:mes
// ─────────────────────────────────────────────────────────────
export const getEstadoMes = async (req, res) => {
  try {
    const año = parseInt(req.params.año);
    const mes = parseInt(req.params.mes);
    if (!año || !mes || mes < 1 || mes > 12) {
      return res.status(400).json({ ok: false, mensaje: 'Año o mes inválido.' });
    }
    let reporte = await EstadoResultados.findOne({ año, mes }).lean();
    if (!reporte) {
      return res.status(404).json({
        ok: false,
        mensaje: `No existe estado de resultados para ${NOMBRES_MES[mes]} ${año}. Genéralo primero.`,
      });
    }
    // Auto-upgrade: si el guardado quedó con un formato viejo (sin los campos
    // nuevos), se regenera solo antes de responder. Así un mes viejo se
    // actualiza la primera vez que se abre, sin botón de "Regenerar".
    if ((reporte.schemaVersion || 0) < SCHEMA_VERSION) {
      const doc = await regenerarEstadoDeMes(año, mes);
      reporte = doc.toObject();
    }
    return res.status(200).json({ ok: true, reporte: await enriquecerReporte(reporte) });
  } catch (error) {
    console.error('❌ Error obteniendo estado de resultados del mes:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/estado-resultados/:año
// Calendario de 12 meses; los no generados vienen en 0 con generado:false.
// ─────────────────────────────────────────────────────────────
export const getEstadoAnio = async (req, res) => {
  try {
    const año = parseInt(req.params.año);
    if (!año) return res.status(400).json({ ok: false, mensaje: 'Año inválido.' });

    // Auto-upgrade: regenerar los meses de este año que quedaron con formato viejo.
    const viejos = await EstadoResultados.find(
      { año, $or: [{ schemaVersion: { $lt: SCHEMA_VERSION } }, { schemaVersion: { $exists: false } }] },
      'mes'
    ).lean();
    for (const v of viejos) await regenerarEstadoDeMes(año, v.mes);

    const generados = await EstadoResultados.find({ año })
      .select('mes nombreMes totalIngresos totalEgresos utilidadOperativa utilidadNeta margenNeto ultimaActualizacion')
      .sort({ mes: 1 })
      .lean();

    const meses = Array.from({ length: 12 }, (_, i) => {
      const mesNum = i + 1;
      const existente = generados.find((r) => r.mes === mesNum);
      if (existente) return { ...existente, generado: true };
      return {
        año,
        mes: mesNum,
        nombreMes: NOMBRES_MES[mesNum],
        totalIngresos: 0,
        totalEgresos: 0,
        utilidadOperativa: 0,
        utilidadNeta: 0,
        margenNeto: 0,
        generado: false,
      };
    });

    return res.status(200).json({ ok: true, año, meses });
  } catch (error) {
    console.error('❌ Error obteniendo estados de resultados del año:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.', error: error.message });
  }
};
