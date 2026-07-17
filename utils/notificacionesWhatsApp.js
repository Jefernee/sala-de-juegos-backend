// utils/notificacionesWhatsApp.js
// Servicio de notificaciones por WhatsApp vía WAHA.
//
// WAHA (WhatsApp HTTP API) corre en una VM propia (Oracle Always Free) con el
// número de la sala conectado como un WhatsApp REAL. Eso permite mandar el aviso
// a UN GRUPO de una sola vez (a diferencia de CallMeBot, que no soportaba grupos
// y exigía una apikey por persona). El envío es un HTTP POST a:
//   {WAHA_URL}/api/sendText
//   header:  X-Api-Key: {WAHA_API_KEY}
//   body:    { "session": "default", "chatId": "...@g.us", "text": "..." }
//
// Diseño (requisitos del negocio):
//   - NUNCA bloquea ni rompe el flujo principal: se llama fire-and-forget y
//     jamás lanza excepciones hacia quien lo invoca (todo error se loggea).
//   - Timeout de 10 segundos por intento (AbortController).
//   - 1 reintento si el primer intento falla.
//   - Se puede apagar por completo con NOTIFICACIONES_WHATSAPP_ENABLED=false.
//
// Variables de entorno (ver .env.example):
//   NOTIFICACIONES_WHATSAPP_ENABLED → 'true' para activar, cualquier otra cosa lo apaga
//   WAHA_URL       → base de la API de WAHA. Ej: http://157.151.183.29:3000
//   WAHA_API_KEY   → la X-Api-Key de WAHA
//   WAHA_SESSION   → nombre de la sesión de WhatsApp en WAHA (normalmente "default")
//   WAHA_CHAT_ID   → destino: el ID del GRUPO ("...@g.us") al que llega el aviso

const TIMEOUT_MS = 10000;   // 10 segundos por intento
const MAX_INTENTOS = 2;     // 1 intento + 1 reintento

/**
 * ¿Están activadas las notificaciones? Solo si la variable es exactamente 'true'.
 * @returns {boolean}
 */
export const notificacionesActivas = () =>
  String(process.env.NOTIFICACIONES_WHATSAPP_ENABLED).toLowerCase() === 'true';

/**
 * Lee la configuración de WAHA del entorno (en tiempo de ejecución, no al importar,
 * para respetar cambios de .env y el flag forzado en los scripts de prueba).
 * @returns {{url: string, apiKey: string, session: string, chatId: string}}
 */
export const configWaha = () => ({
  url: String(process.env.WAHA_URL || '').replace(/\/+$/, ''), // sin "/" final
  apiKey: String(process.env.WAHA_API_KEY || ''),
  session: String(process.env.WAHA_SESSION || 'default'),
  chatId: String(process.env.WAHA_CHAT_ID || '').trim(),
});

/**
 * Formatea una cantidad de minutos como "1h 30min", "45min" o "2h".
 * @param {number} minutos
 * @returns {string}
 */
export const formatearDuracion = (minutos) => {
  const total = Number(minutos);
  if (!Number.isFinite(total) || total <= 0) return '';
  const horas = Math.floor(total / 60);
  const mins = Math.round(total % 60);
  if (horas > 0 && mins > 0) return `${horas}h ${mins}min`;
  if (horas > 0) return `${horas}h`;
  return `${mins}min`;
};

/**
 * Formatea una fecha como hora de Costa Rica en formato "4:35 PM".
 * @param {Date} fecha
 * @returns {string}
 */
