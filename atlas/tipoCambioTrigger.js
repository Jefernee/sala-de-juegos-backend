// atlas/tipoCambioTrigger.js
// Función para un SEGUNDO SCHEDULED TRIGGER de MongoDB Atlas.
//
// ⚠️ Este archivo NO corre en el backend de Node. Es para PEGARLO en el panel de
// Atlas (App Services → Triggers → Function), igual que finSesionTrigger.js.
//
// QUÉ HACE (todos los días a las 7:00 AM de Costa Rica):
//   1. Consulta el tipo de cambio del dólar del día.
//   2. Manda UN WhatsApp con la compra y la venta al número personal del
//      administrador (NO al grupo de la sala: esto no le interesa al resto).
//   3. Guarda el valor del día para poder decir en el mensaje siguiente si el
//      dólar subió o bajó respecto a la última vez.
//
// POR QUÉ EN ATLAS Y NO EN EL BACKEND:
//   Koyeb (plan gratis) duerme el contenedor cuando no hay tráfico, y a las 7 AM
//   está dormido con toda seguridad. Un setInterval en el backend simplemente no
//   se ejecutaría. Atlas nunca duerme.
//
// CRON: "0 13 * * *"  →  13:00 UTC = 7:00 AM en Costa Rica.
//   Costa Rica es UTC-6 TODO el año (no hay horario de verano), así que esta
//   cuenta no se desfasa nunca. Atlas interpreta el cron SIEMPRE en UTC.
//
// CONFIG que asume:
//   - Data source (cluster linkeado):  ver NOMBRES_DATA_SOURCE abajo
//   - Base de datos:                   "salaDeJuegos"
//   - Colección:                       "tipo_cambio_historial" (la crea sola)
//
// La función debe correr como "System" para poder escribir en la colección.
//
// SOBRE LA BASE DE DATOS: solo se usa para el "subió/bajó desde ayer", que es un
// extra. Si el data source no aparece con ninguno de los nombres conocidos, el
// mensaje se manda IGUAL, sin esa línea. Nunca dejamos de avisar el tipo de
// cambio por un problema de configuración de la base.

// ── Configuración ──────────────────────────────────────────────────────────
// ⚠️ La API KEY es un SECRETO: NO se sube al repo. Antes de guardar esta función
//    en el panel de Atlas, reemplazá el placeholder por la key real (la misma
//    X-Api-Key que usa el trigger de fin de sesión).
const WAHA_URL = "http://157.151.183.29:3000";
const WAHA_API_KEY = "PEGA-AQUI-LA-API-KEY-DE-WAHA"; // ← reemplazar en el panel de Atlas
const WAHA_SESSION = "default";

// Destino: el número PERSONAL, no el grupo. En WAHA un chat individual se
// escribe como "<código de país><número>@c.us" (sin +, sin espacios ni guiones).
const DESTINO = "50686825481@c.us"; // +506 8682 5481

// Fuentes del tipo de cambio, en orden. Si la primera falla se usa la segunda:
// son servicios públicos gratuitos y de vez en cuando se caen.
//   1. Ministerio de Hacienda (la misma que ya usa el módulo de finanzas
//      personales del backend, ver controllers/finanzasPersonalesController.js).
//   2. tipodecambio.paginasweb.cr (espejo de los datos del BCCR).
const FUENTE_HACIENDA = "https://api.hacienda.go.cr/indicadores/tc/dolar";
const FUENTE_RESPALDO = "https://tipodecambio.paginasweb.cr/api";

// Nombres posibles del cluster enlazado, en orden. El nombre depende de cómo se
// creó la app de App Services: "Cluster0" si se enlazó a mano, "mongodb-atlas"
// si lo creó Atlas solo. Si tu app usa otro, agregalo acá adelante.
// El nombre real se ve en App Services → Linked Data Sources.
const NOMBRES_DATA_SOURCE = ["Cluster0", "mongodb-atlas"];
const NOMBRE_DB = "salaDeJuegos";
// ───────────────────────────────────────────────────────────────────────────

