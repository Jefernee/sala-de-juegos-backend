// controllers/playsController.js
import Play from '../models/plays.js';
import MonthlyReport from '../models/Monthlyplaysreport.js';
import { getUTCDateRanges } from '../utils/dateUtils.js';
import { notificarFinSesion } from '../utils/notificacionesWhatsApp.js';

// ─────────────────────────────────────────────────────────────────
// Helpers de costo y tipo
// ─────────────────────────────────────────────────────────────────

const calcularCostos = (lugarDeJuego, tiempoPagado, controlAdicional) => {
  let precioPorHora = 0;
  if (lugarDeJuego.includes('Play 5'))      precioPorHora = 1000;
  else if (lugarDeJuego.includes('Play 4')) precioPorHora = 800;
  else if (lugarDeJuego === 'Ping Pong')    precioPorHora = 800;
  const subtotal      = (tiempoPagado / 60) * precioPorHora;
  const costoControles = controlAdicional * 200;
  return { subtotal: Math.round(subtotal), costoControles, total: Math.round(subtotal + costoControles) };
};

const determinarTipoPlay = (lugarDeJuego) => {
  if (lugarDeJuego.includes('Play 5')) return 'Play 5';
  if (lugarDeJuego.includes('Play 4')) return 'Play 4';
  if (lugarDeJuego === 'Ping Pong')    return 'Ping Pong';
  return '';
};

// ─────────────────────────────────────────────────────────────────
// Fin de sesión para notificaciones WhatsApp (ver utils/finSesionScheduler.js
// y atlas/finSesionTrigger.js).
//
// finProgramado debe salir del MISMO origen y con la MISMA precisión que la UI,
// para que BD, interfaz y notificación digan siempre lo mismo. La UI muestra
// horaInicio/horaFinal (strings a minutos enteros). Por eso finProgramado se
// deriva de horaFinal (la hora de fin exacta que ve el encargado), anclada al
// día CR de la creación y con segundos en cero. Respaldos si horaFinal falla.
// ─────────────────────────────────────────────────────────────────

const DIA_MS = 24 * 60 * 60 * 1000;
const CR_OFFSET_MS = 6 * 60 * 60 * 1000; // Costa Rica = UTC-6 (sin horario de verano)

// Parsea "5:30 PM", "17:30", "12:30 AM", etc. → { h, min } en 24h. null si no matchea.
const parseHoraComponentes = (str) => {
  if (!str) return null;
  const s = String(str).trim();
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  const esPM = /p\.?\s*m\.?/i.test(s);
  const esAM = /a\.?\s*m\.?/i.test(s);
  if (esPM && h < 12) h += 12;   // 5 PM → 17
  if (esAM && h === 12) h = 0;   // 12 AM → 0
  return { h, min };
};

// Date (UTC) de una hora de pared CR (comp) en el día CR del instante refMs.
// CR wall-clock → UTC sumando 6h (Date.UTC absorbe el desborde de día si h+6 >= 24).
const fechaEnDiaCR = (comp, refMs) => {
  const crRef = new Date(refMs - CR_OFFSET_MS);
  return new Date(Date.UTC(
    crRef.getUTCFullYear(), crRef.getUTCMonth(), crRef.getUTCDate(),
    comp.h + 6, comp.min, 0, 0,
  ));
};

/**
 * Calcula finProgramado con el mismo origen que la UI. Nunca lanza.
 * 1º) desde horaFinal; 2º) horaInicio + tiempoPagado; 3º) Date.now() + tiempoPagado.
 * Contempla el cruce de medianoche.
 * @param {string} horaInicio
 * @param {string} horaFinal
 * @param {number} tiempoPagado - minutos
 * @param {number} [refMs] - instante de referencia (default: ahora)
 * @returns {Date|null}
 */
