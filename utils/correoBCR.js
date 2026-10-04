// utils/correoBCR.js
// Lee el correo "Notificación de Transacciones BCR" (bcrtarjestcta@bancobcr.com)
// y decide qué hacer con cada transacción: anotarla como gasto o ignorarla.
//
// El correo trae una tabla con una fila por transacción:
//   Fecha | Autorización | No.Referencia | Monto | Moneda | Comercio | Estado
//
// ⚠️ El BCR manda los RETIROS DE CAJERO con el MISMO formato que las compras:
// ninguna columna dice "retiro". Sacar efectivo no es un gasto (la plata solo
// pasa del banco a la bolsa; el gasto es cuando se usa), así que hay que
// reconocerlos por otras señales — ver `pareceRetiro`.

// Lugares donde se saca efectivo. El Comercio de un retiro es el nombre del
// cajero. Se compara sin mayúsculas ni tildes, por "contiene".
export const CAJEROS_CONOCIDOS = [
  'ICAFE SAN PEDRO BARVA',
];

// Palabras que delatan un cajero aunque no esté en la lista. ATH ("A Toda
// Hora") es la red de cajeros que comparten varios bancos en Costa Rica: es lo
// que aparecería al sacar con la tarjeta BCR en un cajero de otro banco.
const PALABRAS_CAJERO = ['ATM', 'ATH', 'CAJERO', 'RETIRO'];

// Comercio → categoría de egreso. Gana la PRIMERA regla que calce; lo que no
// calce con ninguna queda en 'Otros' para acomodarlo a mano.
// Cada palabra tiene que estar al INICIO de una palabra del comercio
// ("SUPER" calza con "SUPERCOMPRO" pero "ICE" no calza con "SERVICES").
export const REGLAS_CATEGORIA = [
  { categoria: 'Supermercado', palabras: ['WALMART', 'MAXI PALI', 'PALI', 'MAS X MENOS', 'MASXMENOS', 'AUTOMERCADO', 'AUTO MERCADO', 'PRICESMART', 'PERIMERCADO', 'MEGASUPER', 'SUPER', 'MINISUPER', 'FRESH MARKET', 'AM PM', 'AMPM'] },
  { categoria: 'Combustible', palabras: ['SERVICENTRO', 'GASOLINERA', 'ESTACION DE SERVICIO', 'DELTA'] },
  { categoria: 'Comida preparada', palabras: ['SODA', 'RESTAURANTE', 'REST', 'PIZZA', 'MCDONALD', 'BURGER', 'KFC', 'TACO BELL', 'SUBWAY', 'POPEYES', 'CAFE', 'PANADERIA', 'POLLO'] },
  { categoria: 'Salud', palabras: ['FARMACIA', 'FISCHEL', 'SUCRE', 'LA BOMBA', 'CLINICA', 'HOSPITAL', 'LABORATORIO'] },
  { categoria: 'Suscripciones', palabras: ['NETFLIX', 'SPOTIFY', 'DISNEY', 'YOUTUBE', 'APPLE.COM', 'HBO', 'MAX.COM', 'PRIME VIDEO', 'AMAZON PRIME', 'OPENAI', 'CHATGPT', 'CLAUDE.AI', 'ANTHROPIC'] },
  { categoria: 'Transporte', palabras: ['UBER', 'DIDI', 'INDRIVE', 'PEAJE', 'PARQUEO'] },
  { categoria: 'Seguros', palabras: ['ASSA', 'SEGURO', 'ASEGURADORA'] },
  { categoria: 'Internet/Celular', palabras: ['KOLBI', 'ICE', 'LIBERTY', 'CLARO', 'TIGO'] },
];

const escaparRegex = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Una regex por palabra, armadas una sola vez.
const REGLAS_COMPILADAS = REGLAS_CATEGORIA.map(({ categoria, palabras }) => ({
  categoria,
  patrones: palabras.map((p) => new RegExp(`(?:^|[^A-Z0-9])${escaparRegex(p)}`)),
}));

// Mayúsculas y sin tildes, para comparar sin depender de cómo lo escriba el banco.
const normalizar = (texto) =>
  String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

