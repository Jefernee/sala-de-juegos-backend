// config/tiposProducto.js
// Qué ES el producto: bebida, golosina, helado a granel, polvo, líquido,
// desechable. Es lo que el formulario pregunta en "¿Qué es?".
//
// OJO — no confundir con dos campos vecinos:
//   · `tipo`      → 'producto' | 'receta'. Si tiene stock propio o se arma.
//   · `categoria` → en qué pestaña del POS aparece (bebidas, snacks, …).
//   · `tipoProducto` (esto) → de qué naturaleza es la cosa, y de ahí sale
//                             la unidad con la que se cuenta.
//
// POR QUÉ EXISTE ESTE CAMPO
// Antes no se guardaba: el formulario lo preguntaba, lo usaba para fijar la
// unidad, y al reabrir el producto lo volvía a adivinar buscando el PRIMER tipo
// que usara esa unidad. Como cuatro tipos comparten 'unidades' (bebida,
// golosina, desechable, otro) y dos comparten 'gramos' (helado, polvo), la
// vuelta era imposible: elegir "Golosina o snack" y guardar mostraba "Bebida"
// al volver a entrar, y entre esos cuatro el cambio no tocaba nada en la base.
// Se veía como un formulario que no guarda. Ahora el dato se guarda tal cual lo
// eligió el dueño y no se deduce nunca más.
//
// Lista cerrada, igual que unidades, envases y categorías: si fuera texto libre
// terminaríamos con "Golosina", "golosina" y "GOLOSINA" como tres cosas.

export const TIPOS_PRODUCTO = [
  'bebida',
  'golosina',
  'helado',
  'helado_empacado',
  'polvo',
  'liquido',
  'desechable',
  'otro',
];

// La unidad que le corresponde a cada tipo. Vive acá y no en el frontend porque
// es la regla de negocio que hace que el campo signifique algo: un helado a
// granel se pesa, una gaseosa se cuenta. El frontend tiene la misma tabla para
// no tener que preguntar al servidor mientras se llena el formulario.
export const UNIDAD_POR_TIPO = {
  bebida: 'unidades',
  golosina: 'unidades',
  helado: 'gramos',
  // Bolis, conos, sandwiches, paletas: helado, pero se cuenta de uno en uno.
  // Faltaba, y era el 21% del inventario: 18 productos que no tenían ninguna
  // opción honesta. La única que decía "helado" era la de granel, que se pesa en
  // gramos, así que elegirla les cambiaba la unidad y les descuadraba el stock.
  helado_empacado: 'unidades',
  polvo: 'gramos',
  liquido: 'mililitros',
  desechable: 'unidades',
  otro: 'unidades',
};

// Normaliza y valida lo que llegue del frontend.
// Devuelve { ok: true, valor } o { ok: false, error } con el mensaje del 400.
//
// Si no viene nada devuelve `null`, NO un valor por defecto: null significa
// "nadie lo eligió todavía" y es lo que tienen los productos creados antes de
// este campo. Ponerles "otro" sería inventar una decisión que el dueño nunca
// tomó, y encima taparía el aviso del formulario que le pide elegir.
export const validarTipoProducto = (valor) => {
  if (valor === undefined || valor === null || valor === '') {
    return { ok: true, valor: null };
  }
  const limpio = String(valor).trim().toLowerCase();
  if (!TIPOS_PRODUCTO.includes(limpio)) {
    return {
      ok: false,
      error: `El tipo "${valor}" no es válido. Opciones: ${TIPOS_PRODUCTO.join(', ')}.`,
    };
  }
  return { ok: true, valor: limpio };
};
