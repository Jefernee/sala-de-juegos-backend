// utils/notificacionesWhatsApp.js
// Hecho por Claude Code — Servicio de notificaciones por WhatsApp vía CallMeBot.
//
// CallMeBot NO soporta grupos: cada persona recibe el mensaje en SU número, y
// cada número tiene SU PROPIA apikey. Por eso enviamos individualmente a cada
// destinatario configurado. Cada envío es un HTTP GET a:
//   https://api.callmebot.com/whatsapp.php?phone={numero}&text={MENSAJE}&apikey={apikey}
//
// Diseño (requisitos del negocio):
//   - NUNCA bloquea ni rompe el flujo principal: se llama fire-and-forget y
//     jamás lanza excepciones hacia quien lo invoca (todo error se loggea).
//   - Timeout de 10 segundos por intento (AbortController).
//   - 1 reintento si el primer intento falla, POR destinatario.
//   - Envío EN SERIE con pausa entre cada uno (CallMeBot limita la frecuencia).
//   - Si falla uno, se loggea y se continúa con los demás.
//   - Se puede apagar por completo con NOTIFICACIONES_WHATSAPP_ENABLED=false.
//
// Los destinatarios se administran desde el frontend y viven en la base de datos
// (colección whatsapp_recipients). La variable de entorno CALLMEBOT_RECIPIENTS
// solo se usa para SEMBRAR el primer destinatario si la base está vacía.
//
// Variables de entorno (ver .env.example):
//   CALLMEBOT_RECIPIENTS            → (opcional) semilla inicial "numero:apikey"
//                                     separada por comas. Ej: +50688881234:111111
//   NOTIFICACIONES_WHATSAPP_ENABLED → 'true' para activar, cualquier otra cosa lo apaga

import WhatsappRecipient from '../models/WhatsappRecipient.js';

const CALLMEBOT_URL = 'https://api.callmebot.com/whatsapp.php';
const TIMEOUT_MS = 10000;     // 10 segundos por intento
const MAX_INTENTOS = 2;       // 1 intento + 1 reintento (por destinatario)
const PAUSA_ENTRE_ENVIOS_MS = 2500; // CallMeBot limita la frecuencia

/**
 * Pausa asíncrona.
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ¿Están activadas las notificaciones? Solo si la variable es exactamente 'true'.
 * @returns {boolean}
 */
export const notificacionesActivas = () =>
  String(process.env.NOTIFICACIONES_WHATSAPP_ENABLED).toLowerCase() === 'true';

/**
 * Parsea CALLMEBOT_RECIPIENTS ("numero:apikey,numero:apikey,...") a una lista de
 * objetos { phone, apikey }. Ignora entradas vacías o mal formadas (con warning).
 * @returns {Array<{phone: string, apikey: string}>}
 */
export const parseDestinatarios = () => {
  const raw = process.env.CALLMEBOT_RECIPIENTS;
  if (!raw || !raw.trim()) return [];

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      // Dividir en el PRIMER ":" (el número no lleva ":", la apikey tampoco).
      const idx = item.indexOf(':');
      if (idx === -1) {
        console.warn(`⚠️ WhatsApp: destinatario mal formado (falta ":"), se ignora: "${item}"`);
        return null;
      }
      const phone = item.slice(0, idx).trim();
      const apikey = item.slice(idx + 1).trim();
      if (!phone || !apikey) {
        console.warn(`⚠️ WhatsApp: destinatario mal formado (número o apikey vacío), se ignora: "${item}"`);
        return null;
      }
      return { phone, apikey };
    })
    .filter(Boolean);
};

/**
 * Obtiene los destinatarios ACTIVOS a los que hay que enviar. Fuente de verdad:
 * la base de datos (colección whatsapp_recipients, administrada desde el frontend).
 * Si la base falla o está vacía, cae a la variable de entorno como respaldo.
 * @returns {Promise<Array<{phone: string, apikey: string}>>}
 */
export const obtenerDestinatarios = async () => {
  try {
    const docs = await WhatsappRecipient.find({ activo: true }).lean();
    if (docs.length > 0) {
      return docs.map((d) => ({ phone: d.telefono, apikey: d.apikey }));
    }
  } catch (err) {
    console.error('⚠️ WhatsApp: no se pudo leer destinatarios de la base, uso el respaldo del entorno:', err.message);
  }
  // Respaldo: variable de entorno.
  return parseDestinatarios();
};

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

  if (Number(play?.controlAdicional) > 0) {
    lineas.push(`🎮 Controles adicionales: ${play.controlAdicional}`);
  }

  const total = formatearColones(play?.total);
  if (total) lineas.push(`💰 Total: ${total}`);

  if (play?.estadoPago) lineas.push(`💳 Estado del pago: ${play.estadoPago}`);

  return lineas.join('\n');
};

