// utils/finSesionScheduler.js
// Hecho por Claude Code — Chequeador de fin de sesión para notificaciones de WhatsApp.
//
// CÓMO FUNCIONA:
//   Cada INTERVALO_MS el servidor busca los plays cuyo `finProgramado` ya pasó
//   y que todavía no fueron notificados. Por cada uno, "reclama" el envío de
//   forma ATÓMICA (marca notificacionFinEnviada = true en la misma operación que
//   lo lee) para que nunca se mande el mensaje dos veces, y luego dispara la
//   notificación de WhatsApp fire-and-forget.
//
// ROBUSTEZ:
//   - Ventana de catch-up: solo notifica plays vencidos en las últimas VENTANA_MS.
//     Si Koyeb duerme/reinicia el contenedor, al despertar manda los que se le
//     pasaron (tarde pero llegan) y NUNCA spammea sesiones viejas.
//   - Marcado atómico → sin duplicados aunque se solapen ticks o haya reinicios.
//   - Nada acá lanza hacia el flujo principal: todo error se loggea y sigue.
//   - Idempotente: correrlo de más no genera envíos repetidos.

import Play from '../models/plays.js';
import { notificarFinSesion, notificacionesActivas } from './notificacionesWhatsApp.js';

const INTERVALO_MS = 30 * 1000;        // revisar cada 30 segundos
const VENTANA_MS = 2 * 60 * 60 * 1000; // catch-up: máximo 2 horas hacia atrás

let intervalHandle = null;
let ejecutando = false; // evita que dos ticks se solapen si uno se atrasa

/**
 * Un ciclo de revisión. Reclama y notifica los plays vencidos.
 * Nunca lanza: cualquier error se loggea.
 */
const procesarFinSesiones = async () => {
  if (ejecutando) return; // el tick anterior sigue trabajando
  ejecutando = true;
  try {
    const ahora = new Date();
    const desde = new Date(ahora.getTime() - VENTANA_MS);

    const filtro = {
      notificacionFinEnviada: { $ne: true },
      finProgramado: { $ne: null, $lte: ahora, $gte: desde },
    };

    // Reclamo atómico uno por uno: marco la bandera al leer, así ningún otro
    // tick (ni otra instancia) puede volver a agarrar el mismo play.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const play = await Play.findOneAndUpdate(
        filtro,
        { $set: { notificacionFinEnviada: true } },
        { new: false, sort: { finProgramado: 1 } }
      );
      if (!play) break; // no quedan pendientes

      // Envío fire-and-forget (no esperamos, no bloqueamos el ciclo).
      notificarFinSesion(play, play.finProgramado).catch((err) =>
        console.error('❌ Scheduler: error al notificar fin de sesión:', err?.message)
      );
    }
  } catch (err) {
    console.error('⚠️ Scheduler de fin de sesión: error en el ciclo:', err.message);
  } finally {
    ejecutando = false;
  }
};

/**
 * Arranca el chequeador periódico. Llamar una vez desde server.js tras conectar a MongoDB.
 */
export const iniciarSchedulerFinSesion = () => {
  if (intervalHandle) return; // ya arrancado

  if (!notificacionesActivas()) {
    console.log('🔕 Notificaciones WhatsApp DESACTIVADAS (NOTIFICACIONES_WHATSAPP_ENABLED != true). Scheduler no se inicia.');
    return;
  }

  console.log(`🔔 Scheduler de fin de sesión activo (revisa cada ${INTERVALO_MS / 1000}s, catch-up ${VENTANA_MS / 3600000}h).`);
  intervalHandle = setInterval(procesarFinSesiones, INTERVALO_MS);
  intervalHandle.unref?.(); // no bloquear el cierre del proceso por este timer

  // Un primer barrido al arranque para atrapar lo vencido durante un reinicio.
  procesarFinSesiones();
};

/**
 * Detiene el chequeador (útil para tests o apagado limpio).
 */
export const detenerSchedulerFinSesion = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};
