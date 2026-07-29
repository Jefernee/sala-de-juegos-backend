// utils/alertasEmail.js
// Alertas por correo cuando algo se rompe y hay que enterarse a tiempo.
//
// POR QUÉ EXISTE: el 29-jul-2026 la sesión de WhatsApp en WAHA se cayó y
// estuvimos casi un día sin avisos de fin de sesión sin darnos cuenta. Los logs
// lo decían, pero nadie mira los logs. El correo es el canal de respaldo: si el
// canal principal (WhatsApp) es justamente el que falla, el aviso tiene que
// salir por OTRO lado.
//
// QUÉ AVISA:
//   1. Un aviso de fin de sesión que no se pudo entregar tras todos los reintentos.
//   2. Un error grave del backend (500 / excepción no controlada).
//   (La sesión de WhatsApp caída la avisa el watchdog de la VM por su cuenta,
//    ver scripts/waha-watchdog.sh — vive fuera de este backend a propósito,
//    porque tiene que funcionar aunque Koyeb esté dormido.)
//
// CÓMO SE MANDA: por la API HTTP de Resend. Se eligió una API HTTP y no SMTP
// porque el trigger de MongoDB Atlas no puede usar librerías de node (solo hace
// llamadas HTTP), y el watchdog de la VM solo tiene curl. Así los tres lados
// mandan el correo igual.
//   POST https://api.resend.com/emails
//   header: Authorization: Bearer {RESEND_API_KEY}
//   body:   { from, to, subject, text }
//
// REGLAS DE DISEÑO (iguales a las de WhatsApp):
//   - NUNCA lanza ni bloquea: si el correo falla, se loggea y la vida sigue.
//     Una alerta rota jamás puede romper lo que estaba alertando.
//   - Enfriamiento por tipo de alerta (ver models/AlertaEmail.js) para no
//     recibir cien correos cuando algo se cae por un rato largo.
//   - Se puede apagar con ALERTAS_EMAIL_ENABLED distinto de 'true'.
//
// Variables de entorno (ver .env.example):
//   ALERTAS_EMAIL_ENABLED → 'true' para activar; cualquier otra cosa lo apaga
//   RESEND_API_KEY        → la API key de Resend (empieza con "re_")
//   ALERTAS_EMAIL_TO      → a quién le llegan las alertas
//   ALERTAS_EMAIL_FROM    → remitente (default: el de pruebas de Resend)

import mongoose from 'mongoose';
import AlertaEmail from '../models/AlertaEmail.js';

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10000; // 10 s por intento
const MAX_INTENTOS = 2;   // 1 intento + 1 reintento

// Remitente por defecto: el dominio de pruebas de Resend. Funciona sin comprar
// dominio, pero SOLO puede escribirle a la cuenta dueña de la API key — que es
// justo lo que queremos (alertas para el administrador).
const REMITENTE_DEFAULT = 'Sala de Juegos <onboarding@resend.dev>';

/**
 * ¿Están activadas las alertas por correo? Solo si la variable es exactamente 'true'.
 * @returns {boolean}
 */
export const alertasEmailActivas = () =>
  String(process.env.ALERTAS_EMAIL_ENABLED).toLowerCase() === 'true';

/**
 * Lee la config del entorno en tiempo de ejecución (no al importar), para que
 * los scripts de prueba puedan forzar variables antes de llamar.
 * @returns {{apiKey: string, para: string, desde: string}}
 */
export const configEmail = () => ({
  apiKey: String(process.env.RESEND_API_KEY || '').trim(),
  para: String(process.env.ALERTAS_EMAIL_TO || '').trim(),
  desde: String(process.env.ALERTAS_EMAIL_FROM || '').trim() || REMITENTE_DEFAULT,
});

/**
 * Un intento único contra la API de Resend, con timeout. Lanza si falla.
 * @param {{apiKey: string, para: string, desde: string}} cfg
 * @param {string} asunto
 * @param {string} cuerpo - Texto plano.
 */
