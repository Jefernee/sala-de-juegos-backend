// utils/migrarPlacas.js
// Hecho por Claude Code — Migración idempotente de números de placa de activos.
//
// Asigna número de placa a los activos que aún no lo tienen, ordenados del más
// antiguo al más reciente (por createdAt). Se puede llamar de forma segura todas
// las veces que se quiera: si todos los activos ya tienen placa, no hace nada.
//
// Se usa en dos lugares:
//   - server.js: se ejecuta al arrancar (asegura que en producción todos los
//     activos existentes queden con placa sin intervención manual).
//   - scripts/backfillPlacas.js: para correrlo manualmente si se desea.
//
// Asume que la conexión a MongoDB ya está abierta.
import ActivoSala from '../models/ActivoSala.js';
import { fijarSecuenciaMinima } from '../models/Counter.js';

const CONTADOR_PLACA = 'numeroPlacaActivo';

export const migrarPlacasActivos = async () => {
  // Punto de partida: el número de placa más alto que ya exista (0 si ninguno).
  const conPlaca = await ActivoSala.findOne({ numeroPlaca: { $ne: null } })
    .sort({ numeroPlaca: -1 })
    .select('numeroPlaca')
    .lean();
  let siguiente = (conPlaca?.numeroPlaca || 0) + 1;

  // Activos sin placa, del más antiguo al más reciente.
  const sinPlaca = await ActivoSala.find({
    $or: [{ numeroPlaca: { $exists: false } }, { numeroPlaca: null }],
  })
    .sort({ createdAt: 1, _id: 1 })
    .select('_id nombre')
    .lean();

  for (const activo of sinPlaca) {
    // updateOne evita validadores/immutable: es una migración controlada.
    await ActivoSala.updateOne({ _id: activo._id }, { $set: { numeroPlaca: siguiente } });
    siguiente++;
  }

  // Dejar el contador sincronizado con la placa más alta asignada,
  // para que los activos nuevos sigan la secuencia sin chocar.
  const ultimaPlaca = siguiente - 1;
  if (ultimaPlaca > 0) await fijarSecuenciaMinima(CONTADOR_PLACA, ultimaPlaca);

  return { asignados: sinPlaca.length, ultimaPlaca };
};
