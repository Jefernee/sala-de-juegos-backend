// utils/migrarJuegos.js
// Migración idempotente: pasa las TRES listas de juegos al catálogo único.
//
// De dónde sale cada cosa:
//   1. Los 49 nombres que estaban escritos a mano en el formulario de plays.
//   2. Las 5 portadas que estaban escritas a mano en la página pública.
//   3. Los activos ya comprados (juegos y complementos), que se ENLAZAN — no
//      se copian ni se mueven: su costo, su placa y su fecha de compra siguen
//      intactos en la colección de activos, que es la que leen los reportes.
//
// Se corre al arrancar el servidor. Correrla dos veces no cambia nada.
//
// Para ver qué haría sin escribir nada:  npm run migrar-juegos -- --dry
import Juego, { normalizarNombre } from '../models/Juego.js';
import ActivoSala from '../models/ActivoSala.js';
import Play from '../models/plays.js';

// Los juegos que ofrecía el formulario antes de este módulo.
// Copiados tal cual de src/constants/juegos.js del frontend.
const CATALOGO = [
  "Dragon Ball Sparking Zero",
  "FIFA 26",
  "Call of Duty 3",
  "Call of Duty 4",
  "Call of Duty 6",
  "Mortal Kombat 1",
  "Mortal Kombat 11",
  "Mortal Kombat XL",
  "Gran turismo Sport",
  "Gran turismo 7",
  "Kimetsu no Yaiba",
  "Naruto Shippuden",
  "NBA 2K24",
  "GTA V",
  "Minecraft",
  "Fortnite",
  "Rocket League",
  "EA Sports FC",
  "Resident Evil",
  "Spider-Man 2",
  "God of War Ragnarök",
  "Days Gone",
  "Dead Cells",
  "Crash",
  "Stick Fight",
  "Oddballers",
  "Call of Duty Modern Warfare 3",
  "Spider-Man Miles Morales",
  "Naruto to Boruto",
  "FIFA 25",
  "Jurassic World 2",
  "Roblox",
  "World War Z Aftermath",
  "Assetto Corsa",
  "Call of Duty Warzone",
  "Overcooked",
  "Efootball",
  "Minecraft Dungeons",
  "Rayman Legends",
  "Assassin's Creed Valhalla",
  "The Last of Us",
  "God of War",
  "Fall Guys",
  "Sackboy",
  "Need for Speed Heat",
  "Star Wars Jedi",
  "Minecraft Legends",
  "Uncharted 4",
  "Call of Duty 2",
];

// Las portadas de la página pública, con el juego al que corresponde cada una.
// El emparejamiento lo confirmó el dueño: su "Call of Duty 6" es Black Ops 6 y
// su "FIFA 26" es EA FC 26.
const VITRINA = [
  {
    nombre: "Call of Duty Black Ops 6",
    juego: "Call of Duty 6",
    imagen: "https://res.cloudinary.com/drjsg8j92/image/upload/c_scale,w_400,q_auto,f_auto/v1737318750/Captura_de_pantalla_2025-01-11_145419_hgy4zv.png",
    link: "https://www.playstation.com/es-es/ps-plus/",
  },
  {
    nombre: "Grand Theft Auto Five",
    juego: "GTA V",
    imagen: "https://res.cloudinary.com/drjsg8j92/image/upload/c_scale,w_400,q_auto,f_auto/v1737318430/Captura_de_pantalla_2025-01-11_145112_vwsdp4.png",
    link: "https://www.playstation.com/es-es/ps-plus/",
  },
  {
    nombre: "EAFC26",
    juego: "FIFA 26",
    imagen: "https://res.cloudinary.com/drjsg8j92/image/upload/c_scale,w_400,q_auto,f_auto/v1766698701/EA-Sports-FC-26-Release-Date-and-Gameplay-Reveal_pqy8fq.jpg",
    link: "https://www.playstation.com/es-es/ps-plus/",
  },
  {
    nombre: "Mortal Kombat 1",
    juego: "Mortal Kombat 1",
    imagen: "https://res.cloudinary.com/drjsg8j92/image/upload/c_scale,w_400,q_auto,f_auto/v1737318750/Captura_de_pantalla_2025-01-11_150001_nj4eyj.png",
    link: "https://www.playstation.com/es-es/ps-plus/",
  },
  {
    nombre: "Dragon Ball Sparking Zero",
    juego: "Dragon Ball Sparking Zero",
    imagen: "https://res.cloudinary.com/drjsg8j92/image/upload/c_scale,w_400,q_auto,f_auto/v1737318751/Dragon-Ball-Sparking-Zero_pk60kl.png",
    link: "https://www.playstation.com/es-es/ps-plus/",
  },
];