const intentarEnvioEmail = async (cfg, asunto, cuerpo) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        from: cfg.desde,
        to: [cfg.para],
        subject: asunto,
        text: cuerpo,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      throw new Error(`Resend respondió ${res.status}: ${detalle.slice(0, 200)}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Manda un correo SIN pasar por el enfriamiento. Uso interno y del script de
 * prueba; para alertas de verdad usá enviarAlerta().
 * Nunca lanza.
 * @param {string} asunto
 * @param {string} cuerpo - Texto plano.
 * @returns {Promise<{ok: boolean, skipped?: boolean, motivo?: string}>}
 */
export const enviarEmail = async (asunto, cuerpo) => {
  if (!alertasEmailActivas()) {
    return { ok: false, skipped: true }; // apagadas a propósito; silencioso
  }

  const cfg = configEmail();
  if (!cfg.apiKey || !cfg.para) {
    const motivo = 'falta configuración de correo (RESEND_API_KEY / ALERTAS_EMAIL_TO)';
    console.error(`⚠️ Alertas: ${motivo}. No se envía.`);
    return { ok: false, motivo };
  }

  let ultimoMotivo = '';
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    try {
      await intentarEnvioEmail(cfg, asunto, cuerpo);
      console.log(`📧 Alerta por correo enviada a ${cfg.para}: ${asunto}`);
      return { ok: true };
    } catch (err) {
      ultimoMotivo = err.name === 'AbortError' ? `timeout de ${TIMEOUT_MS}ms` : err.message;
      if (intento === MAX_INTENTOS) {
        console.error(`❌ Alerta por correo falló tras ${MAX_INTENTOS} intento(s): ${ultimoMotivo}`);
      } else {
        console.warn(`⚠️ Alerta por correo, intento ${intento} falló (${ultimoMotivo}). Reintentando...`);
      }
    }
  }
  return { ok: false, motivo: ultimoMotivo };
};

/**
 * Reclama el turno de una clave de alerta de forma ATÓMICA.
 *
 * Devuelve `permitido: true` solo si el último correo de esa clave salió hace
 * más de `cooldownMin` minutos. Como el reclamo es una sola operación de Mongo,
 * dos procesos a la vez (Atlas y Koyeb) nunca mandan los dos el mismo correo.
 *
 * Si la base no está disponible, deja pasar la alerta: es preferible un correo
 * de más que perder el aviso justo cuando algo anda mal.
 *
 * @param {string} clave
 * @param {number} cooldownMin
 * @param {string} detalle
 * @returns {Promise<{permitido: boolean, suprimidas: number}>}
 */
const reclamarTurno = async (clave, cooldownMin, detalle) => {
  if (mongoose.connection.readyState !== 1) {
    return { permitido: true, suprimidas: 0 }; // sin base, no hay freno posible
  }

  const ahora = new Date();
  const limite = new Date(ahora.getTime() - cooldownMin * 60 * 1000);

  try {
    // Si el documento existe y ya salió un correo hace poco, el filtro NO
    // coincide y el upsert intenta insertar → choca con el índice único de
    // `clave` (error 11000) → así sabemos que hay que callarse.
    const previo = await AlertaEmail.findOneAndUpdate(
      { clave, ultimoEnvio: { $lte: limite } },
      {
        $set: { ultimoEnvio: ahora, ultimoDetalle: String(detalle || '').slice(0, 500), suprimidas: 0 },
        $inc: { veces: 1 },
      },
      { upsert: true, new: false } // new:false → devuelve el doc ANTERIOR (null si se creó)
    );
    return { permitido: true, suprimidas: Number(previo?.suprimidas || 0) };
  } catch (err) {
    if (err?.code === 11000) {
      // En enfriamiento: dejamos constancia de la que se calló.
      await AlertaEmail.updateOne(
        { clave },
        { $inc: { suprimidas: 1 }, $set: { ultimoDetalle: String(detalle || '').slice(0, 500) } }
      ).catch(() => {});
      return { permitido: false, suprimidas: 0 };
    }
    console.error('⚠️ Alertas: no se pudo consultar el enfriamiento:', err.message);
    return { permitido: true, suprimidas: 0 }; // ante la duda, avisar
  }
};

/**
 * Manda una alerta por correo respetando el enfriamiento de su clave.
 * Fire-and-forget: NUNCA lanza.
 *
 * @param {Object}  opciones
 * @param {string}  opciones.clave       - Tipo de alerta (agrupa el enfriamiento). Ej: 'whatsapp-aviso-fallido'.
 * @param {string}  opciones.asunto      - Asunto del correo.
 * @param {string}  opciones.cuerpo      - Texto plano del correo.
 * @param {number} [opciones.cooldownMin=60] - Minutos mínimos entre correos de esta clave.
 * @returns {Promise<{ok: boolean, skipped?: boolean, motivo?: string}>}
 */
export const enviarAlerta = async ({ clave, asunto, cuerpo, cooldownMin = 60 }) => {
  try {
    if (!alertasEmailActivas()) return { ok: false, skipped: true };

    const { permitido, suprimidas } = await reclamarTurno(clave, cooldownMin, asunto);
    if (!permitido) return { ok: false, skipped: true, motivo: 'en enfriamiento' };

    // Si mientras tanto hubo más alertas iguales que se callaron, lo decimos:
    // es la diferencia entre "falló una vez" y "está fallando todo".
    const extra = suprimidas > 0
      ? `\n\n⚠️ Además hubo ${suprimidas} alerta(s) igual(es) que no se enviaron para no llenarte el correo.`
      : '';

    const pie = [
      '',
      '',
      '───────────────',
      `Sala de Juegos · ${new Date().toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' })}`,
      `No se repite este aviso por ${cooldownMin} minutos.`,
    ].join('\n');

    return await enviarEmail(asunto, cuerpo + extra + pie);
  } catch (err) {
    // Blindaje: una alerta rota no puede romper lo que estaba alertando.
    console.error('❌ Alertas: error inesperado al enviar la alerta:', err?.message);
    return { ok: false, motivo: err?.message };
  }
};