const decodificarEntidades = (texto) =>
  texto
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const textoCelda = (html) =>
  decodificarEntidades(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// "11,900.00" → 11900
const leerMonto = (texto) => {
  const n = Number(String(texto).replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

// "04/10/2026 12:45:12" (hora de Costa Rica, UTC-6 todo el año) → Date
const leerFecha = (texto) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(texto).trim());
  if (!m) return null;
  const [, dd, mm, aaaa, hh = '12', mi = '00', ss = '00'] = m;
  const fecha = new Date(`${aaaa}-${mm}-${dd}T${hh}:${mi}:${ss}-06:00`);
  return isNaN(fecha) ? null : fecha;
};

// "COLON COSTA RICA" → CRC ; "DOLAR ..." / "US DOLLAR" → USD
const leerMoneda = (texto) => {
  const t = normalizar(texto);
  if (t.includes('COLON')) return 'CRC';
  if (t.includes('DOLAR') || t.includes('DOLLAR') || t.includes('USD')) return 'USD';
  return null;
};

// Saca las filas de la tabla "Detalle de Transacciones". Devuelve una lista de
// transacciones crudas (puede venir más de una por correo).
export const leerTransacciones = (html) => {
  const filas = [];
  const cuerpo = /<tbody[^>]*>([\s\S]*?)<\/tbody>/gi;
  let bloque;
  while ((bloque = cuerpo.exec(html))) {
    const trs = bloque[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    for (const tr of trs) {
      const celdas = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).map(textoCelda);
      // Solo las filas de 7 columnas son transacciones (la tabla del logo tiene 2).
      if (celdas.length !== 7) continue;
      const [fecha, autorizacion, referencia, monto, moneda, comercio, estado] = celdas;
      filas.push({
        fechaTexto: fecha,
        fecha: leerFecha(fecha),
        autorizacion,
        referencia,
        monto: leerMonto(monto),
        moneda: leerMoneda(moneda),
        monedaTexto: moneda,
        comercio,
        estado,
      });
    }
  }
  return filas;
};

// ¿Esta transacción es un retiro de efectivo? Devuelve el motivo, o null.
// Señales (basta una):
//   1. El comercio es un cajero conocido o tiene una palabra de cajero.
//   2. El No.Referencia tiene 12 dígitos. En los correos de muestra la compra
//      trae 8 y el retiro 12; con eso se agarran retiros en cajeros que no
//      están en la lista. Si alguna compra cae acá por error, el script de
//      Gmail la deja etiquetada como "Retiro" para que se vea.
export const pareceRetiro = ({ comercio, referencia }) => {
  const c = normalizar(comercio);
  const cajero = CAJEROS_CONOCIDOS.find((nombre) => c.includes(normalizar(nombre)));
  if (cajero) return `cajero conocido (${cajero})`;
  const palabra = PALABRAS_CAJERO.find((p) => new RegExp(`\\b${p}\\b`).test(c));
  if (palabra) return `el comercio dice "${palabra}"`;
  if (/^\d{12}$/.test(String(referencia).trim())) return 'referencia de 12 dígitos (como los retiros)';
  return null;
};

// Categoría de egreso según el comercio.
export const categoriaDeComercio = (comercio) => {
  const c = normalizar(comercio);
  const regla = REGLAS_COMPILADAS.find((r) => r.patrones.some((patron) => patron.test(c)));
  return regla ? regla.categoria : 'Otros';
};

// Decide qué hacer con una transacción ya leída.
// → { accion: 'anotar', categoria } | { accion: 'ignorar', motivo }
export const decidir = (tx) => {
  if (normalizar(tx.estado) !== 'APROBADA') {
    return { accion: 'ignorar', motivo: `estado "${tx.estado}" (no aprobada)` };
  }
  if (!tx.fecha) return { accion: 'ignorar', motivo: `fecha ilegible "${tx.fechaTexto}"` };
  if (!(tx.monto > 0)) return { accion: 'ignorar', motivo: 'monto ilegible' };
  if (!tx.moneda) return { accion: 'ignorar', motivo: `moneda desconocida "${tx.monedaTexto}"` };
  const retiro = pareceRetiro(tx);
  if (retiro) return { accion: 'ignorar', motivo: `retiro de efectivo: ${retiro}`, retiro: true };
  return { accion: 'anotar', categoria: categoriaDeComercio(tx.comercio) };
};