const calcularFinProgramado = (horaInicio, horaFinal, tiempoPagado, refMs = Date.now()) => {
  const minutos = Number(tiempoPagado);
  const compInicio = parseHoraComponentes(horaInicio);

  // 1º) Origen preferido: horaFinal (lo que la UI muestra como fin)
  const compFin = parseHoraComponentes(horaFinal);
  if (compFin) {
    let fin = fechaEnDiaCR(compFin, refMs);
    // Guardia de medianoche: si el fin quedó en/antes del inicio, es de mañana.
    if (compInicio) {
      const inicio = fechaEnDiaCR(compInicio, refMs);
      if (fin.getTime() <= inicio.getTime()) fin = new Date(fin.getTime() + DIA_MS);
    } else if (fin.getTime() < refMs) {
      fin = new Date(fin.getTime() + DIA_MS);
    }
    return fin;
  }

  // 2º) Respaldo: horaInicio + tiempoPagado
  if (compInicio && Number.isFinite(minutos) && minutos > 0) {
    console.warn('⚠️ finProgramado: horaFinal no parseable, uso respaldo horaInicio + tiempoPagado. horaFinal recibido:', JSON.stringify(horaFinal));
    let inicio = fechaEnDiaCR(compInicio, refMs);
    // Si el inicio quedó en el futuro (registrado apenas pasada la medianoche), era de ayer.
    if (inicio.getTime() - refMs > 5 * 60 * 1000) inicio = new Date(inicio.getTime() - DIA_MS);
    return new Date(inicio.getTime() + minutos * 60 * 1000); // +duración cruza medianoche solo
  }

  // 3º) Último recurso: Date.now() + tiempoPagado, con segundos en cero
  if (Number.isFinite(minutos) && minutos > 0) {
    console.warn('⚠️ finProgramado: horaFinal y horaInicio no parseables, uso respaldo Date.now() + tiempoPagado. horaInicio:', JSON.stringify(horaInicio), '| horaFinal:', JSON.stringify(horaFinal));
    const base = new Date();
    base.setSeconds(0, 0);
    return new Date(base.getTime() + minutos * 60 * 1000);
  }

  return null;
};

// ─────────────────────────────────────────────────────────────────
// Auto-regeneración del reporte mensual
// Se llama después de crear, editar o eliminar un play.
// Trabaja en background (no bloquea la respuesta al cliente).
// ─────────────────────────────────────────────────────────────────

const NOMBRES_MESES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

const getRangoMesUTC = (año, mes) => ({
  inicio: new Date(Date.UTC(año, mes - 1, 1, 6, 0, 0, 0)),
  fin:    new Date(Date.UTC(año, mes,     1, 5, 59, 59, 999)),
});

const getDiaCR = (fechaUTC) => {
  const cr = new Date(fechaUTC.toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }));
  return cr.getDate();
};

const calcularDatosReporte = (plays, año, mes, inicio, fin) => {
  const empleadosMap = {};
  const lugaresMap   = {};
  const diasMap      = {};
  const juegosMap    = {};

  let totalSesiones = 0, totalRecaudado = 0, totalSubtotales = 0;
  let totalCostosControles = 0, totalPlay4 = 0, totalPlay5 = 0, totalPingPong = 0;
  let sesionesCompletadas = 0, sesionesPendientes = 0, sesionesEnProceso = 0;
  let tiempoTotalPagadoMinutos = 0, tiempoTotalPendienteMinutos = 0, totalControlesAdicionales = 0;

  for (const play of plays) {
    totalSesiones++;
    totalRecaudado              += play.total           || 0;
    totalSubtotales             += play.subtotal        || 0;
    totalCostosControles        += play.costoControles  || 0;
    totalPlay4                  += play.totalPlay4      || 0;
    totalPlay5                  += play.totalPlay5      || 0;
    totalPingPong               += play.totalPingPong   || 0;
    tiempoTotalPagadoMinutos    += play.tiempoPagado    || 0;
    tiempoTotalPendienteMinutos += play.tiempoPendiente || 0;
    totalControlesAdicionales   += play.controlAdicional || 0;

    if      (play.estadoPago === 'Completado') sesionesCompletadas++;
    else if (play.estadoPago === 'Pendiente')  sesionesPendientes++;
    else                                        sesionesEnProceso++;

    const emp = play.atendio || 'Desconocido';
    if (!empleadosMap[emp]) empleadosMap[emp] = { nombre: emp, totalSesiones: 0, totalRecaudado: 0, totalPlay4: 0, totalPlay5: 0, totalPingPong: 0, totalControlesAdicionales: 0, tiempoTotalMinutos: 0 };
    empleadosMap[emp].totalSesiones++;
    empleadosMap[emp].totalRecaudado           += play.total           || 0;
    empleadosMap[emp].totalPlay4               += play.totalPlay4      || 0;
    empleadosMap[emp].totalPlay5               += play.totalPlay5      || 0;
    empleadosMap[emp].totalPingPong            += play.totalPingPong   || 0;
    empleadosMap[emp].totalControlesAdicionales += play.controlAdicional || 0;
    empleadosMap[emp].tiempoTotalMinutos       += play.tiempoPagado    || 0;

    const lugar = play.lugarDeJuego || 'Desconocido';
    if (!lugaresMap[lugar]) lugaresMap[lugar] = { lugar, totalSesiones: 0, totalRecaudado: 0, tiempoTotalMinutos: 0 };
    lugaresMap[lugar].totalSesiones++;
    lugaresMap[lugar].totalRecaudado    += play.total        || 0;
    lugaresMap[lugar].tiempoTotalMinutos += play.tiempoPagado || 0;

    const dia = getDiaCR(play.fecha);
    if (!diasMap[dia]) diasMap[dia] = { dia, totalSesiones: 0, totalRecaudado: 0, totalPlay4: 0, totalPlay5: 0, totalPingPong: 0 };
    diasMap[dia].totalSesiones++;
    diasMap[dia].totalRecaudado += play.total        || 0;
    diasMap[dia].totalPlay4     += play.totalPlay4   || 0;
    diasMap[dia].totalPlay5     += play.totalPlay5   || 0;
    diasMap[dia].totalPingPong  += play.totalPingPong || 0;

    for (const juego of (Array.isArray(play.juegosJugados) ? play.juegosJugados : [])) {
      if (!juego) continue;
      const key = juego.trim();
      if (!juegosMap[key]) juegosMap[key] = { nombre: key, vecesJugado: 0 };
      juegosMap[key].vecesJugado++;
    }
  }

  return {
    año, mes,
    nombreMes: NOMBRES_MESES[mes - 1],
    totalSesiones, totalRecaudado, totalSubtotales, totalCostosControles,
    totalPlay4, totalPlay5, totalPingPong,
    sesionesCompletadas, sesionesPendientes, sesionesEnProceso,
    tiempoTotalPagadoMinutos, tiempoTotalPendienteMinutos, totalControlesAdicionales,
    porEmpleado: Object.values(empleadosMap),
    porLugar:    Object.values(lugaresMap),
    porDia:      Object.values(diasMap).sort((a, b) => a.dia - b.dia),
    juegosMasJugados: Object.values(juegosMap).sort((a, b) => b.vecesJugado - a.vecesJugado),
    ultimaActualizacion: new Date(),
    periodoInicio: inicio,
    periodoFin:    fin,
    playsIncluidos: plays.length,
  };
};