// ── DECISIONES TOMADAS CON EL DUEÑO (19/09/2026) ────────────────────────────
// Los activos de juego que ya existen, y a qué ficha corresponde cada uno.
// Se identifican por PLACA porque es el número que nunca cambia.
//
//   placa 24 "Juego: COD BO2" → es el MISMO que "Call of Duty 2" del selector
//     (en la casa, "Call of Duty 6" es Black Ops 6, así que el 2 es Black Ops 2).
//     No se crea ficha nueva: se le cuelga la compra a la que ya existe.
//   placa 49 "Juego de EA FC 27" → juego nuevo. La ficha se llama "EA FC 27";
//     el activo conserva su nombre de inventario.
const ACTIVOS_JUEGO = {
  24: { ficha: 'Call of Duty 2' },
  49: { ficha: 'EA FC 27' },
};

// Los complementos comprados y de qué juego son. El nombre de la ficha queda
// TAL CUAL está en el inventario: no se inventa nada, y se puede renombrar
// después desde el módulo.
const ACTIVOS_COMPLEMENTO = {
  25: { padre: 'Call of Duty 2' },   // "DLC COD Black Ops 2 usuario Antoyef"
  45: { padre: 'Assetto Corsa' },    // "Compra de Mapa de Asetto Corza..."
};

// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIAS_DE_JUEGO = ['Juegos digitales', 'Juegos físicos'];

// Busca una ficha por nombre (sin tildes ni mayúsculas) entre los juegos.
const buscarJuego = (fichas, nombre) => {
  const clave = normalizarNombre(nombre);
  return fichas.find((f) => !f.padre && f.clave === clave) || null;
};

/**
 * Pasa las tres listas de juegos a la colección `juegos`.
 *
 * IDEMPOTENTE: se puede correr mil veces. Nunca duplica (la clave normalizada
 * es única), nunca pisa una portada que ya esté puesta y nunca toca un activo
 * que ya tenga su enlace.
 *
 * NO borra ni modifica un solo campo de plata: los activos conservan costo,
 * fecha de compra, factura y placa, así que los reportes dan exactamente igual.
 *
 * @param {boolean} dry - true: solo informa lo que haría, sin escribir nada.
 */
