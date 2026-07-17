// utils/backfillEstadoResultados.js
// Backfill idempotente del Estado de Resultados.
//
// Al desplegar el reporte por primera vez, los meses que YA tienen datos no
// tienen un estado de resultados guardado (solo se generarían al editar algo).
// Este backfill detecta todos los meses (hora CR) con datos en cualquier fuente
// y genera el estado que falte. Idempotente: solo crea los que no existen; en
// arranques siguientes no hace nada (los nuevos datos los mantiene la
// auto-regeneración en background de cada controlador).
//
// Debe correr DESPUÉS de migrarReparacionesActivos (usa reparaciones[]).
import EstadoResultados from '../models/EstadoResultados.js';
import { regenerarEstadoDeMes } from '../controllers/estadoResultadosController.js';
import Sale from '../models/sale.js';
import Play from '../models/plays.js';
import Ganancia from '../models/Ganancia.js';
import PagoServicio from '../models/PagoServicio.js';
import ActivoSala from '../models/ActivoSala.js';

const TZ = 'America/Costa_Rica';

// Devuelve claves "año-mes" (CR) con al menos un registro por `campoFecha`.
const mesesConFecha = async (Modelo, campoFecha = 'fecha') => {
  const rows = await Modelo.aggregate([
    { $match: { [campoFecha]: { $ne: null } } },
    {
      $group: {
        _id: {
          y: { $year: { date: `$${campoFecha}`, timezone: TZ } },
          m: { $month: { date: `$${campoFecha}`, timezone: TZ } },
        },
      },
    },
  ]);
  return rows.map((r) => `${r._id.y}-${r._id.m}`);
};

export const backfillEstadoResultados = async () => {
  const meses = new Set();
  for (const k of await mesesConFecha(Sale)) meses.add(k);
  for (const k of await mesesConFecha(Play)) meses.add(k);
  for (const k of await mesesConFecha(Ganancia)) meses.add(k);
  for (const k of await mesesConFecha(PagoServicio)) meses.add(k);
  for (const k of await mesesConFecha(ActivoSala, 'fechaCompra')) meses.add(k);

  // Reparaciones: la fecha vive dentro de cada item del arreglo.
  const repRows = await ActivoSala.aggregate([
    { $unwind: '$reparaciones' },
    { $match: { 'reparaciones.fecha': { $ne: null } } },
    {
      $group: {
        _id: {
          y: { $year: { date: '$reparaciones.fecha', timezone: TZ } },
          m: { $month: { date: '$reparaciones.fecha', timezone: TZ } },
        },
      },
    },
  ]);
  for (const r of repRows) meses.add(`${r._id.y}-${r._id.m}`);

  // Incluir también cualquier mes YA guardado (aunque hoy no tenga datos: pudo
  // quedarse en cero tras borrar registros). Así el refresh de arranque deja
  // TODO consistente.
  const existentes = await EstadoResultados.find({}, 'año mes').lean();
  for (const e of existentes) meses.add(`${e.año}-${e.mes}`);

  // Regeneramos SIEMPRE cada mes candidato (no solo los que faltan o quedaron
  // viejos). Es la red de seguridad: si un dato se editó con un backend que no
  // tenía la auto-regeneración (o directo en la base), al reiniciar/desplegar el
  // reporte queda recalculado y correcto, sin apretar "Regenerar". El costo es
  // bajo (pocos meses, sumas por agregación) y solo corre al arrancar.
  let generados = 0;
  for (const key of meses) {
    const [año, mes] = key.split('-').map(Number);
    await regenerarEstadoDeMes(año, mes);
    generados++;
  }

  return { generados, meses: meses.size };
};