/**
 * Regenera el reporte del mes al que pertenece la fecha dada.
 * Se llama en background tras crear/editar/eliminar un play.
 * @param {Date} fechaPlay - Fecha UTC del play afectado
 */
const regenerarReporteDeFecha = async (fechaPlay) => {
  try {
    const crDate = new Date(fechaPlay.toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }));
    const año    = crDate.getFullYear();
    const mes    = crDate.getMonth() + 1;
    const { inicio, fin } = getRangoMesUTC(año, mes);

    const plays = await Play.find({ fecha: { $gte: inicio, $lte: fin } }).lean();
    const datos = calcularDatosReporte(plays, año, mes, inicio, fin);

    await MonthlyReport.findOneAndUpdate(
      { año, mes },
      { $set: datos },
      { upsert: true, runValidators: true }
    );

    console.log(`✅ Reporte ${NOMBRES_MESES[mes - 1]} ${año} actualizado automáticamente (${plays.length} plays)`);
  } catch (err) {
    // No propagar el error: el play ya se guardó, el reporte se puede regenerar luego
    console.error('⚠️ Error al regenerar reporte mensual automáticamente:', err.message);
  }
};

// ─────────────────────────────────────────────────────────────────
// GET - Todos los plays con paginación y filtros
// ─────────────────────────────────────────────────────────────────

