// config/unidadesEnvases.js
// Unidades de medida y tipos de envase válidos.
//
// ⚠️  ESPEJO DE src/constants/inventario.js DEL FRONTEND.
// Las dos listas TIENEN que decir lo mismo. Si acá falta algo que el formulario
// ofrece, el usuario elige una opción que existe en pantalla y el guardado se
// cae con un 400 por un campo que se ve perfectamente bien. Eso es exactamente
// lo que estaba pasando: el formulario ofrecía "Lata" y "Display" y esta lista
// no los tenía, así que elegirlos rompía el guardado sin explicación. Del otro
// lado, acá se aceptaba "onzas" y "kilos", que el formulario no sabe ni dibujar.
//
// Al tocar cualquiera de las dos listas, tocá también la otra.
// No hay paquete compartido entre el backend y el frontend, así que esto se
// sostiene a mano; por eso el aviso.

// ── Unidades ─────────────────────────────────────────────────────────────────
// Los ids son los del frontend, que es quien los escribe. Se sacó 'onzas'
// (ningún producto la usa y el formulario no tiene ficha para dibujarla) y
// 'kilos' pasó a llamarse 'kilogramos', que es el id real que manda el
// formulario. Se agregó 'bolas', que el formulario ya ofrecía y acá se
// rechazaba.
export const UNIDADES_VALIDAS = [
  'unidades',
  'bolas',
  'gramos',
  'kilogramos',
  'mililitros',
  'litros',
];

// ── Envases ──────────────────────────────────────────────────────────────────
// Unión de las dos listas que habían quedado distintas: se agregaron 'lata' y
// 'display' (el formulario los ofrecía y acá reventaban) y se conservaron
// 'tarro' y 'sobre' (estaban acá y ahora el formulario también los ofrece).
export const ENVASES_VALIDOS = [
  'paquete',
  'caja',
  'balde',
  'botella',
  'bolsa',
  'lata',
  'saco',
  'bandeja',
  'display',
  'tarro',
  'sobre',
];

// ── Sinónimos ────────────────────────────────────────────────────────────────
// Lo que hay que absorber en vez de rechazar: abreviaturas, singulares y los
// nombres viejos que quedaron en la base. Sin esto, renombrar 'kilos' a
// 'kilogramos' convertiría a cualquier producto guardado con el nombre viejo en
// un producto imposible de editar: el formulario lo lee, lo manda de vuelta tal
// cual y se come un 400 por un dato que él no escribió.
const ALIAS_UNIDAD = {
  unidad: 'unidades', unidades: 'unidades', u: 'unidades', und: 'unidades',
  uds: 'unidades', pieza: 'unidades', piezas: 'unidades',
  bola: 'bolas', bolas: 'bolas',
  g: 'gramos', gr: 'gramos', grs: 'gramos', gramo: 'gramos', gramos: 'gramos',
  kg: 'kilogramos', kilo: 'kilogramos', kilos: 'kilogramos',
  kilogramo: 'kilogramos', kilogramos: 'kilogramos',
  ml: 'mililitros', mililitro: 'mililitros', mililitros: 'mililitros',
  l: 'litros', lt: 'litros', litro: 'litros', litros: 'litros',
};

const ALIAS_ENVASE = {
  paquete: 'paquete', paquetes: 'paquete', paq: 'paquete',
  caja: 'caja', cajas: 'caja',
  balde: 'balde', baldes: 'balde',
  botella: 'botella', botellas: 'botella',
  bolsa: 'bolsa', bolsas: 'bolsa',
  lata: 'lata', latas: 'lata',
  saco: 'saco', sacos: 'saco',
  bandeja: 'bandeja', bandejas: 'bandeja',
  display: 'display', displays: 'display',
  tarro: 'tarro', tarros: 'tarro',
  sobre: 'sobre', sobres: 'sobre',
};

const limpiar = (valor) => (typeof valor === 'string' ? valor.trim().toLowerCase() : valor);

/** Id canónico de la unidad, o el valor limpio si no la conocemos. */
export const normalizarUnidad = (valor) => {
  const base = limpiar(valor);
  if (!base) return null;
  return ALIAS_UNIDAD[base] || base;
};

/** Id canónico del envase, o el valor limpio si no lo conocemos. */
export const normalizarEnvase = (valor) => {
  const base = limpiar(valor);
  if (!base) return null;
  return ALIAS_ENVASE[base] || base;
};
