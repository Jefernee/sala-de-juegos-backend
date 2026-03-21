import Play from '../models/plays.js';
import MonthlyReport from '../models/Monthlyplaysreport.js';


// ─────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────

const NOMBRES_MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril',
  'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const getRangoMesUTC = (año, mes) => {
  const inicio = new Date(Date.UTC(año, mes - 1, 1, 6, 0, 0, 0));
  const fin    = new Date(Date.UTC(año, mes,     1, 5, 59, 59, 999));
  return { inicio, fin };
};

const getDiaCR = (fechaUTC) => {
  const cr = new Date(fechaUTC.toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }));
  return cr.getDate();
};

const calcularReporte = (plays, año, mes, periodoInicio, periodoFin) => {
  const empleadosMap = {};
  const lugaresMap   = {};
  const diasMap      = {};
  const juegosMap    = {}; // ← nuevo

  let totalSesiones              = 0;
  let totalRecaudado             = 0;
  let totalSubtotales            = 0;
  let totalCostosControles       = 0;
  let totalPlay4                 = 0;
  let totalPlay5                 = 0;
  let totalPingPong              = 0;
  let sesionesCompletadas        = 0;
  let sesionesPendientes         = 0;
  let sesionesEnProceso          = 0;
  let tiempoTotalPagadoMinutos   = 0;
  let tiempoTotalPendienteMinutos= 0;
  let totalControlesAdicionales  = 0;

  for (const play of plays) {
    totalSesiones++;
    totalRecaudado              += play.total          || 0;
    totalSubtotales             += play.subtotal       || 0;
    totalCostosControles        += play.costoControles || 0;
    totalPlay4                  += play.totalPlay4     || 0;
    totalPlay5                  += play.totalPlay5     || 0;
    totalPingPong               += play.totalPingPong  || 0;
    tiempoTotalPagadoMinutos    += play.tiempoPagado   || 0;
    tiempoTotalPendienteMinutos += play.tiempoPendiente|| 0;
    totalControlesAdicionales   += play.controlAdicional || 0;

    if (play.estadoPago === 'Completado')  sesionesCompletadas++;
    else if (play.estadoPago === 'Pendiente') sesionesPendientes++;
    else sesionesEnProceso++;

    // ── Por empleado ──────────────────────────
    const emp = play.atendio || 'Desconocido';
    if (!empleadosMap[emp]) {
      empleadosMap[emp] = {
        nombre: emp,
        totalSesiones: 0, totalRecaudado: 0,
        totalPlay4: 0, totalPlay5: 0, totalPingPong: 0,
        totalControlesAdicionales: 0, tiempoTotalMinutos: 0,
      };
    }
    empleadosMap[emp].totalSesiones++;
    empleadosMap[emp].totalRecaudado          += play.total          || 0;
    empleadosMap[emp].totalPlay4              += play.totalPlay4     || 0;
    empleadosMap[emp].totalPlay5              += play.totalPlay5     || 0;
    empleadosMap[emp].totalPingPong           += play.totalPingPong  || 0;
    empleadosMap[emp].totalControlesAdicionales += play.controlAdicional || 0;
    empleadosMap[emp].tiempoTotalMinutos      += play.tiempoPagado   || 0;

    // ── Por lugar ─────────────────────────────
    const lugar = play.lugarDeJuego || 'Desconocido';
    if (!lugaresMap[lugar]) {
      lugaresMap[lugar] = { lugar, totalSesiones: 0, totalRecaudado: 0, tiempoTotalMinutos: 0 };
    }
    lugaresMap[lugar].totalSesiones++;
    lugaresMap[lugar].totalRecaudado    += play.total        || 0;
    lugaresMap[lugar].tiempoTotalMinutos += play.tiempoPagado || 0;

    // ── Por día ───────────────────────────────
    const dia = getDiaCR(play.fecha);
    if (!diasMap[dia]) {
      diasMap[dia] = { dia, totalSesiones: 0, totalRecaudado: 0, totalPlay4: 0, totalPlay5: 0, totalPingPong: 0 };
    }
    diasMap[dia].totalSesiones++;
    diasMap[dia].totalRecaudado += play.total       || 0;
    diasMap[dia].totalPlay4     += play.totalPlay4  || 0;
    diasMap[dia].totalPlay5     += play.totalPlay5  || 0;
    diasMap[dia].totalPingPong  += play.totalPingPong || 0;

    // ── Juegos jugados ────────────────────────
    // juegosJugados es un array de strings, ej: ["FIFA 25", "GTA V"]
    const juegos = Array.isArray(play.juegosJugados) ? play.juegosJugados : [];
    for (const juego of juegos) {
      if (!juego) continue;
      const key = juego.trim();
      if (!juegosMap[key]) {
        juegosMap[key] = { nombre: key, vecesJugado: 0 };
      }
      juegosMap[key].vecesJugado++;
    }
  }

  // Ordenar juegos de mayor a menor
  const juegosMasJugados = Object.values(juegosMap)
    .sort((a, b) => b.vecesJugado - a.vecesJugado);

  return {
    año,
    mes,
    nombreMes: NOMBRES_MESES[mes - 1],
    totalSesiones,
    totalRecaudado,
    totalSubtotales,
    totalCostosControles,
    totalPlay4,
    totalPlay5,
    totalPingPong,
    sesionesCompletadas,
    sesionesPendientes,
    sesionesEnProceso,
    tiempoTotalPagadoMinutos,
    tiempoTotalPendienteMinutos,
    totalControlesAdicionales,
    porEmpleado: Object.values(empleadosMap),
    porLugar: Object.values(lugaresMap),
    porDia: Object.values(diasMap).sort((a, b) => a.dia - b.dia),
    juegosMasJugados,
    ultimaActualizacion: new Date(),
    periodoInicio,
    periodoFin,
    playsIncluidos: plays.length,
  };
};

