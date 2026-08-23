// scripts/clasificarCategorias.js
//
// Clasifica de una sola vez los productos que YA existen en inventario,
// deduciendo la categoría del nombre (y del tipo).
//
// El clasificador y sus listas de palabras viven ACÁ ADENTRO, no en config/,
// porque el controlador ya no los usa: al crear un producto la categoría se
// elige a mano (adivinarla por el nombre falla con las marcas — "Crunchy" y
// "Chokies" son helados y suenan a galleta). Si estuvieran en config/, el
// server cargaría estas listas en cada arranque sin usarlas nunca.
//
// A PROPÓSITO NO está enganchado a las tareas de arranque del servidor: es de
// una sola vez y no tiene por qué importarse ni consultar la base en cada
// reinicio. Se corre a mano, como los demás scripts de esta carpeta.
//
// OJO: pisa la categoría que el producto tenga guardada. Está pensado para
// correrse UNA VEZ, antes de que el dueño empiece a corregir categorías a mano
// desde el formulario. Después de eso, no volver a correrlo: borraría esas
// correcciones. De ahí en adelante el controlador se encarga solo (y respeta
// siempre la categoría que venga en el payload).
//
// Uso:
//   node scripts/clasificarCategorias.js            → muestra qué haría (simulación)
//   node scripts/clasificarCategorias.js aplicar    → guarda los cambios
//
// Requiere MONGO_URI en el .env. No toca stock, precios, imágenes ni recetas:
// solo escribe el campo `categoria`.
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { CATEGORIAS_PRODUCTO, CATEGORIA_POR_DEFECTO } from '../config/categoriasProducto.js';

// Algunos ISP no resuelven registros SRV (mongodb+srv); forzamos DNS públicos.
dns.setDefaultResultOrder('ipv4first');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* no crítico */ }
dotenv.config({ quiet: true });

// ─────────────────────────────────────────────────────────────────
// Clasificación automática por nombre.
//
// Solo se usa cuando el payload NO trae `categoria`. Si el dueño la mandó
// desde el formulario, esa gana siempre y esto no corre: si la clasificación
// automática pisara la corrección manual, el dueño estaría corrigiendo lo
// mismo para siempre.
//
// El orden de las reglas importa y está pensado para los choques reales del
// inventario; ver `deducirCategoria` abajo.
// ─────────────────────────────────────────────────────────────────

// Minúsculas y sin acentos. La ñ se descompone en NFD y queda como "n", así
// que "melocotón" → "melocoton" y "pequeño" → "pequeno".
const normalizarTexto = (texto) =>
  String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// Parte en palabras por todo lo que no sea letra o número.
const partirEnPalabras = (texto) => texto.split(/[^a-z0-9]+/).filter(Boolean);

// ─────────────────────────────────────────────────────────────────
// Comparación por PALABRA COMPLETA, aguantando el plural.
//
// Con "incluye" esto se rompe solo: "papa" se llevaría "papaya" y "te" se
// llevaría cualquier nombre con esas dos letras seguidas ("tropical",
// "chocolate"). Por eso se compara palabra contra palabra, aceptando que la
// del nombre sea la pista + "s" o + "es" ("chokies" = "chokie" + "s").
// ─────────────────────────────────────────────────────────────────
const tienePalabraDe = (palabras, pistas) =>
  palabras.some(
    (p) =>
      pistas.has(p) ||
      (p.endsWith('s') && pistas.has(p.slice(0, -1))) ||
      (p.endsWith('es') && pistas.has(p.slice(0, -2)))
  );