export const getAllPlays = async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 5;
    const skip  = (page - 1) * limit;

    const filtro = {};
    if (req.query.soloPendiente === 'true') {
      filtro.tiempoPendiente = { $gt: 0 };
    } else if (req.query.minPendiente) {
      const minPendiente = parseInt(req.query.minPendiente);
      if (!isNaN(minPendiente) && minPendiente > 0)
        filtro.tiempoPendiente = { $gte: minPendiente };
    }

    const total      = await Play.countDocuments(filtro);
    const plays      = await Play.find(filtro).sort({ fecha: -1, createdAt: -1 }).skip(skip).limit(limit);
    const totalPages = Math.ceil(total / limit);

    res.status(200).json({
      success: true,
      data: plays,
      pagination: { total, count: plays.length, page, limit, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 },
    });
  } catch (error) {
    console.error('❌ Error en getAllPlays:', error);
    res.status(500).json({ success: false, message: 'Error al obtener los plays', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET - Por ID
// ─────────────────────────────────────────────────────────────────

export const getPlayById = async (req, res) => {
  try {
    const play = await Play.findById(req.params.id);
    if (!play) return res.status(404).json({ success: false, message: 'Play no encontrado' });
    res.status(200).json({ success: true, data: play });
  } catch (error) {
    console.error('❌ Error en getPlayById:', error);
    res.status(500).json({ success: false, message: 'Error al obtener el play', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// POST - Crear play → regenera reporte del mes automáticamente
// ─────────────────────────────────────────────────────────────────

export const createPlay = async (req, res) => {
  try {
    console.log('📝 Datos recibidos para crear play:', req.body);

    const tipoPlay = determinarTipoPlay(req.body.lugarDeJuego);
    const costos   = calcularCostos(req.body.lugarDeJuego, req.body.tiempoPagado, req.body.controlAdicional || 0);

    const fechaPlay = getUTCDateRanges().hoy.inicio;

    const play = new Play({
      fecha:           fechaPlay,
      cliente:         req.body.cliente,
      atendio:         req.body.atendio,
      tiempoPagado:    req.body.tiempoPagado,
      tiempoPendiente: req.body.tiempoPendiente || 0,
      horaInicio:      req.body.horaInicio,
      horaFinal:       req.body.horaFinal,
      lugarDeJuego:    req.body.lugarDeJuego,
      tipoPlay,
      juegosJugados:   req.body.juegosJugados || [],
      controlAdicional: req.body.controlAdicional || 0,
      subtotal:        costos.subtotal,
      costoControles:  costos.costoControles,
      total:           costos.total,
      totalPlay4:      tipoPlay === 'Play 4'    ? costos.total : 0,
      totalPlay5:      tipoPlay === 'Play 5'    ? costos.total : 0,
      totalPingPong:   tipoPlay === 'Ping Pong' ? costos.total : 0,
      estadoPago:      req.body.estadoPago || 'En Proceso',
      // Instante en que se agota el tiempo → dispara el aviso de WhatsApp.
      // Se deriva de horaFinal para coincidir exactamente con lo que muestra la UI.
      finProgramado:   calcularFinProgramado(req.body.horaInicio, req.body.horaFinal, req.body.tiempoPagado),
      notificacionFinEnviada: false,
    });

    const nuevoPlay = await play.save();
    console.log('✅ Play creado exitosamente:', nuevoPlay._id);

    // ✅ Regenerar reporte en background (no espera respuesta)
    regenerarReporteDeFecha(fechaPlay);

    res.status(201).json({ success: true, message: 'Play creado exitosamente', data: nuevoPlay });
  } catch (error) {
    console.error('❌ Error en createPlay:', error);
    res.status(400).json({ success: false, message: 'Error al crear el play', error: error.message, errors: error.errors });
  }
};

// ─────────────────────────────────────────────────────────────────
// PUT - Actualizar play → regenera reporte del mes automáticamente
// ─────────────────────────────────────────────────────────────────

export const updatePlay = async (req, res) => {
  try {
    console.log(`📝 Actualizando play ${req.params.id}`);

    const play = await Play.findById(req.params.id);
    if (!play) return res.status(404).json({ success: false, message: 'Play no encontrado' });

    const fechaOriginal = play.fecha; // guardar antes de modificar
    // Para detectar cambios que afecten el fin programado
    const tiempoPagadoOriginal = play.tiempoPagado;
    const horaInicioOriginal   = play.horaInicio;
    const horaFinalOriginal    = play.horaFinal;

    if (req.body.cliente          !== undefined) play.cliente          = req.body.cliente;
    if (req.body.atendio          !== undefined) play.atendio          = req.body.atendio;
    if (req.body.tiempoPagado     !== undefined) play.tiempoPagado     = req.body.tiempoPagado;
    if (req.body.tiempoPendiente  !== undefined) play.tiempoPendiente  = req.body.tiempoPendiente;
    if (req.body.horaInicio       !== undefined) play.horaInicio       = req.body.horaInicio;
    if (req.body.horaFinal        !== undefined) play.horaFinal        = req.body.horaFinal;
    if (req.body.lugarDeJuego     !== undefined) play.lugarDeJuego     = req.body.lugarDeJuego;
    if (req.body.juegosJugados    !== undefined) play.juegosJugados    = req.body.juegosJugados;
    if (req.body.controlAdicional !== undefined) play.controlAdicional = req.body.controlAdicional;
    if (req.body.estadoPago       !== undefined) play.estadoPago       = req.body.estadoPago;

    play.tipoPlay       = determinarTipoPlay(play.lugarDeJuego);
    const costos        = calcularCostos(play.lugarDeJuego, play.tiempoPagado, play.controlAdicional);
    play.subtotal       = costos.subtotal;
    play.costoControles = costos.costoControles;
    play.total          = costos.total;
    play.totalPlay4     = play.tipoPlay === 'Play 4'    ? costos.total : 0;
    play.totalPlay5     = play.tipoPlay === 'Play 5'    ? costos.total : 0;
    play.totalPingPong  = play.tipoPlay === 'Ping Pong' ? costos.total : 0;

    // Si cambió algún dato de tiempo (horaInicio, horaFinal o tiempoPagado),
    // recalculamos el fin desde el MISMO origen que la UI (horaFinal) y reseteamos
    // la bandera para que el nuevo fin genere un aviso fresco de WhatsApp.
    const cambioTiempo =
      (req.body.tiempoPagado !== undefined && Number(req.body.tiempoPagado) !== Number(tiempoPagadoOriginal)) ||
      (req.body.horaInicio   !== undefined && req.body.horaInicio !== horaInicioOriginal) ||
      (req.body.horaFinal    !== undefined && req.body.horaFinal  !== horaFinalOriginal);

    if (cambioTiempo) {
      const refMs = play.createdAt ? play.createdAt.getTime() : Date.now();
      play.finProgramado = calcularFinProgramado(play.horaInicio, play.horaFinal, play.tiempoPagado, refMs);
      play.notificacionFinEnviada = false;
    }

    const playActualizado = await play.save();
    console.log('✅ Play actualizado exitosamente:', playActualizado._id);

    // ✅ Regenerar reporte en background
    regenerarReporteDeFecha(fechaOriginal);

    res.status(200).json({ success: true, message: 'Play actualizado exitosamente', data: playActualizado });
  } catch (error) {
    console.error('❌ Error en updatePlay:', error);
    res.status(400).json({ success: false, message: 'Error al actualizar el play', error: error.message, errors: error.errors });
  }
};

// ─────────────────────────────────────────────────────────────────
// DELETE - Eliminar play → regenera reporte del mes automáticamente
// ─────────────────────────────────────────────────────────────────

export const deletePlay = async (req, res) => {
  try {
    console.log(`🗑️ Eliminando play: ${req.params.id}`);

    const play = await Play.findById(req.params.id);
    if (!play) return res.status(404).json({ success: false, message: 'Play no encontrado' });

    const fechaPlay = play.fecha; // guardar antes de eliminar
    await play.deleteOne();
    console.log('✅ Play eliminado exitosamente');

    // ✅ Regenerar reporte en background
    regenerarReporteDeFecha(fechaPlay);

    res.status(200).json({ success: true, message: 'Play eliminado exitosamente', data: {} });
  } catch (error) {
    console.error('❌ Error en deletePlay:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar el play', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// POST - Notificar fin de sesión (lo dispara el FRONTEND cuando el
// cronómetro llega a cero). Manda el WhatsApp al instante.
//
// Idempotente y a prueba de doble envío: reclama la notificación de forma
// atómica (marca notificacionFinEnviada = true al leer). Así, aunque el
// scheduler de respaldo o una segunda llamada intenten lo mismo, el mensaje
// sale UNA sola vez. Nunca rompe el flujo del frontend.
// ─────────────────────────────────────────────────────────────────

export const notificarFinSesionManual = async (req, res) => {
  try {
    // Reclamo atómico: solo pasa si todavía NO se había notificado.
    const play = await Play.findOneAndUpdate(
      { _id: req.params.id, notificacionFinEnviada: { $ne: true } },
      { $set: { notificacionFinEnviada: true } },
      { new: false }
    );

    if (!play) {
      // O el play no existe, o ya se había notificado antes.
      const existe = await Play.exists({ _id: req.params.id });
      if (!existe) {
        return res.status(404).json({ success: false, message: 'Play no encontrado' });
      }
      return res.status(200).json({ success: true, yaEnviada: true, message: 'La notificación ya se había enviado' });
    }

    // Envío en background: respondemos YA, no bloqueamos al frontend.
    // Usamos finProgramado como hora de fin (o ahora si no estuviera).
    notificarFinSesion(play, play.finProgramado || new Date()).catch((err) =>
      console.error('❌ Error al notificar fin de sesión (manual):', err?.message)
    );

    res.status(200).json({ success: true, message: 'Notificación de fin de sesión disparada' });
  } catch (error) {
    console.error('❌ Error en notificarFinSesionManual:', error);
    res.status(500).json({ success: false, message: 'Error al notificar fin de sesión', error: error.message });
  }
};