// scripts/migrarMetodoPago.js
//
// YA SE CORRIÓ: el 22/08/2026 marcó las 1.464 ventas históricas como
// "efectivo" en la base de producción. Queda acá como registro de lo que se
// hizo y como red de seguridad, NO como algo pendiente.
//
// Le pone metodoPago: "efectivo" a las ventas que no tengan el campo, para que
// el desglose efectivo/SINPE del reporte mensual cuadre con el histórico.
// Todas esas ventas fueron en efectivo: SINPE se empezó a registrar junto con
// el campo.
//
// A PROPÓSITO NO está enganchado a las tareas de arranque del servidor: es una
// migración de una sola vez y no tiene por qué importarse ni consultar la base
// en cada reinicio. Se corre a mano, como los demás scripts de esta carpeta.
//
// Uso:
//   node scripts/migrarMetodoPago.js            → muestra qué haría (simulación)
//   node scripts/migrarMetodoPago.js aplicar    → aplica los cambios
//
// Requiere MONGO_URI en el .env. Es idempotente: correrlo de nuevo no cambia
// nada, y NUNCA toca una venta que ya tenga método de pago (una venta por
// SINPE no se puede convertir en efectivo por error).
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Algunos ISP no resuelven registros SRV (mongodb+srv); forzamos DNS públicos.
dns.setDefaultResultOrder('ipv4first');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* no crítico */ }
dotenv.config();

const APLICAR = process.argv[2] === 'aplicar';

const SIN_METODO = { $or: [{ metodoPago: { $exists: false } }, { metodoPago: null }] };

const run = async () => {
  if (!process.env.MONGO_URI) {
    console.error('❌ Falta MONGO_URI en el .env.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const Ventas = mongoose.connection.collection('sales');

  console.log(APLICAR ? '🔧 MODO APLICAR\n' : '👀 SIMULACIÓN (no se cambia nada). Corré con "aplicar" para ejecutar.\n');

  const total = await Ventas.countDocuments({});
  const pendientes = await Ventas.countDocuments(SIN_METODO);

  console.log(`Ventas en la base: ${total}`);
  console.log(`Sin metodoPago:    ${pendientes}`);
  console.log('Valores actuales:  ', JSON.stringify(await Ventas.distinct('metodoPago')), '\n');

  if (pendientes === 0) {
    console.log('✅ Nada que migrar: todas las ventas ya tienen método de pago.');
    await mongoose.disconnect();
    return;
  }

  if (!APLICAR) {
    console.log(`Se le pondría metodoPago: "efectivo" a ${pendientes} venta(s).`);
    await mongoose.disconnect();
    return;
  }

  const res = await Ventas.updateMany(SIN_METODO, { $set: { metodoPago: 'efectivo' } });
  console.log(`✅ ${res.modifiedCount} venta(s) marcadas como "efectivo".`);
  console.log('Valores después:   ', JSON.stringify(await Ventas.distinct('metodoPago')));
  console.log('\n👉 Acordate de regenerar los reportes de ventas para que aparezca el desglose.');

  await mongoose.disconnect();
};

run().catch((e) => { console.error('❌ ERROR:', e.message); process.exit(1); });