/**
 * Alerta: un aviso de fin de sesión NO se pudo entregar por WhatsApp.
 * Enfriamiento largo (2 h) porque si WhatsApp se cae fallan todas las sesiones
 * seguidas y con un correo ya te enterás.
 *
 * @param {Object} opciones
 * @param {Object} opciones.play    - El play que no se pudo avisar.
 * @param {string} opciones.motivo  - Por qué falló el envío.
 * @param {number} opciones.intentos
 * @param {string} opciones.motor   - Quién lo intentó ('Koyeb', 'manual', ...).
 */
export const alertarAvisoWhatsAppFallido = async ({ play, motivo, intentos, motor }) => {
  const consola = play?.lugarDeJuego || 'estación desconocida';
  const cuerpo = [
    'No se pudo avisar por WhatsApp que terminó una partida.',
    '',
    `🎮 Consola: ${consola}`,
    play?.cliente ? `👤 Cliente: ${play.cliente}` : null,
    `🏁 Fin programado: ${play?.finProgramado ? new Date(play.finProgramado).toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' }) : 'sin dato'}`,
    `🔁 Intentos: ${intentos}`,
    `⚙️ Motor: ${motor}`,
    `❌ Motivo: ${motivo || 'sin detalle'}`,
    '',
    'QUÉ HACER:',
    '1. Revisá el estado de la sesión de WhatsApp en el dashboard de WAHA.',
    '   Si dice SCAN_QR_CODE, hay que escanear el QR con el teléfono.',
    '2. Mirá el log del watchdog en la VM: sudo tail -50 /var/log/waha-watchdog.log',
    '3. Guía completa: NOTIFICACIONES_WHATSAPP.md en el repo del backend.',
  ].filter(Boolean).join('\n');

  return enviarAlerta({
    clave: 'whatsapp-aviso-fallido',
    asunto: '🔴 No salió el aviso de WhatsApp de fin de sesión',
    cuerpo,
    cooldownMin: 120,
  });
};

/**
 * Alerta: error grave del backend (500 o excepción no controlada).
 * Enfriamiento por tipo de error, para que un error repetido no inunde el correo
 * pero uno nuevo sí llegue.
 *
 * @param {Error}  err
 * @param {Object} [contexto]
 * @param {string} [contexto.ruta]   - Método y ruta de la petición.
 * @param {string} [contexto.origen] - De dónde salió ('petición', 'proceso', ...).
 */
export const alertarErrorBackend = async (err, contexto = {}) => {
  const nombre = err?.name || 'Error';
  const cuerpo = [
    'El backend tuvo un error grave.',
    '',
    `⚙️ Origen: ${contexto.origen || 'petición'}`,
    contexto.ruta ? `🔗 Ruta: ${contexto.ruta}` : null,
    `🏷️ Tipo: ${nombre}`,
    `❌ Mensaje: ${err?.message || 'sin mensaje'}`,
    '',
    'Detalle técnico:',
    String(err?.stack || 'sin stack').slice(0, 1500),
    '',
    'Los logs completos están en el panel de Koyeb.',
  ].filter(Boolean).join('\n');

  return enviarAlerta({
    // Una clave por tipo de error: un fallo nuevo avisa aunque otro esté en
    // enfriamiento, pero el mismo error repetido no te llena el correo.
    clave: `backend-error:${nombre}`,
    asunto: `🔴 Error en el backend de la sala (${nombre})`,
    cuerpo,
    cooldownMin: 30,
  });
};
