// scripts/backfillPlacas.js
// Hecho por Claude Code — Asignación manual de número de placa a activos existentes.
//
// NOTA: esto también corre automáticamente al arrancar el servidor (ver server.js
// y utils/migrarPlacas.js), así que normalmente NO necesitás correrlo a mano.
// Queda disponible por si querés ejecutarlo de forma manual:
//   node scripts/backfillPlacas.js
//
// Es idempotente: si todos los activos ya tienen placa, no hace nada.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { migrarPlacasActivos } from '../utils/migrarPlacas.js';

dotenv.config();

const run = async () => {
  if (!process.env.MONGO_URI) {
    console.error('❌ Falta MONGO_URI en el archivo .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ Conectado a MongoDB');

  const { asignados, ultimaPlaca } = await migrarPlacasActivos();
  if (asignados === 0) {
    console.log('👍 Todos los activos ya tienen número de placa. Nada que hacer.');
  } else {
    console.log(`✅ Placas asignadas a ${asignados} activo(s). Última placa: #${ultimaPlaca}.`);
    console.log(`   Los activos nuevos seguirán desde #${ultimaPlaca + 1}.`);
  }

  await mongoose.disconnect();
  console.log('🏁 Listo.');
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Error en el backfill:', err);
  process.exit(1);
});