const HELADOS = new Set([
  'helado', 'heladito', 'cono', 'conito', 'barquillo', 'sundae', 'sorbete',
  'sorbeto', 'nieve', 'paleta', 'paletita', 'granizado', 'copa', 'banana',
  'split', 'bola', 'frappe', 'malteada', 'milkshake',
  'trits', 'extremo', 'choco', 'cremoso', 'boli', 'bolis',
  // "vaso" y "vasito" NO van acá: mandaban los vasos desechables a helados.
  // No hace falta caso especial — un "Vaso 2 bolas" sigue cayendo en helados
  // por la palabra "bolas".
  //
  // Marcas de helado que no tienen ninguna palabra que lo diga. Estaban en la
  // lista de snacks (el nombre suena a galleta o a chocolate) y por eso caían
  // mal. Un nombre de marca no se puede deducir: hay que anotarlo acá.
  'crunchy', 'choki', 'chokis', 'chokie', 'chokies',
]);

const BEBIDAS = new Set([
  'cola', 'coca', 'pepsi', 'fanta', 'sprite', 'fresca', 'tropical', 'gaseosa',
  'refresco', 'fresco', 'jugo', 'juice', 'agua', 'soda', 'malta', 'kern', 'te',
  'cafe', 'capuchino', 'gatorade', 'powerade', 'hidratante', 'energizante',
  'monster', 'leche', 'batido', 'smoothie', 'naranjada', 'limonada', 'tampico',
  'frutazo', 'cerveza', 'imperial', 'pilsen', 'yogurt', 'cristal', 'alpina',
  'botella', 'lata', 'cappy',
]);

const SNACKS = new Set([
  'ranchita', 'ranchitas', 'tostines', 'tostin', 'meneito', 'meneitos',
  'gallito', 'gallitos', 'tortrix', 'yuquita', 'yuquitas', 'platanito',
  'platanitos', 'chicharron', 'chicharrones', 'cheetos', 'doritos', 'pringles',
  'rufles', 'ruffles', 'tosti', 'tostitos', 'nacho', 'nachos', 'papa', 'papas',
  'chips', 'palomita', 'palomitas', 'popcorn', 'mani', 'semilla', 'semillas',
  'pretzel', 'galleta', 'galletas', 'chiky', 'pozuelo', 'oreo', 'festival',
  'duquesa', 'merienda', 'trencito', 'emperador', 'maria', 'marias', 'wafer',
  'churro', 'churros', 'queque', 'empanada', 'sandwich', 'pan', 'chicle',
  'chicles', 'trident', 'halls', 'bubbaloo', 'confite', 'confites', 'caramelo',
  'caramelos', 'dulce', 'dulces', 'gomita', 'gomitas', 'chupeta', 'mentita',
  'mentitas', 'menta', 'toffee', 'salvavidas', 'chocolate', 'chocolatina',
  'snickers', 'jet', 'rolos', 'barra', 'barrita', 'snack', 'snacks',
  'marshmelo', 'marshmelos', 'marshmallow', 'malvavisco', 'malvaviscos',
  'angelito', 'angelitos', 'tapita',
  'tapitas', 'taquerito', 'taqueritos', 'marshmello', 'marshmellos',
  'bombon', 'bombones', 'gelatina', 'gelatinas', 'taco', 'tacos',
  // Marcas de la sala que no dicen nada por sí solas. "yummi" agarra
  // "Yummi Pops"; "yummix" va aparte porque el plural que se acepta es +s/+es
  // y "yummix" no sale de "yummi".
  'chao', 'yummi', 'yummix',
]);

// Marcas que se escriben de corrido tanto como separadas ("CocaCola" / "Coca
// Cola"). Estas SÍ van por "contiene", pero sobre el nombre sin espacios ni
// signos, que es la única forma de agarrar las dos variantes.
const BEBIDAS_PEGADAS = ['cocacola', 'redbull', 'sevenup', 'delvalle', 'chocolatecaliente', 'bigcola'];
const SNACKS_PEGADAS = ['chupachups', 'milkyway'];

const tieneAlgunaPegada = (pegado, lista) => lista.some((m) => pegado.includes(m));

