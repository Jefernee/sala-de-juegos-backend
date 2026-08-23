// config/categoriasProducto.js
// Categorías con las que la pantalla de ventas agrupa el catálogo.
//
// Lista cerrada, igual que las unidades y los envases del inventario: si fuera
// texto libre terminaríamos con "Bebidas", "bebidas" y "BEBIDAS" como tres
// grupos distintos en la misma pantalla.
//
// Los productos creados antes de este campo no lo tienen y caen en "otros"; se
// van corrigiendo desde el formulario, sin migración.
export const CATEGORIA_POR_DEFECTO = 'otros';

export const CATEGORIAS_PRODUCTO = [
  'bebidas',
  'snacks',
  'helados',
  'preparados',
  CATEGORIA_POR_DEFECTO,
];

// Normaliza y valida lo que llegue del frontend.
// Devuelve { ok: true, valor } o { ok: false, error } con el mensaje del 400.
// Si no viene nada (o viene vacío), cae en "otros".
export const validarCategoria = (valor) => {
  if (valor === undefined || valor === null || valor === '') {
    return { ok: true, valor: CATEGORIA_POR_DEFECTO };
  }
  const limpio = String(valor).trim().toLowerCase();
  if (!CATEGORIAS_PRODUCTO.includes(limpio)) {
    return {
      ok: false,
      error: `La categoría "${valor}" no es válida. Opciones: ${CATEGORIAS_PRODUCTO.join(', ')}.`,
    };
  }
  return { ok: true, valor: limpio };
};