// ─────────────────────────────────────────────
// CONTROLADORES PÚBLICOS
// ─────────────────────────────────────────────

export const generarReporteMensual = async (req, res) => {
  try {
    const { año, mes } = req.body;
    if (!año || !mes || mes < 1 || mes > 12) {
      return res.status(400).json({ ok: false, mensaje: 'Se requieren año (número) y mes (1-12) válidos.' });
    }
    const { inicio, fin } = getRangoMesUTC(año, mes);
    const plays = await Play.find({ fecha: { $gte: inicio, $lte: fin } }).lean();
    const datosReporte = calcularReporte(plays, año, mes, inicio, fin);
    const reporte = await MonthlyReport.findOneAndUpdate(
      { año, mes },
      { $set: datosReporte },
      { upsert: true, new: true, runValidators: true }
    );
    return res.status(200).json({
      ok: true,
      mensaje: `Reporte de ${NOMBRES_MESES[mes - 1]} ${año} generado correctamente.`,
      reporte,
    });
  } catch (error) {
    console.error('Error generando reporte mensual:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.', error: error.message });
  }
};

export const generarReporteAnual = async (req, res) => {
  try {
    const { año } = req.body;
    if (!año) return res.status(400).json({ ok: false, mensaje: 'Se requiere el año.' });

    const resultados = [];
    for (let mes = 1; mes <= 12; mes++) {
      const { inicio, fin } = getRangoMesUTC(año, mes);
      const plays = await Play.find({ fecha: { $gte: inicio, $lte: fin } }).lean();
      const datosReporte = calcularReporte(plays, año, mes, inicio, fin);
      const reporte = await MonthlyReport.findOneAndUpdate(
        { año, mes },
        { $set: datosReporte },
        { upsert: true, new: true, runValidators: true }
      );
      resultados.push({
        mes: NOMBRES_MESES[mes - 1],
        sesiones: reporte.totalSesiones,
        recaudado: reporte.totalRecaudado,
      });
    }
    return res.status(200).json({
      ok: true,
      mensaje: `Reportes del año ${año} generados correctamente.`,
      año,
      resumen: resultados,
    });
  } catch (error) {
    console.error('Error generando reporte anual:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.', error: error.message });
  }
};

