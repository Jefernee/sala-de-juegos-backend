// scripts/normalizarUnidades.js
//
// Deja parejos los campos `unidad` y `nombreEnvase` del inventario, pasándolos
// a minúscula. Cuando esos campos eran texto libre quedaron valores mezclados
// ("Gramos" y "gramos", "Paquete" y "paquete"), que ensucian los filtros, los
// agrupamientos de reportes y los desplegables del frontend.
//
// Desde ahora el controlador valida ambos campos contra listas cerradas
// (UNIDADES_VALIDAS / ENVASES_VALIDOS) y los guarda ya en minúscula, así que
// este script es de una sola vez para los datos viejos.
//
// Uso:
//   node scripts/normalizarUnidades.js            → muestra qué haría (simulación)
//   node scripts/normalizarUnidades.js aplicar    → aplica los cambios
//
// Requiere MONGO_URI en el .env. Solo cambia mayúsculas/minúsculas y espacios:
// no toca cantidades, precios ni recetas.
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Algunos ISP no resuelven registros SRV (mongodb+srv); forzamos DNS públicos.
dns.setDefaultResultOrder('ipv4first');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* no crítico */ }
dotenv.config();

const APLICAR = process.argv[2] === 'aplicar';

const run = async () => {
  if (!process.env.MONGO_URI) {
    console.error('❌ Falta MONGO_URI en el .env.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const Inv = mongoose.connection.collection('inventarios');

  console.log(APLICAR ? '🔧 MODO APLICAR\n' : '👀 SIMULACIÓN (no se cambia nada). Corré con "aplicar" para ejecutar.\n');
  console.log('Antes → unidad:', JSON.stringify(await Inv.distinct('unidad')));
  console.log('Antes → nombreEnvase:', JSON.stringify(await Inv.distinct('nombreEnvase')), '\n');

  const items = await Inv.find(
    {},
    { projection: { nombre: 1, unidad: 1, nombreEnvase: 1 } }
  ).toArray();

  let cambiados = 0;

  for (const item of items) {
    const $set = {};

    if (typeof item.unidad === 'string') {
      const limpio = item.unidad.trim().toLowerCase();
      if (limpio !== item.unidad) $set.unidad = limpio;
    }

    if (typeof item.nombreEnvase === 'string') {
      const limpio = item.nombreEnvase.trim().toLowerCase();
      if (limpio !== item.nombreEnvase) $set.nombreEnvase = limpio;
    }

    if (Object.keys($set).length === 0) continue;

    cambiados++;
    const detalle = Object.entries($set).map(([k, v]) => `${k}: "${item[k]}" → "${v}"`).join(' | ');
    console.log(`  • ${item.nombre}: ${detalle}`);

    // Nota: NO se toca updatedAt. Este es un arreglo de formato, no una
    // edición del producto hecha por el usuario.
    if (APLICAR) await Inv.updateOne({ _id: item._id }, { $set });
  }

  console.log(`\n${cambiados === 0 ? '✅ Nada que normalizar.' : `${APLICAR ? '✅ Normalizados' : 'Se normalizarían'}: ${cambiados} ítem(s).`}`);

  if (APLICAR) {
    console.log('\nDespués → unidad:', JSON.stringify(await Inv.distinct('unidad')));
    console.log('Después → nombreEnvase:', JSON.stringify(await Inv.distinct('nombreEnvase')));
  }

  await mongoose.disconnect();
};

run().catch((e) => { console.error('❌ ERROR:', e.message); process.exit(1); });