export const migrarJuegos = async ({ dry = false } = {}) => {
  const informe = {
    creados: [], enlazados: [], portadas: [], complementos: [],
    yaEstaban: 0, sinCatalogo: [], avisos: [],
  };

  const existentes = await Juego.find().lean();
  const porClave = new Map(existentes.map((f) => [`${f.padre || 'raiz'}|${f.clave}`, f]));
  informe.yaEstaban = existentes.length;

  // Crea una ficha si no existe; si existe, la devuelve. Con dry no escribe.
  const asegurarFicha = async (nombre, { padre = null, origen = 'manual' } = {}) => {
    const clave = normalizarNombre(nombre);
    const llave = `${padre || 'raiz'}|${clave}`;
    if (porClave.has(llave)) return porClave.get(llave);

    const ficha = { nombre: String(nombre).trim(), clave, padre, origen, enVitrina: false };
    if (!dry) {
      const guardada = await Juego.create(ficha);
      porClave.set(llave, guardada.toObject());
      informe.creados.push(nombre);
      return guardada.toObject();
    }
    const simulada = { ...ficha, _id: `simulado:${clave}` };
    porClave.set(llave, simulada);
    informe.creados.push(nombre);
    return simulada;
  };

  // ── 1. Los juegos del selector ─────────────────────────────────────────────
  for (const nombre of CATALOGO) {
    await asegurarFicha(nombre, { origen: 'catalogo' });
  }

  // ── 2. Las portadas de la página pública ───────────────────────────────────
  const fichas = [...porClave.values()];
  for (const v of VITRINA) {
    const ficha = buscarJuego(fichas, v.juego);
    if (!ficha) {
      informe.avisos.push(`La portada de "${v.nombre}" no encontró el juego "${v.juego}"`);
      continue;
    }
    if (ficha.imagenUrl) continue;             // ya tiene portada: no se pisa
    informe.portadas.push(`${ficha.nombre} ← ${v.nombre}`);
    if (!dry) {
      await Juego.updateOne(
        { _id: ficha._id },
        { $set: { imagenUrl: v.imagen, link: v.link, enVitrina: true, origen: 'vitrina' } }
      );
    }
  }

  // ── 3. Los juegos comprados (activos) ──────────────────────────────────────
  const activosJuego = await ActivoSala.find({ categoria: { $in: CATEGORIAS_DE_JUEGO } })
    .select('_id nombre numeroPlaca costo juegoId')
    .lean();

  for (const activo of activosJuego) {
    if (activo.juegoId) continue;              // ya enlazado
    const decision = ACTIVOS_JUEGO[activo.numeroPlaca];
    const nombreFicha = decision?.ficha || activo.nombre;
    const ficha = await asegurarFicha(nombreFicha, { origen: 'activo' });

    informe.enlazados.push(
      `placa ${activo.numeroPlaca} "${activo.nombre}" (₡${activo.costo}) → "${ficha.nombre}"`
    );
    if (!dry) {
      await ActivoSala.updateOne({ _id: activo._id }, { $set: { juegoId: ficha._id } });
    }
  }

  // ── 4. Los complementos comprados ──────────────────────────────────────────
  const activosExtra = await ActivoSala.find({ categoria: 'Complementos' })
    .select('_id nombre numeroPlaca costo juegoId')
    .lean();

  for (const activo of activosExtra) {
    if (activo.juegoId) continue;
    const decision = ACTIVOS_COMPLEMENTO[activo.numeroPlaca];
    if (!decision) {
      // Sin dueño conocido no se adivina: queda suelto y se avisa, para
      // engancharlo a mano desde el módulo.
      informe.avisos.push(
        `El complemento placa ${activo.numeroPlaca} "${activo.nombre}" no tiene juego asignado`
      );
      continue;
    }
    const padre = buscarJuego([...porClave.values()], decision.padre);
    if (!padre) {
      informe.avisos.push(`No encontré el juego "${decision.padre}" para la placa ${activo.numeroPlaca}`);
      continue;
    }
    const hija = await asegurarFicha(activo.nombre, { padre: padre._id, origen: 'activo' });
    informe.complementos.push(
      `placa ${activo.numeroPlaca} "${activo.nombre}" (₡${activo.costo}) → complemento de "${padre.nombre}"`
    );
    if (!dry) {
      await ActivoSala.updateOne({ _id: activo._id }, { $set: { juegoId: hija._id } });
    }
  }

  // ── 5. Red de seguridad: nada de lo que se juega puede quedar afuera ───────
  const desde = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const jugados = await Play.aggregate([
    { $match: { fecha: { $gte: desde } } },
    { $unwind: '$juegosJugados' },
    { $group: { _id: '$juegosJugados', veces: { $sum: 1 } } },
    { $sort: { veces: -1 } },
  ]);
  const todas = [...porClave.values()];
  for (const j of jugados) {
    if (!buscarJuego(todas, j._id)) {
      informe.sinCatalogo.push(`${j._id} (${j.veces} plays)`);
    }
  }

  return informe;
};