export const getReportesPorAño = async (req, res) => {
  try {
    const año = parseInt(req.params.año);
    if (isNaN(año)) return res.status(400).json({ ok: false, mensaje: 'Año inválido.' });

    const reportes = await MonthlyReport.find({ año }).sort({ mes: 1 }).lean();
    const mesesCompletos = Array.from({ length: 12 }, (_, i) => {
      const mesNum = i + 1;
      const existente = reportes.find((r) => r.mes === mesNum);
      return existente || {
        año, mes: mesNum, nombreMes: NOMBRES_MESES[i],
        totalSesiones: 0, totalRecaudado: 0,
        totalPlay4: 0, totalPlay5: 0, totalPingPong: 0,
        generado: false,
      };
    });
    return res.status(200).json({ ok: true, año, meses: mesesCompletos });
  } catch (error) {
    console.error('Error obteniendo reportes por año:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.', error: error.message });
  }
};

export const getReporteMensual = async (req, res) => {
  try {
    const año = parseInt(req.params.año);
    const mes = parseInt(req.params.mes);
    if (isNaN(año) || isNaN(mes) || mes < 1 || mes > 12) {
      return res.status(400).json({ ok: false, mensaje: 'Año o mes inválido.' });
    }
    const reporte = await MonthlyReport.findOne({ año, mes }).lean();
    if (!reporte) {
      return res.status(404).json({
        ok: false,
        mensaje: `No existe reporte para ${NOMBRES_MESES[mes - 1]} ${año}. Genéralo primero.`,
      });
    }
    return res.status(200).json({ ok: true, reporte });
  } catch (error) {
    console.error('Error obteniendo reporte mensual:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.', error: error.message });
  }
};

export const getAnosDisponibles = async (req, res) => {
  try {
    const años = await MonthlyReport.distinct('año');
    años.sort((a, b) => b - a);
    return res.status(200).json({ ok: true, años });
  } catch (error) {
    console.error('Error obteniendo años disponibles:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.', error: error.message });
  }
};

export const compararAños = async (req, res) => {
  try {
    const año1 = parseInt(req.query.año1);
    const año2 = parseInt(req.query.año2);
    if (isNaN(año1) || isNaN(año2)) {
      return res.status(400).json({ ok: false, mensaje: 'Se requieren año1 y año2 como parámetros.' });
    }
    const [reportesAño1, reportesAño2] = await Promise.all([
      MonthlyReport.find({ año: año1 }, 'mes nombreMes totalRecaudado totalSesiones totalPlay4 totalPlay5 totalPingPong').lean(),
      MonthlyReport.find({ año: año2 }, 'mes nombreMes totalRecaudado totalSesiones totalPlay4 totalPlay5 totalPingPong').lean(),
    ]);
    const comparacion = Array.from({ length: 12 }, (_, i) => {
      const mesNum = i + 1;
      const r1 = reportesAño1.find((r) => r.mes === mesNum);
      const r2 = reportesAño2.find((r) => r.mes === mesNum);
      return {
        mes: mesNum,
        nombreMes: NOMBRES_MESES[i],
        [año1]: r1 ? { totalRecaudado: r1.totalRecaudado, totalSesiones: r1.totalSesiones } : null,
        [año2]: r2 ? { totalRecaudado: r2.totalRecaudado, totalSesiones: r2.totalSesiones } : null,
      };
    });
    return res.status(200).json({ ok: true, año1, año2, comparacion });
  } catch (error) {
    console.error('Error comparando años:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.', error: error.message });
  }
};