// utils/backfillResumenPersonal.js
// Backfill idempotente de los snapshots mensuales de Finanzas Personales.
//
// Al desplegar el reporte por primera vez, los meses que YA tienen movimientos
// no tienen snapshot guardado. Este backfill recorre los meses (hora CR) con
// movimientos de CADA usuario y regenera el resumen que falte o que haya
// quedado viejo. También refresca los meses que ya tenían snapshot: es la red de
// seguridad si alguien editó la base a mano.
//
// Idempotente y barato: son sumas por agregación, un mes por vuelta, y solo al
// arrancar. En arranques siguientes deja todo igual.
//
// OJO: en producción las tareas de arranque están apagadas
// (EJECUTAR_MIGRACIONES=false), así que allá este backfill NO corre. No importa:
// el controller tiene la misma red de seguridad en la primera lectura de cada
// proceso (`asegurarSnapshots`) y el botón POST /api/finanzas-personales/regenerar.
import MovimientoPersonal from '../models/MovimientoPersonal.js';
import ResumenPersonalMes from '../models/ResumenPersonalMes.js';
import { regenerarResumenMes } from '../controllers/finanzasPersonalesController.js';

const TZ = 'America/Costa_Rica';

export const backfillResumenPersonal = async () => {
  // Meses con movimientos por usuario: una fila por (usuario, año, mes).
  const conDatos = await MovimientoPersonal.aggregate([
    {
      $group: {
        _id: {
          u: '$usuario',
          y: { $year: { date: '$fecha', timezone: TZ } },
          m: { $month: { date: '$fecha', timezone: TZ } },
        },
      },
    },
  ]);

  // Incluir también los meses que YA tienen snapshot: si sus movimientos se
  // borraron por fuera, regenerarResumenMes borra el snapshot huérfano.
  const existentes = await ResumenPersonalMes.find({}, 'usuario anio mes').lean();

  const candidatos = new Map(); // clave → { usuario, anio, mes }
  for (const c of conDatos) {
    candidatos.set(`${c._id.u}-${c._id.y}-${c._id.m}`, { usuario: c._id.u, anio: c._id.y, mes: c._id.m });
  }
  for (const e of existentes) {
    candidatos.set(`${e.usuario}-${e.anio}-${e.mes}`, { usuario: e.usuario, anio: e.anio, mes: e.mes });
  }

  let generados = 0;
  for (const { usuario, anio, mes } of candidatos.values()) {
    await regenerarResumenMes(usuario, mes, anio);
    generados++;
  }

  return { generados, meses: candidatos.size };
};
