// utils/migrarNovedades.js
// Semilla idempotente de Novedades.
//
// Si la colección está vacía, crea la novedad que antes estaba escrita a mano en
// la página (EA FC 27), para que la portada no cambie al publicar el módulo.
// Si ya hay alguna (aunque esté oculta o se haya borrado la de FC27 a propósito),
// no hace nada. Asume que la conexión a MongoDB ya está abierta.
import Novedad from '../models/Novedad.js';

export const NOVEDAD_INICIAL = {
  titulo: 'EA Sports FC 27',
  texto: 'El fútbol como nunca antes lo has vivido. Vení a estrenarlo con tus amigos.',
  etiqueta: 'Recién llegado',
  afiche: '/afiche-fc27.jpg',
  juego: 'EA FC 27',
  publicada: true,
  orden: 0,
};

export const migrarNovedades = async () => {
  const hay = await Novedad.countDocuments();
  if (hay > 0) return { creada: false };
  await Novedad.create(NOVEDAD_INICIAL);
  return { creada: true };
};