/**
 * Un intento único de envío con timeout. Lanza si falla (lo maneja enviarNotificacion).
 * @param {string} url
 */
const intentarEnvio = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    if (!res.ok) {
      const cuerpo = await res.text().catch(() => '');
      throw new Error(`CallMeBot respondió ${res.status}: ${cuerpo.slice(0, 200)}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Envía el mensaje a UN destinatario, con timeout y 1 reintento. Nunca lanza.
 * @param {{phone: string, apikey: string}} dest
 * @param {string} texto - Mensaje en texto plano (se URL-encodea acá adentro).
 * @returns {Promise<boolean>} true si se envió, false si falló definitivamente.
 */
const enviarAUnDestinatario = async ({ phone, apikey }, texto) => {
  // Encodeamos CADA parte explícitamente. Importante para el teléfono: si viene
  // con "+" (formato internacional), encodeURIComponent lo convierte en "%2B" y
  // así CallMeBot lo recibe correcto (un "+" crudo en la query se leería como espacio).
  const url = `${CALLMEBOT_URL}?phone=${encodeURIComponent(phone)}` +
    `&text=${encodeURIComponent(texto)}` +
    `&apikey=${encodeURIComponent(apikey)}`;

  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    try {
      await intentarEnvio(url);
      console.log(`✅ WhatsApp enviado a ${phone} (intento ${intento}).`);
      return true;
    } catch (err) {
      const esUltimo = intento === MAX_INTENTOS;
      const motivo = err.name === 'AbortError' ? `timeout de ${TIMEOUT_MS}ms` : err.message;
      if (esUltimo) {
        console.error(`❌ WhatsApp a ${phone} falló tras ${MAX_INTENTOS} intento(s): ${motivo}`);
      } else {
        console.warn(`⚠️ WhatsApp a ${phone} intento ${intento} falló (${motivo}). Reintentando...`);
      }
    }
  }
  return false;
};

/**
 * Envía el mismo mensaje a TODOS los destinatarios configurados, EN SERIE y con
 * una pausa entre cada uno (CallMeBot limita la frecuencia). Fire-and-forget:
 * NUNCA lanza. Si un destinatario falla, se loggea y se continúa con los demás.
 * @param {string} texto - Mensaje en texto plano (se URL-encodea por destinatario).
 * @returns {Promise<Array<{phone: string, ok: boolean}>>} Resultado por destinatario.
 */
export const enviarNotificacion = async (texto) => {
  if (!notificacionesActivas()) {
    return []; // apagadas por configuración; silencioso a propósito
  }

  const destinatarios = await obtenerDestinatarios();
  if (destinatarios.length === 0) {
    console.error('⚠️ WhatsApp: no hay destinatarios activos (ni en la base ni en el entorno). No hay a quién enviar.');
    return [];
  }

  const resultados = [];
  for (let i = 0; i < destinatarios.length; i++) {
    const dest = destinatarios[i];
    const ok = await enviarAUnDestinatario(dest, texto);
    resultados.push({ phone: dest.phone, ok });

    // Pausa entre envíos, pero no después del último.
    if (i < destinatarios.length - 1) {
      await sleep(PAUSA_ENTRE_ENVIOS_MS);
    }
  }

  const enviados = resultados.filter((r) => r.ok).length;
  console.log(`📊 WhatsApp: ${enviados}/${resultados.length} destinatario(s) recibieron: "${texto}"`);
  return resultados;
};

/**
 * Arma y envía la notificación de "fin de sesión" para un play.
 * Fire-and-forget: nunca lanza.
 * @param {Object} play - Documento de Play (o lean object) con lugarDeJuego, tiempoPagado, finProgramado.
 * @param {Date}   [horaFin] - Instante real de fin (default: finProgramado o ahora).
 * @returns {Promise<Array<{phone: string, ok: boolean}>>} Resultado por destinatario.
 */
export const notificarFinSesion = async (play, horaFin) => {
  try {
    const mensaje = construirMensajeFinSesion(play, horaFin);
    return await enviarNotificacion(mensaje);
  } catch (err) {
    // Blindaje extra: ni siquiera un error al armar el mensaje debe propagarse.
    console.error('❌ WhatsApp: error inesperado al notificar fin de sesión:', err.message);
    return [];
  }
};
