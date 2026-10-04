// utils/correoSinpeBCR.js
// Lee el correo "SINPEMOVIL - Notificación de transacción realizada" del BCR
// (mensajero@bancobcr.com) y decide si se anota como gasto.
//
// A diferencia del aviso de la tarjeta (una tabla), este trae líneas
// "Etiqueta: valor":
//   Le informamos que se ha debitado de su cuenta BCR la siguiente transacción SINPE Móvil:
//   Número de referencia: 2026100215283000606194522
//   Teléfono Destino: 88301616
//   Nombre cliente Destino: alberto avila hernandez
//   Entidad Destino: Banco BAC San José
//   Monto: 5,000.00
//   Motivo: Transferencia SINPE
//   Esta transacción fue realizada el 02/10/2026 a las 8:36 PM
//
// Se lee por etiquetas sobre el texto plano, así no depende de cómo esté
// armado el HTML por dentro.
//
// Solo se anota lo que SALIÓ de la cuenta ("debitado"). Un SINPE recibido
// ("acreditado") no es un gasto.
import { normalizar, textoPlano } from './correoBCR.js';

// Valor de "Etiqueta: valor" (sin tildes ni mayúsculas en la etiqueta). Si la
// etiqueta y el valor vienen en celdas separadas, el valor es la línea siguiente.
const campo = (texto, etiqueta) => {
  const lineas = texto.split('\n');
  const i = lineas.findIndex((l) => normalizar(l).startsWith(`${etiqueta}:`));
  if (i < 0) return null;
  const enLaMisma = lineas[i].slice(lineas[i].indexOf(':') + 1).trim();
  return enLaMisma || lineas[i + 1]?.trim() || null;
};

// "02/10/2026 a las 8:36 PM" (hora de Costa Rica, UTC-6) → Date
const leerFechaSinpe = (texto) => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})\s+a\s+las\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP])\.?\s*M\.?/i
    .exec(normalizar(texto));
  if (!m) return null;
  const [, dd, mm, aaaa, h, mi, ss = '00', ampm] = m;
  let hora = Number(h) % 12;
  if (ampm.toUpperCase() === 'P') hora += 12;
  const fecha = new Date(`${aaaa}-${mm}-${dd}T${String(hora).padStart(2, '0')}:${mi}:${ss}-06:00`);
  return isNaN(fecha) ? null : fecha;
};

// ¿Es un aviso de SINPE Móvil del BCR?
export const esCorreoSinpe = (html) => {
  const t = normalizar(textoPlano(html));
  return t.includes('SINPE') && t.includes('NUMERO DE REFERENCIA:') && t.includes('MONTO:');
};

// → { referencia, telefono, destinatario, entidad, monto, motivo, fecha, fechaTexto, debito, credito }
export const leerSinpe = (html) => {
  const texto = textoPlano(html);
  const t = normalizar(texto);
  const monto = Number(String(campo(texto, 'MONTO') || '').replace(/[^\d.]/g, ''));
  return {
    referencia: campo(texto, 'NUMERO DE REFERENCIA'),
    telefono: campo(texto, 'TELEFONO DESTINO'),
    destinatario: campo(texto, 'NOMBRE CLIENTE DESTINO'),
    entidad: campo(texto, 'ENTIDAD DESTINO'),
    monto: Number.isFinite(monto) ? monto : NaN,
    motivo: campo(texto, 'MOTIVO'),
    fecha: leerFechaSinpe(texto),
    fechaTexto: (/(\d{2}\/\d{2}\/\d{4}\s+a\s+las\s+[\d:]+\s*[AP]\.?\s*M\.?)/i.exec(texto) || [])[1] || null,
    debito: t.includes('DEBITADO'),
    credito: t.includes('ACREDITADO'),
  };
};

// Nombre con mayúscula inicial: "alberto avila hernandez" → "Alberto Avila Hernandez"
const capitalizar = (texto) =>
  String(texto || '').toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, esp, letra) => esp + letra.toUpperCase());

// Descripción del gasto: a quién se le mandó y, si dice algo útil, para qué.
export const descripcionSinpe = ({ destinatario, telefono, motivo }) => {
  const quien = destinatario ? capitalizar(destinatario) : telefono || 'desconocido';
  const motivoUtil = motivo && !/^TRANSFERENCIA( SINPE)?$/.test(normalizar(motivo)) ? ` · ${motivo}` : '';
  return `SINPE a ${quien}${motivoUtil}`;
};

// → { accion: 'anotar', categoria } | { accion: 'ignorar', motivo }
// La categoría queda en 'Otros': el correo dice a quién, no para qué.
export const decidirSinpe = (s) => {
  if (s.credito && !s.debito) return { accion: 'ignorar', motivo: 'SINPE recibido (no es gasto)' };
  if (!s.debito) return { accion: 'ignorar', motivo: 'el correo no dice que se debitó de la cuenta' };
  if (!s.referencia) return { accion: 'ignorar', motivo: 'sin número de referencia' };
  if (!s.fecha) return { accion: 'ignorar', motivo: 'fecha ilegible' };
  if (!(s.monto > 0)) return { accion: 'ignorar', motivo: 'monto ilegible' };
  return { accion: 'anotar', categoria: 'Otros' };
};
