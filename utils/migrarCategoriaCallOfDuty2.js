// utils/migrarCategoriaCallOfDuty2.js
// Migración idempotente puntual.
//
// El activo "Call of Duty 2" ya existía con otra categoría (probablemente
// "Otros"), así que la migración general por nombre (migrarCategoriaActivos)
// NO lo toca (esa solo clasifica activos sin categoría). Acá lo reclasificamos
// a la categoría nueva "Juegos digitales" para que aparezca en su filtro.
//
// Se corre al arrancar el servidor. Idempotente: solo actualiza si el activo
// todavía no está en "Juegos digitales". Asume que la conexión a MongoDB ya
// está abierta. Case-insensitive y tolera espacios extra en el nombre.
import ActivoSala from '../models/ActivoSala.js';

const CATEGORIA_DESTINO = 'Juegos digitales';

export const migrarCategoriaCallOfDuty2 = async () => {
  // Coincide con "Call of Duty 2" sin importar mayúsculas ni espacios sobrantes,
  // pero que aún no esté ya en la categoría destino (idempotencia).
  const resultado = await ActivoSala.updateMany(
    {
      nombre: { $regex: /^\s*call of duty 2\s*$/i },
      categoria: { $ne: CATEGORIA_DESTINO },
    },
    { $set: { categoria: CATEGORIA_DESTINO } }
  );

  return { modificados: resultado.modifiedCount || 0 };
};
