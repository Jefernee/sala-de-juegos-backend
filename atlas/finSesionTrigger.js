// atlas/finSesionTrigger.js
// Función para el SCHEDULED TRIGGER de MongoDB Atlas.
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
//   4. Si el envío falla de forma COMPROBADA (WAHA contestó error, o no se pudo
//      conectar), DEVUELVE la bandera a false para reintentar en el ciclo
//      siguiente. Sin esto, un rato de WhatsApp desconectado perdía los avisos en
//      silencio: quedaban marcados como enviados sin haber salido nunca.
//      Si el fallo es AMBIGUO (timeout: el mensaje pudo haber salido) NO se
//      devuelve la bandera, para no arriesgar un duplicado.
//      Tope de MAX_INTENTOS por play para no reintentar eternamente.
//   5. Cuando un aviso se RINDE, manda una ALERTA POR CORREO (vía Resend). Es el
//      único momento en que sabemos que un aviso se perdió, y hay que enterarse
//      sin depender de que alguien mire los logs. El enfriamiento se comparte con
//      el backend por la colección "alertas_email" (ver models/AlertaEmail.js):
//      así Atlas y Koyeb no mandan los dos el mismo correo.
//
// CONFIG que asume (ajustá si tu nombre difiere):
//   - Data source (cluster linkeado):  "Cluster0"
//   - Base de datos:                   "salaDeJuegos"
//   - Colección:                       "plays" (+ "alertas_email" para el correo)
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
const MAX_INTENTOS = 5; // reintentos por play antes de rendirse

// ── Alertas por correo (Resend) ────────────────────────────────────────────
// ⚠️ También es un SECRETO: reemplazar el placeholder en el panel de Atlas.
//    Poné RESEND_API_KEY en "" para desactivar el correo desde este trigger.
const RESEND_API_KEY = "PEGA-AQUI-LA-API-KEY-DE-RESEND"; // ← reemplazar en el panel
const ALERTA_EMAIL_TO = "jefernee50@gmail.com";
const ALERTA_EMAIL_FROM = "Sala de Juegos <onboarding@resend.dev>";
const ALERTA_COOLDOWN_MIN = 120; // no repetir el mismo correo antes de 2 h
// ───────────────────────────────────────────────────────────────────────────