// Un número seguido de una unidad de volumen: "600ml", "2.5l", "1 lt".
const VOLUMEN_REGEX = /\d[\d.,]*\s?(ml|cc|lt|litros?|l)\b/;

// ─────────────────────────────────────────────────────────────────
// Devuelve la categoría deducida del nombre (y del tipo).
// Gana la primera regla que acierta:
//
//   0. receta                → preparados  (se arma en el mostrador)
//   1. palabra de helados    → helados
//   2. lleva volumen         → bebidas
//   3. palabra de bebidas    → bebidas
//   4. palabra de snacks     → snacks
//   5. nada                  → otros
//
// Por qué el volumen va ANTES de snacks: "Jet 600ml" es un jugo, no la
// chocolatina Jet. Y por qué helados va antes que el volumen: un "Helado
// Barrilete 1l" sigue siendo helado, no bebida.
// ─────────────────────────────────────────────────────────────────
const deducirCategoria = (nombre, tipo) => {
  if (tipo === 'receta') return 'preparados';

  const texto = normalizarTexto(nombre);
  const palabras = partirEnPalabras(texto);
  const pegado = texto.replace(/[^a-z0-9]/g, '');

  if (tienePalabraDe(palabras, HELADOS)) return 'helados';
  if (VOLUMEN_REGEX.test(texto)) return 'bebidas';
  if (tienePalabraDe(palabras, BEBIDAS) || tieneAlgunaPegada(pegado, BEBIDAS_PEGADAS)) return 'bebidas';
  if (tienePalabraDe(palabras, SNACKS) || tieneAlgunaPegada(pegado, SNACKS_PEGADAS)) return 'snacks';

  return CATEGORIA_POR_DEFECTO;
};

const APLICAR = process.argv[2] === 'aplicar';

const run = async () => {
  if (!process.env.MONGO_URI) {
    console.error('❌ Falta MONGO_URI en el .env.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const Inv = mongoose.connection.collection('inventarios');

  console.log(APLICAR ? '🔧 MODO APLICAR\n' : '👀 SIMULACIÓN (no se cambia nada). Corré con "aplicar" para guardar.\n');

  const items = await Inv.find({}, { projection: { nombre: 1, tipo: 1, categoria: 1 } })
    .sort({ nombre: 1 })
    .toArray();

  const conteo = Object.fromEntries(CATEGORIAS_PRODUCTO.map((c) => [c, 0]));
  let cambian = 0;

  console.log('producto'.padEnd(34) + '| tipo     | antes      | ahora');
  console.log('-'.repeat(34) + '|----------|------------|------------');

  for (const item of items) {
    const tipo = item.tipo || 'producto';
    const nueva = deducirCategoria(item.nombre, tipo);
    const antes = item.categoria || '(sin)';
    conteo[nueva]++;

    const cambia = antes !== nueva;
    if (cambia) cambian++;

    const nombre = String(item.nombre || '').slice(0, 33);
    console.log(
      nombre.padEnd(34) + '| ' + tipo.padEnd(9) + '| ' + antes.padEnd(11) + '| ' + nueva + (cambia ? '' : '   (igual)')
    );

    // Nota: NO se toca updatedAt. Es una clasificación de arrastre, no una
    // edición del producto hecha por el dueño.
    if (APLICAR && cambia) await Inv.updateOne({ _id: item._id }, { $set: { categoria: nueva } });
  }

  console.log('\nResumen por categoría:');
  for (const c of CATEGORIAS_PRODUCTO) console.log(`  ${c.padEnd(12)} ${conteo[c]}`);
  console.log(`\nTotal productos: ${items.length} | ${APLICAR ? 'actualizados' : 'cambiarían'}: ${cambian}`);

  if (!APLICAR && cambian > 0) console.log('\n👉 Corré con "aplicar" para guardarlo.');

  await mongoose.disconnect();
};

run().catch((e) => { console.error('❌ ERROR:', e.message); process.exit(1); });
