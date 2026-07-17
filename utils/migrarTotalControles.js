// utils/migrarTotalControles.js
// Migración idempotente del campo totalControles en plays.
//
// Los plays creados antes de este campo no lo tienen. Como totalControles ahora
// es requerido, los backfilleamos derivándolo de controlAdicional:
//   controlAdicional > 0  → controlAdicional + 2   (2 gratis + los que se cobraron)
//   controlAdicional = 0  → 2                       (no se puede saber si fue 1 o 2;
//                                                     2 es lo más común y no afecta el cobro)
//
// Se corre al arrancar el servidor. Idempotente: solo toca los plays que aún no
// tienen el campo, así que llamarla de más no hace nada.
//
// Usa el driver nativo (.collection) con un pipeline de agregación para calcular
// el valor por documento en UNA sola operación, sin traerlos a memoria.
// Asume que la conexión a MongoDB ya está abierta.
import Play from '../models/plays.js';

export const migrarTotalControles = async () => {
  const res = await Play.collection.updateMany(
    { totalControles: { $exists: false } },
    [
      {
        $set: {
          totalControles: {
            $let: {
              vars: { ca: { $ifNull: ['$controlAdicional', 0] } },
              in: {
                $cond: [{ $gt: ['$$ca', 0] }, { $min: [4, { $add: ['$$ca', 2] }] }, 2],
              },
            },
          },
        },
      },
    ]
  );
  return { modificados: res.modifiedCount || 0 };
};