exports = async function () {
  // Buscar el cluster probando los nombres conocidos. Devuelve null si ninguno
  // existe: en ese caso seguimos sin historial en vez de reventar.
  const buscarHistorial = () => {
    for (let i = 0; i < NOMBRES_DATA_SOURCE.length; i++) {
      const nombre = NOMBRES_DATA_SOURCE[i];
      try {
        const servicio = context.services.get(nombre);
        if (servicio) {
          const col = servicio.db(NOMBRE_DB).collection("tipo_cambio_historial");
          console.log("Data source encontrado: " + nombre);
          return col;
        }
      } catch (e) {
        // Nombre equivocado: probamos el siguiente.
      }
    }
    console.error(
      "⚠️ No se encontró el data source (probé: " + NOMBRES_DATA_SOURCE.join(", ") +
      "). El mensaje se manda igual, pero SIN la comparación con el día anterior. " +
      "Mirá el nombre real en App Services → Linked Data Sources y agregalo a NOMBRES_DATA_SOURCE."
    );
    return null;
  };

  const historial = buscarHistorial();

  const AHORA = new Date();

  // ── Fecha en Costa Rica, en español y sin depender de Intl ───────────────
  // El runtime de Atlas tiene soporte limitado de zonas horarias e idiomas, así
  // que la armamos a mano. CR = UTC-6 fijo (sin horario de verano).
  const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
                 "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  const fechaCR = new Date(AHORA.getTime() - 6 * 60 * 60 * 1000);
  const fechaTexto =
    DIAS[fechaCR.getUTCDay()] + " " + fechaCR.getUTCDate() + " de " +
    MESES[fechaCR.getUTCMonth()] + " del " + fechaCR.getUTCFullYear();

  // Día CR como "YYYY-MM-DD": es la llave del historial (un registro por día).
  const dosDigitos = (n) => (n < 10 ? "0" + n : "" + n);
  const diaCR =
    fechaCR.getUTCFullYear() + "-" +
    dosDigitos(fechaCR.getUTCMonth() + 1) + "-" +
    dosDigitos(fechaCR.getUTCDate());

  // ── FRENO: un solo mensaje por día ───────────────────────────────────────
  // El aviso es DIARIO, así que correr esta función de más NO debe mandar otro
  // mensaje. Sin este freno, un cron mal escrito (por ejemplo "* * * * *" en vez
  // de "0 13 * * *") manda un WhatsApp por minuto, y cada clic en "Run" del panel
  // manda otro. Pasó el 29-jul-2026 probando el trigger.
  //
  // Para reenviar el de hoy a propósito: borrar el registro del día con
  //   db.tipo_cambio_historial.deleteOne({ dia: "AAAA-MM-DD" })
  // o ponerle avisado: false.
  if (historial) {
    try {
      const yaAvisadoHoy = await historial.findOne({ dia: diaCR, avisado: true });
      if (yaAvisadoHoy) {
        console.log(
          "Ya se mandó el tipo de cambio de hoy (" + diaCR + "). No se manda de nuevo. " +
          "Si querés reenviarlo, borrá ese día de tipo_cambio_historial."
        );
        return;
      }
    } catch (e) {
      // Si no se puede consultar, seguimos: preferimos avisar de más que no avisar.
      console.error("No se pudo verificar si ya se avisó hoy: " + e.message);
    }
  }

  // El día de ayer en CR, para poder decir "desde ayer" en vez de una fecha.
  const ayerCRDate = new Date(fechaCR.getTime() - 24 * 60 * 60 * 1000);
  const diaAyerCR =
    ayerCRDate.getUTCFullYear() + "-" +
    dosDigitos(ayerCRDate.getUTCMonth() + 1) + "-" +
    dosDigitos(ayerCRDate.getUTCDate());

  // "2026-07-28" → "ayer" o "28 de julio" (una fecha ISO en el mensaje se lee mal).
  const diaLegible = (iso) => {
    if (iso === diaAyerCR) return "ayer";
    const p = String(iso).split("-");
    if (p.length !== 3) return iso;
    const mes = MESES[Number(p[1]) - 1];
    return mes ? "el " + Number(p[2]) + " de " + mes : "el " + iso;
  };

  // Formatea un monto en colones con dos decimales: 505.5 → "₡505.50".
  const colones = (valor) => {
    const n = Number(valor);
    if (!isFinite(n)) return "—";
    const partes = n.toFixed(2).split(".");
    let entero = "";
    for (let i = 0; i < partes[0].length; i++) {
      if (i > 0 && (partes[0].length - i) % 3 === 0) entero += ",";
      entero += partes[0][i];
    }
    return "₡" + entero + "." + partes[1];
  };

  // ── Traer el tipo de cambio ──────────────────────────────────────────────
  // Devuelve { compra, venta, fuente } o null si ninguna fuente respondió.
  const consultar = async (url, extraer, nombre) => {
    try {
      const resp = await context.http.get({
        url: url,
        headers: { Accept: ["application/json"] },
      });
      if (resp.statusCode < 200 || resp.statusCode >= 300) {
        console.error(nombre + " respondió " + resp.statusCode);
        return null;
      }
      const data = JSON.parse(resp.body.text());
      const valores = extraer(data);
      // Sanidad: el dólar en CR ronda los ₡500. Si viene algo absurdo (0, null,
      // un texto de error), preferimos pasar a la otra fuente antes que mandar
      // un mensaje con un número inventado.
      if (!isFinite(valores.compra) || !isFinite(valores.venta) ||
          valores.compra <= 0 || valores.venta <= 0 ||
          valores.compra > 5000 || valores.venta > 5000) {
        console.error(nombre + " devolvió valores fuera de rango: " + JSON.stringify(valores));
        return null;
      }
      return { compra: valores.compra, venta: valores.venta, fuente: nombre };
    } catch (e) {
      console.error("Error consultando " + nombre + ": " + e.message);
      return null;
    }
  };

  let tc = await consultar(
    FUENTE_HACIENDA,
    (d) => ({ compra: Number(d.compra && d.compra.valor), venta: Number(d.venta && d.venta.valor) }),
    "Ministerio de Hacienda"
  );

  if (!tc) {
    console.log("Hacienda no sirvió, probando la fuente de respaldo...");
    tc = await consultar(
      FUENTE_RESPALDO,
      (d) => ({ compra: Number(d.compra), venta: Number(d.venta) }),
      "tipodecambio.paginasweb.cr"
    );
  }

  // ── Comparar con el último dato guardado ─────────────────────────────────
  // Solo para poder decir "subió ₡1.50 desde ayer". Si no hay historial (primer
  // día) o falla la consulta, el mensaje sale igual, sin la comparación.
  let comparacion = "";
  if (tc && historial) {
    try {
      const previos = await historial.find({ dia: { $ne: diaCR } })
        .sort({ dia: -1 })
        .limit(1)
        .toArray();
      const previo = previos[0];
      if (previo && isFinite(Number(previo.venta))) {
        const dif = tc.venta - Number(previo.venta);
        const redondeada = Math.round(dif * 100) / 100;
        const cuando = diaLegible(previo.dia);
        if (redondeada > 0) {
          comparacion = "📈 Subió " + colones(redondeada) + " desde " + cuando + ".";
        } else if (redondeada < 0) {
          comparacion = "📉 Bajó " + colones(Math.abs(redondeada)) + " desde " + cuando + ".";
        } else {
          comparacion = "➖ Sin cambios desde " + cuando + ".";
        }
      }
    } catch (e) {
      console.error("No se pudo comparar con el día anterior: " + e.message);
    }
  }

  // ── Armar el mensaje ─────────────────────────────────────────────────────
  let mensaje;
  if (tc) {
    const lineas = [
      "💵 *Tipo de cambio del dólar*",
      "📅 " + fechaTexto,
      "",
      "🟢 Compra: " + colones(tc.compra),
      "🔴 Venta: " + colones(tc.venta),
    ];
    if (comparacion) {
      lineas.push("");
      lineas.push(comparacion);
    }
    lineas.push("");
    lineas.push("_Compra: lo que te dan por cada $1._");
    lineas.push("_Venta: lo que te cuesta cada $1._");
    lineas.push("");
    lineas.push("Fuente: " + tc.fuente);
    mensaje = lineas.join("\n");
  } else {
    // Ninguna fuente respondió. Mandamos el aviso igual: es preferible saber que
    // hoy no hay dato a quedarse esperando un mensaje que nunca llega.
    mensaje = [
      "💵 *Tipo de cambio del dólar*",
      "📅 " + fechaTexto,
      "",
      "⚠️ Hoy no se pudo consultar el tipo de cambio: las dos fuentes fallaron.",
      "Se vuelve a intentar mañana.",
    ].join("\n");
  }

  // ── Mandar el WhatsApp (con 1 reintento) ─────────────────────────────────
  let enviado = false;
  for (let intento = 1; intento <= 2 && !enviado; intento++) {
    try {
      const resp = await context.http.post({
        url: WAHA_URL + "/api/sendText",
        headers: {
          "Content-Type": ["application/json"],
          "X-Api-Key": [WAHA_API_KEY],
        },
        body: JSON.stringify({
          session: WAHA_SESSION,
          chatId: DESTINO,
          text: mensaje,
        }),
      });
      if (resp.statusCode >= 200 && resp.statusCode < 300) {
        enviado = true;
      } else {
        console.error("WAHA respondió " + resp.statusCode + " (intento " + intento + ")");
      }
    } catch (e) {
      console.error("Error enviando a WAHA (intento " + intento + "): " + e.message);
    }
  }

  // ── Guardar el dato del día ──────────────────────────────────────────────
  // Se guarda aunque el WhatsApp haya fallado: el valor sirve igual para la
  // comparación de mañana. upsert por día → correrlo dos veces no duplica.
  //
  // `avisado` es lo que activa el freno de arriba, y solo se marca si el mensaje
  // SALIÓ. Si el envío falló, el día queda sin marcar y la próxima corrida vuelve
  // a intentarlo: así un fallo de WhatsApp no nos deja sin aviso del día.
  if (historial && (tc || enviado)) {
    try {
      const datos = { dia: diaCR, actualizado: AHORA };
      if (tc) {
        datos.compra = tc.compra;
        datos.venta = tc.venta;
        datos.fuente = tc.fuente;
      }
      if (enviado) {
        datos.avisado = true;
        datos.avisadoEn = AHORA;
      }
      await historial.updateOne({ dia: diaCR }, { $set: datos }, { upsert: true });
    } catch (e) {
      console.error("No se pudo guardar el tipo de cambio del día: " + e.message);
    }
  }

  console.log(
    (enviado ? "✅ Enviado" : "❌ NO enviado") + " a " + DESTINO + " :: " +
    mensaje.replace(/\n/g, " | ")
  );
};
