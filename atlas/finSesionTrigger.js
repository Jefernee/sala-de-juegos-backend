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
//   3. Lee los destinatarios ACTIVOS de la colección whatsapp_recipients.
//   4. Manda el WhatsApp a cada uno vía CallMeBot.
//
// CONFIG que asume (ajustá si tu nombre difiere):
//   - Data source (cluster linkeado):  "mongodb-atlas"
//   - Base de datos:                   "salaDeJuegos"
//   - Colecciones:                     "plays", "whatsapp_recipients"
//   - Ventana de catch-up:             2 horas
//
// La función debe correr como "System" para poder escribir la bandera.

exports = async function () {
  const db = context.services.get("mongodb-atlas").db("salaDeJuegos");
  const plays = db.collection("plays");
  const recipientsCol = db.collection("whatsapp_recipients");

  const AHORA = new Date();
  const DESDE = new Date(AHORA.getTime() - 2 * 60 * 60 * 1000); // catch-up 2h

  // Destinatarios activos
  const recipients = await recipientsCol.find({ activo: true }).toArray();
  if (recipients.length === 0) {
    console.log("Sin destinatarios activos; nada que enviar.");
    return;
  }

  // Sleep defensivo (por si el runtime no expone setTimeout)
  const sleep = (ms) =>
    typeof setTimeout === "function" ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

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

  let procesados = 0;

  // Reclamo atómico uno por uno: marco la bandera al leer.
  while (true) {
    const play = await plays.findOneAndUpdate(
      {
        notificacionFinEnviada: { $ne: true },
        finProgramado: { $ne: null, $lte: AHORA, $gte: DESDE },
      },
      { $set: { notificacionFinEnviada: true } },
      { sort: { finProgramado: 1 } } // returnNewDocument false → devuelve el doc previo
    );
    if (!play) break;
    procesados++;

    const consola = play.lugarDeJuego || "Estación";
    const hora = horaCR(play.finProgramado);
    const duracion = formatearDuracion(play.tiempoPagado);
    let mensaje = "✅ Terminó la partida — " + consola + " | " + hora;
    if (duracion) mensaje += " | Duración: " + duracion;

    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      const url =
        "https://api.callmebot.com/whatsapp.php?phone=" + encodeURIComponent(r.telefono) +
        "&text=" + encodeURIComponent(mensaje) +
        "&apikey=" + encodeURIComponent(r.apikey);

      let ok = false;
      for (let intento = 1; intento <= 2 && !ok; intento++) {
        try {
          const resp = await context.http.get({ url });
          if (resp.statusCode >= 200 && resp.statusCode < 300) ok = true;
          else console.error("CallMeBot respondió " + resp.statusCode + " para " + r.telefono);
        } catch (e) {
          console.error("Error enviando a " + r.telefono + " (intento " + intento + "): " + e.message);
        }
      }
      console.log((ok ? "✅ OK " : "❌ FALLO ") + r.telefono + " :: " + mensaje);

      // Pausa entre destinatarios (CallMeBot limita frecuencia), no tras el último.
      if (i < recipients.length - 1) await sleep(2500);
    }
  }

  console.log("Trigger listo. Sesiones notificadas en este ciclo: " + procesados);
};
