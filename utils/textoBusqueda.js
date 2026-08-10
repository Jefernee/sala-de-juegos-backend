// utils/textoBusqueda.js
//
// Búsqueda de texto "como la escribe la gente": sin tildes, sin importar
// mayúsculas y sin pelear con los espacios de más.
//
// Por qué no se usa la collation de MongoDB: una collation con strength 1
// ignoraría tildes y mayúsculas, pero MongoDB NO la aplica a $regex (los
// índices y las comparaciones sí, las expresiones regulares no). Como acá se
// busca por coincidencia PARCIAL ("mari" → "María José"), la única salida es
// armar la propia regex tolerante a tildes.

// Cada letra base → todas las formas acentuadas que debería aceptar.
// Lo que escribe el usuario se normaliza ANTES (se le quitan las tildes), así
// que solo hace falta mapear desde la letra sin tilde.
const VARIANTES = {
  a: 'aáàäâãÁÀÄÂÃ',
  e: 'eéèëêÉÈËÊ',
  i: 'iíìïîÍÌÏÎ',
  o: 'oóòöôõÓÒÖÔÕ',
  u: 'uúùüûÚÙÜÛ',
  n: 'nñÑ',
  c: 'cçÇ',
};

// Caracteres con significado especial dentro de una regex.
const escaparRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Deja un texto en su forma "plana": sin tildes, en minúsculas y sin espacios
 * de sobra. Sirve para buscar y también para AGRUPAR, así "José", "jose  " y
 * "JOSÉ" cuentan como el mismo cliente.
 * @param {string} str
 * @returns {string}
 */
export const normalizarTexto = (str) =>
  String(str ?? '')
    .normalize('NFD')                  // separa la letra de su tilde
    .replace(/[̀-ͯ]/g, '')   // borra las tildes sueltas
    .toLowerCase()
    .replace(/\s+/g, ' ')              // "juan   perez" → "juan perez"
    .trim();

/**
 * Arma una regex que encuentra el texto en cualquier parte del campo, sin
 * importar tildes ni mayúsculas: "jose perez" encuentra "José Pérez".
 * @param {string} texto - Lo que escribió el usuario
 * @returns {RegExp|null} null si el texto queda vacío
 */
export const regexBusquedaFlexible = (texto) => {
  const plano = normalizarTexto(texto);
  if (!plano) return null;

  // Letra por letra: las que tienen variantes acentuadas se vuelven [aáàäâã],
  // el espacio acepta uno o varios, y el resto se escapa tal cual.
  const patron = [...plano]
    .map((ch) => {
      if (ch === ' ') return '\\s+';
      const variantes = VARIANTES[ch];
      return variantes ? `[${variantes}]` : escaparRegex(ch);
    })
    .join('');

  return new RegExp(patron, 'i');
};
