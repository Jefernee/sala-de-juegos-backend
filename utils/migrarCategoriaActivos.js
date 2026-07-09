// utils/migrarCategoriaActivos.js
// Hecho por Claude Code — Migración idempotente de la categoría de activos.
//
// Los activos creados antes del campo `categoria` no lo tienen. Les asignamos
// una categoría deducida del nombre (case-insensitive). Lo que quede dudoso se
// deja en "Otros" para ajustarlo a mano editando el activo.
//
// Reglas (en orden):
//   nombre tiene "control" + "ps5"                       → "Control PS5"
//   nombre tiene "control" + "ps4"                       → "Control PS4"
//   nombre tiene "consola"/"playstation"/"play station" + "5" → "Consola PS5"
//   idem + "4"                                           → "Consola PS4"
//   nombre tiene "pantalla"/"tv"/"monitor"               → "Pantalla"
//   cualquier otro                                       → "Otros"
//
// Se corre al arrancar el servidor. Idempotente: solo toca los activos que aún
// no tienen categoría. Asume que la conexión a MongoDB ya está abierta.
import ActivoSala from '../models/ActivoSala.js';

// Deduce la categoría a partir del nombre. Exportada para poder testearla.
export const deducirCategoria = (nombre) => {
  const n = String(nombre || '').toLowerCase();
  if (n.includes('control') && n.includes('ps5')) return 'Control PS5';
  if (n.includes('control') && n.includes('ps4')) return 'Control PS4';
  const esConsola = n.includes('consola') || n.includes('playstation') || n.includes('play station');
  if (esConsola && n.includes('5')) return 'Consola PS5';
  if (esConsola && n.includes('4')) return 'Consola PS4';
  if (n.includes('pantalla') || n.includes('tv') || n.includes('monitor')) return 'Pantalla';
  return 'Otros';
};

export const migrarCategoriaActivos = async () => {
  const sinCategoria = await ActivoSala.find({
    $or: [{ categoria: { $exists: false } }, { categoria: null }],
  })
    .select('_id nombre')
    .lean();

  let asignados = 0;
  for (const activo of sinCategoria) {
    const categoria = deducirCategoria(activo.nombre);
    await ActivoSala.collection.updateOne({ _id: activo._id }, { $set: { categoria } });
    asignados++;
  }

  return { asignados, total: sinCategoria.length };
};