export const formatearHoraCR = (fecha) =>
  fecha.toLocaleTimeString('en-US', {
    timeZone: 'America/Costa_Rica',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

/**
 * Convierte una hora en texto a formato 12h con AM/PM. Ej: "17:12" → "5:12 PM".
 * Si ya viene con AM/PM o el formato es desconocido, la devuelve tal cual.
 * @param {string} str
 * @returns {string}
 */
export const formatearHora12 = (str) => {
  if (!str) return str;
  const s = String(str).trim();
  if (/[ap]\.?\s*m\.?/i.test(s)) return s; // ya tiene AM/PM
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return s; // formato desconocido → sin tocar
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
};

/**
 * Formatea un monto en colones: "₡1,200". Devuelve '' si no hay monto válido.
 * @param {number} monto
 * @returns {string}
 */
export const formatearColones = (monto) => {
  const v = Number(monto);
  if (!Number.isFinite(v) || v <= 0) return '';
  // Separador de miles manual (mismo formato que el trigger de Atlas): "₡1,400"
  const entero = String(Math.round(v));
  let out = '';
  for (let i = 0; i < entero.length; i++) {
    if (i > 0 && (entero.length - i) % 3 === 0) out += ',';
    out += entero[i];
  }
  return '₡' + out;
};

/**
 * Construye el mensaje detallado de fin de sesión con toda la info del play.
 * Solo incluye las líneas que tienen dato (no muestra campos vacíos).
 * @param {Object} play
 * @param {Date} [horaFin] - Instante de fin (default: finProgramado o ahora).
 * @returns {string}
 */
export const construirMensajeFinSesion = (play, horaFin) => {
  const fin = horaFin || play?.finProgramado || new Date();
  const horaTexto = formatearHoraCR(fin instanceof Date ? fin : new Date(fin));

  const lineas = ['✅ Terminó la partida', ''];
  lineas.push(`🎮 Consola: ${play?.lugarDeJuego || 'Estación desconocida'}`);
  if (play?.cliente) lineas.push(`👤 Cliente: ${play.cliente}`);
  if (play?.atendio) lineas.push(`🧑‍💼 Atendió: ${play.atendio}`);
  if (play?.horaInicio) lineas.push(`🕐 Inicio: ${formatearHora12(play.horaInicio)}`);
  lineas.push(`🏁 Fin: ${horaTexto}`);

  const duracion = formatearDuracion(play?.tiempoPagado);
  if (duracion) lineas.push(`⏱️ Duración: ${duracion}`);

  if (Number(play?.tiempoPendiente) > 0) {
    lineas.push(`⏳ Tiempo pendiente: ${formatearDuracion(play.tiempoPendiente)}`);
  }

  const juegos = Array.isArray(play?.juegosJugados) ? play.juegosJugados.filter(Boolean) : [];
  if (juegos.length) lineas.push(`🕹️ Juegos: ${juegos.join(', ')}`);

  // Controles usados en la partida: SIEMPRE se muestra. Fallback para plays
  // viejos sin totalControles: derivar de controlAdicional (2 gratis + cobrados).
  const totalControles = Number(play?.totalControles) >= 1
    ? Number(play.totalControles)
    : (Number(play?.controlAdicional) > 0 ? Number(play.controlAdicional) + 2 : 2);
  lineas.push(`🎮 Controles: ${totalControles}`);

  const total = formatearColones(play?.total);
  if (total) lineas.push(`💰 Total: ${total}`);

  if (play?.estadoPago) lineas.push(`💳 Estado del pago: ${play.estadoPago}`);

  // Recordatorio de devolución de controles (acción para el encargado).
  lineas.push('');
  lineas.push(totalControles === 1
    ? '⚠️ Debe estar 1 control. Revisá que todo esté bien.'
    : `⚠️ Deben estar ${totalControles} controles. Revisá que todo esté bien.`);

  return lineas.join('\n');
};

/**
 * Un intento único de envío a WAHA con timeout. Lanza si falla (lo maneja enviarNotificacion).
 * @param {{url: string, apiKey: string, session: string, chatId: string}} cfg
 * @param {string} texto
 */
const intentarEnvio = async (cfg, texto) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.url}/api/sendText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': cfg.apiKey,
      },
      body: JSON.stringify({
        session: cfg.session,
        chatId: cfg.chatId,
        text: texto,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const cuerpo = await res.text().catch(() => '');
      throw new Error(`WAHA respondió ${res.status}: ${cuerpo.slice(0, 200)}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Envía el mensaje al grupo de WhatsApp configurado (WAHA_CHAT_ID), con timeout y
 * 1 reintento. Fire-and-forget: NUNCA lanza.
 * @param {string} texto - Mensaje en texto plano.
 * @returns {Promise<{ok: boolean, skipped?: boolean}>}
 */
export const enviarNotificacion = async (texto) => {
  if (!notificacionesActivas()) {
    return { ok: false, skipped: true }; // apagadas por configuración; silencioso a propósito
  }

  const cfg = configWaha();
  if (!cfg.url || !cfg.apiKey || !cfg.chatId) {
    console.error('⚠️ WhatsApp: falta configuración de WAHA (WAHA_URL / WAHA_API_KEY / WAHA_CHAT_ID). No se envía.');
    return { ok: false };
  }

  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    try {
      await intentarEnvio(cfg, texto);
      console.log(`✅ WhatsApp enviado al grupo ${cfg.chatId} (intento ${intento}).`);
      return { ok: true };
    } catch (err) {
      const esUltimo = intento === MAX_INTENTOS;
      const motivo = err.name === 'AbortError' ? `timeout de ${TIMEOUT_MS}ms` : err.message;
      if (esUltimo) {
        console.error(`❌ WhatsApp al grupo ${cfg.chatId} falló tras ${MAX_INTENTOS} intento(s): ${motivo}`);
      } else {
        console.warn(`⚠️ WhatsApp intento ${intento} falló (${motivo}). Reintentando...`);
      }
    }
  }
  return { ok: false };
};

/**
 * Arma y envía la notificación de "fin de sesión" para un play.
 * Fire-and-forget: nunca lanza.
 * @param {Object} play - Documento de Play (o lean object) con lugarDeJuego, tiempoPagado, finProgramado.
 * @param {Date}   [horaFin] - Instante real de fin (default: finProgramado o ahora).
 * @returns {Promise<{ok: boolean, skipped?: boolean}>}
 */
export const notificarFinSesion = async (play, horaFin) => {
  try {
    const mensaje = construirMensajeFinSesion(play, horaFin);
    return await enviarNotificacion(mensaje);
  } catch (err) {
    // Blindaje extra: ni siquiera un error al armar el mensaje debe propagarse.
    console.error('❌ WhatsApp: error inesperado al notificar fin de sesión:', err.message);
    return { ok: false };
  }
};
