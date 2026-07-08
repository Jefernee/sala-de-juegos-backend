// atlas/finSesionTrigger.js
// Hecho por Claude Code — Función para el SCHEDULED TRIGGER de MongoDB Atlas.
//
// ⚠️ Este archivo NO corre en el backend de Node. Es para PEGARLO en el panel de
// Atlas (App Services → Triggers → Function). Atlas está siempre encendido, así
// que este trigger manda los avisos aunque Koyeb esté dormido.
//
// QUÉ HACE (cada 1 minuto):
//   1. Busca sesiones (plays) cuyo tiempo ya venció y que no fueron notificadas.
//   2. Marca cada una como notificada de forma ATÓMICA (evita duplicados con el
//      scheduler de respaldo de Koyeb).
//   3. Manda UN WhatsApp al GRUPO vía WAHA (WhatsApp HTTP API en la VM propia).
//
// CONFIG que asume (ajustá si tu nombre difiere):
//   - Data source (cluster linkeado):  "Cluster0"
//   - Base de datos:                   "salaDeJuegos"
//   - Colección:                       "plays"
//   - Ventana de catch-up:             2 horas
//
// NOTA: el runtime de Atlas lanza "no documents in result" en findOneAndUpdate
// cuando no hay coincidencias (en vez de devolver null) → se maneja con try/catch.
//
// La función debe correr como "System" para poder escribir la bandera.

// ── Configuración de WAHA (WhatsApp HTTP API) ──────────────────────────────
// ⚠️ La API KEY es un SECRETO: NO se sube al repo. Antes de guardar esta función
//    en el panel de Atlas, reemplazá el placeholder de abajo por la key real
//    (la misma X-Api-Key que está en el .env / Koyeb). Ideal: moverla a un
//    Secret de Atlas (Values & Secrets) y leerla con context.values.get(...).
const WAHA_URL = "http://157.151.183.29:3000";
const WAHA_API_KEY = "PEGA-AQUI-LA-API-KEY-DE-WAHA"; // ← reemplazar en el panel de Atlas
const WAHA_SESSION = "default";
const WAHA_CHAT_ID = "120363403807399844@g.us"; // grupo "Hogar 2"
// ───────────────────────────────────────────────────────────────────────────

exports = async function () {
  const db = context.services.get("Cluster0").db("salaDeJuegos");
  const plays = db.collection("plays");

  const AHORA = new Date();
  const DESDE = new Date(AHORA.getTime() - 2 * 60 * 60 * 1000); // catch-up 2h

  // Hora de Costa Rica SIN depender de Intl/timeZone (CR = UTC-6, sin horario de verano)
  const horaCR = (date) => {
    const cr = new Date(new Date(date).getTime() - 6 * 60 * 60 * 1000);
    let h = cr.getUTCHours();
    const m = cr.getUTCMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    const mm = m < 10 ? "0" + m : "" + m;
    return h + ":" + mm + " " + ampm;
  };

  const formatearDuracion = (min) => {
    const total = Number(min);
    if (!isFinite(total) || total <= 0) return "";
    const horas = Math.floor(total / 60);
    const mins = Math.round(total % 60);
    if (horas > 0 && mins > 0) return horas + "h " + mins + "min";
    if (horas > 0) return horas + "h";
    return mins + "min";
  };

  // Convierte "17:12" (24h) → "5:12 PM". Si ya tiene AM/PM o es raro, la deja igual.
  const formatearHora12 = (str) => {
    if (!str) return str;
    const s = String(str).trim();
    if (/[ap]\.?\s*m\.?/i.test(s)) return s;
    const m = s.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return s;
    let h = parseInt(m[1], 10);
    const min = m[2];
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return h + ":" + min + " " + ampm;
  };

  // Formatea colones con separador de miles, sin depender de Intl: "₡1,200"
  const formatearColones = (monto) => {
    const v = Number(monto);
    if (!isFinite(v) || v <= 0) return "";
    const entero = String(Math.round(v));
    let out = "";
    for (let i = 0; i < entero.length; i++) {
      if (i > 0 && (entero.length - i) % 3 === 0) out += ",";
      out += entero[i];
    }
    return "₡" + out;
  };

  // Arma el mensaje detallado con toda la info del play (omite campos vacíos).
  const construirMensaje = (play) => {
    const lineas = ["✅ Terminó la partida", ""];
    lineas.push("🎮 Consola: " + (play.lugarDeJuego || "Estación desconocida"));
    if (play.cliente) lineas.push("👤 Cliente: " + play.cliente);
    if (play.atendio) lineas.push("🧑‍💼 Atendió: " + play.atendio);
    if (play.horaInicio) lineas.push("🕐 Inicio: " + formatearHora12(play.horaInicio));
    lineas.push("🏁 Fin: " + horaCR(play.finProgramado));

    const duracion = formatearDuracion(play.tiempoPagado);
    if (duracion) lineas.push("⏱️ Duración: " + duracion);

    if (Number(play.tiempoPendiente) > 0) {
      lineas.push("⏳ Tiempo pendiente: " + formatearDuracion(play.tiempoPendiente));
    }

    const juegos = Array.isArray(play.juegosJugados) ? play.juegosJugados.filter(Boolean) : [];
    if (juegos.length) lineas.push("🕹️ Juegos: " + juegos.join(", "));

    if (Number(play.controlAdicional) > 0) {
      lineas.push("🎮 Controles adicionales: " + play.controlAdicional);
    }

    const total = formatearColones(play.total);
    if (total) lineas.push("💰 Total: " + total);

    if (play.estadoPago) lineas.push("💳 Estado del pago: " + play.estadoPago);

    return lineas.join("\n");
  };

  // Manda UN mensaje al grupo vía WAHA, con 1 reintento. Devuelve true/false.
  const enviarWaha = async (texto) => {
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const resp = await context.http.post({
          url: WAHA_URL + "/api/sendText",
          headers: {
            "Content-Type": ["application/json"],
            "X-Api-Key": [WAHA_API_KEY],
          },
          body: JSON.stringify({
            session: WAHA_SESSION,
            chatId: WAHA_CHAT_ID,
            text: texto,
          }),
        });
        if (resp.statusCode >= 200 && resp.statusCode < 300) return true;
        console.error("WAHA respondió " + resp.statusCode + " (intento " + intento + ")");
      } catch (e) {
        console.error("Error enviando a WAHA (intento " + intento + "): " + e.message);
      }
    }
    return false;
  };

  let procesados = 0;

  // Reclamo atómico uno por uno: marco la bandera al leer.
  while (true) {
    let play;
    try {
      play = await plays.findOneAndUpdate(
        {
          notificacionFinEnviada: { $ne: true },
          finProgramado: { $ne: null, $lte: AHORA, $gte: DESDE },
        },
        { $set: { notificacionFinEnviada: true } },
        { sort: { finProgramado: 1 } } // returnNewDocument false → devuelve el doc previo
      );
    } catch (e) {
      // El runtime de Atlas lanza este error en vez de devolver null cuando no hay
      // coincidencias → lo tratamos como "no quedan pendientes".
      if (e.message && e.message.includes("no documents in result")) break;
      throw e; // cualquier otro error sí es real
    }
    if (!play) break;
    procesados++;

    const mensaje = construirMensaje(play);
    const ok = await enviarWaha(mensaje);
    console.log((ok ? "✅ OK grupo" : "❌ FALLO grupo") + " :: " + mensaje);
  }

  console.log("Trigger listo. Sesiones notificadas en este ciclo: " + procesados);
};