exports = async function () {
  const db = context.services.get("Cluster0").db("salaDeJuegos");
  const plays = db.collection("plays");
  const alertas = db.collection("alertas_email");

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

    // Controles usados en la partida: SIEMPRE se muestra. Fallback para plays
    // viejos sin totalControles: derivar de controlAdicional (2 gratis + cobrados).
    const totalControles = Number(play.totalControles) >= 1
      ? Number(play.totalControles)
      : (Number(play.controlAdicional) > 0 ? Number(play.controlAdicional) + 2 : 2);
    lineas.push("🎮 Controles: " + totalControles);

    const total = formatearColones(play.total);
    if (total) lineas.push("💰 Total: " + total);

    if (play.estadoPago) lineas.push("💳 Estado del pago: " + play.estadoPago);

    // Recordatorio de devolución de controles (acción para el encargado).
    lineas.push("");
    lineas.push(totalControles === 1
      ? "⚠️ Debe estar 1 control. Revisá que todo esté bien."
      : "⚠️ Deben estar " + totalControles + " controles. Revisá que todo esté bien.");

    return lineas.join("\n");
  };

  // Manda UN mensaje al grupo vía WAHA, con 1 reintento.
  // Devuelve { ok, entregaDescartada, motivo }:
  //   entregaDescartada = true  → seguro que NO salió (WAHA rechazó o no hubo
  //                               conexión) → se puede reintentar sin duplicar.
  //   entregaDescartada = false → ambiguo (timeout) → NO reintentar.
  const enviarWaha = async (texto) => {
    let algunoAmbiguo = false;
    let motivo = "";
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
        if (resp.statusCode >= 200 && resp.statusCode < 300) {
          return { ok: true };
        }
        // WAHA contestó y rechazó → el mensaje no salió.
        motivo = "WAHA respondió " + resp.statusCode;
        console.error(motivo + " (intento " + intento + ")");
      } catch (e) {
        motivo = e.message || "error de conexión";
        // Un timeout es ambiguo: el mensaje pudo haberse entregado igual.
        if (/timeout|timed out|deadline/i.test(motivo)) algunoAmbiguo = true;
        console.error("Error enviando a WAHA (intento " + intento + "): " + motivo);
      }
    }
    return { ok: false, entregaDescartada: !algunoAmbiguo, motivo: motivo };
  };

  // ── Alerta por correo cuando un aviso se pierde ──────────────────────────
  // Reclama el turno de forma ATÓMICA contra "alertas_email": solo manda el
  // correo si el último de esa clave salió hace más de ALERTA_COOLDOWN_MIN.
  // Como el backend de Koyeb usa la MISMA colección y la misma clave, entre los
  // dos motores sale UN solo correo aunque los dos estén fallando a la vez.
  // Devuelve true si le toca mandar.
  const reclamarTurnoAlerta = async (clave, detalle) => {
    const limite = new Date(AHORA.getTime() - ALERTA_COOLDOWN_MIN * 60 * 1000);
    try {
      const r = await alertas.updateOne(
        { clave: clave, ultimoEnvio: { $lte: limite } },
        {
          $set: { ultimoEnvio: AHORA, ultimoDetalle: String(detalle || "").slice(0, 500), suprimidas: 0 },
          $inc: { veces: 1 },
        },
        { upsert: true }
      );
      // matchedCount > 0 → ya pasó el enfriamiento. upsertedId → primera vez.
      return r.matchedCount > 0 || !!r.upsertedId;
    } catch (e) {
      // Choque con el índice único de `clave` = el documento existe pero está en
      // enfriamiento (el filtro no coincidió y por eso intentó insertar).
      if (/E11000|duplicate key/i.test(e.message || "")) {
        await alertas
          .updateOne({ clave: clave }, { $inc: { suprimidas: 1 } })
          .catch(function () {});
        return false;
      }
      console.error("No se pudo consultar el enfriamiento de alertas: " + e.message);
      return true; // ante la duda, avisar
    }
  };

  // Manda el correo por la API de Resend. Nunca lanza.
  const enviarCorreoAlerta = async (asunto, cuerpo) => {
    if (!RESEND_API_KEY || RESEND_API_KEY.indexOf("PEGA-AQUI") === 0) {
      console.error("Alerta por correo NO enviada: falta la API key de Resend en el trigger.");
      return;
    }
    try {
      const resp = await context.http.post({
        url: "https://api.resend.com/emails",
        headers: {
          "Content-Type": ["application/json"],
          Authorization: ["Bearer " + RESEND_API_KEY],
        },
        body: JSON.stringify({
          from: ALERTA_EMAIL_FROM,
          to: [ALERTA_EMAIL_TO],
          subject: asunto,
          text: cuerpo,
        }),
      });
      if (resp.statusCode >= 200 && resp.statusCode < 300) {
        console.log("📧 Alerta por correo enviada a " + ALERTA_EMAIL_TO);
      } else {
        console.error("Resend respondió " + resp.statusCode + " al mandar la alerta.");
      }
    } catch (e) {
      console.error("No se pudo mandar la alerta por correo: " + e.message);
    }
  };

  // Avisa que un aviso de fin de sesión se perdió del todo.
  const alertarAvisoPerdido = async (play, motivo, intentos) => {
    const clave = "whatsapp-aviso-fallido"; // MISMA clave que usa el backend
    const permitido = await reclamarTurnoAlerta(clave, motivo);
    if (!permitido) return; // en enfriamiento: ya se avisó hace poco

    const cuerpo = [
      "No se pudo avisar por WhatsApp que terminó una partida.",
      "",
      "🎮 Consola: " + (play.lugarDeJuego || "estación desconocida"),
      play.cliente ? "👤 Cliente: " + play.cliente : "",
      "🏁 Fin programado: " + (play.finProgramado ? horaCR(play.finProgramado) : "sin dato"),
      "🔁 Intentos: " + intentos,
      "⚙️ Motor: Atlas (trigger principal)",
      "❌ Motivo: " + (motivo || "sin detalle"),
      "",
      "QUÉ HACER:",
      "1. Revisá el estado de la sesión de WhatsApp en el dashboard de WAHA.",
      "   Si dice SCAN_QR_CODE, hay que escanear el QR con el teléfono.",
      "2. Mirá el log del watchdog en la VM: sudo tail -50 /var/log/waha-watchdog.log",
      "3. Guía completa: NOTIFICACIONES_WHATSAPP.md en el repo del backend.",
      "",
      "───────────────",
      "No se repite este aviso por " + ALERTA_COOLDOWN_MIN + " minutos.",
    ].filter(Boolean).join("\n");

    await enviarCorreoAlerta("🔴 No salió el aviso de WhatsApp de fin de sesión", cuerpo);
  };

  let enviados = 0;
  let fallidos = 0;

  // Reclamo atómico uno por uno: marco la bandera al leer.
  while (true) {
    let play;
    try {
      play = await plays.findOneAndUpdate(
        {
          notificacionFinEnviada: { $ne: true },
          finProgramado: { $ne: null, $lte: AHORA, $gte: DESDE },
        },
        {
          $set: { notificacionFinEnviada: true },
          $inc: { intentosNotificacion: 1 },
        },
        { sort: { finProgramado: 1 } } // returnNewDocument false → devuelve el doc previo
      );
    } catch (e) {
      // El runtime de Atlas lanza este error en vez de devolver null cuando no hay
      // coincidencias → lo tratamos como "no quedan pendientes".
      if (e.message && e.message.includes("no documents in result")) break;
      throw e; // cualquier otro error sí es real
    }
    if (!play) break;

    const mensaje = construirMensaje(play);
    const res = await enviarWaha(mensaje);

    if (res.ok) {
      enviados++;
      console.log("✅ OK grupo :: " + mensaje);
      continue;
    }

    fallidos++;
    // +1 porque `play` es el documento ANTERIOR al $inc.
    const intentosHechos = Number(play.intentosNotificacion || 0) + 1;

    if (!res.entregaDescartada) {
      console.error(
        "⚠️ AMBIGUO play " + play._id + " (" + res.motivo + "). " +
        "Queda marcado como enviado para no arriesgar un duplicado."
      );
      continue;
    }

    if (intentosHechos >= MAX_INTENTOS) {
      console.error(
        "❌ RENDIDO play " + play._id + " tras " + intentosHechos + " intentos (" +
        res.motivo + "). Revisá la sesión de WhatsApp en WAHA."
      );
      // Este aviso se perdió: hay que enterarse por otro canal que no sea WhatsApp.
      await alertarAvisoPerdido(play, res.motivo, intentosHechos);
      continue;
    }

    // Devolvemos la bandera para reintentar en el ciclo siguiente.
    await plays.updateOne(
      { _id: play._id },
      { $set: { notificacionFinEnviada: false } }
    );
    console.warn(
      "🔁 REINTENTO play " + play._id + " (" + res.motivo + ") — intento " +
      intentosHechos + "/" + MAX_INTENTOS + ". Se reintenta en el próximo ciclo."
    );
    // WAHA/WhatsApp está caído: cortamos el ciclo para no golpearlo con el resto
    // de los pendientes. El próximo minuto vuelve a intentar.
    break;
  }

  console.log(
    "Trigger listo. Avisos enviados: " + enviados + " | fallidos: " + fallidos
  );
};
