// utils/migrarMontoPagado.js
// Migración idempotente del campo montoPagado en plays.
//
// Los plays creados antes de este campo no lo tienen. Como montoPagado es ahora
// la fuente de verdad del ingreso, para los plays viejos lo derivamos del monto
// que YA se había registrado: montoPagado = total (el total histórico ya era
// round(tiempo/60 × precioHora) + controlAdicional×200).
//
// Además re-desglosamos esos plays al nuevo criterio "limpio" para que los
// reportes cuadren (buckets que suman el total, sin doble conteo de controles):
//   - subtotal      = total - costoControles   (ingreso por tiempo)
//   - totalPlay4/5/PingPong = subtotal según el tipoPlay (los controles NO van acá)
//   - los controles quedan solo en costoControles → totalCostosControles del reporte
//
// Se corre al arrancar el servidor. Idempotente: solo toca los plays que aún no
// tienen montoPagado. Usa el driver nativo (.collection) con pipeline de
// agregación para calcular por documento en una sola operación.
// Asume que la conexión a MongoDB ya está abierta. Tras correrla conviene
// regenerar los reportes de los meses afectados.
import Play from '../models/plays.js';

export const migrarMontoPagado = async () => {
  const res = await Play.collection.updateMany(
    { montoPagado: { $exists: false } },
    [
      {
        $set: {
          montoPagado: { $ifNull: ['$total', 0] },
          subtotal: {
            $max: [0, { $subtract: [{ $ifNull: ['$total', 0] }, { $ifNull: ['$costoControles', 0] }] }],
          },
        },
      },
      {
        $set: {
          totalPlay4: { $cond: [{ $eq: ['$tipoPlay', 'Play 4'] }, '$subtotal', 0] },
          totalPlay5: { $cond: [{ $eq: ['$tipoPlay', 'Play 5'] }, '$subtotal', 0] },
          totalPingPong: { $cond: [{ $eq: ['$tipoPlay', 'Ping Pong'] }, '$subtotal', 0] },
        },
      },
    ]
  );
  return { modificados: res.modifiedCount || 0 };
};
