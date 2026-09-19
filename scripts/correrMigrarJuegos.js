// scripts/correrMigrarJuegos.js
//
// Corre la migración del catálogo de Juegos contra la base, a mano.
//
//   npm run migrar-juegos -- --dry    → dice qué haría, SIN escribir nada
//   npm run migrar-juegos             → la aplica
//
// Es idempotente: aplicarla dos veces no cambia nada. No borra ni modifica
// ningún campo de plata: los activos conservan costo, placa y fecha de compra.
import { connectDB, mongoose } from '../db.js';
import { migrarJuegos } from '../utils/migrarJuegos.js';

const dry = process.argv.includes('--dry');

await connectDB();

const t = Date.now();
const r = await migrarJuegos({ dry });

const titulo = dry ? 'SIMULACIÓN (no se escribió nada)' : 'MIGRACIÓN APLICADA';
console.log(`\n══════ ${titulo} ══════\n`);

console.log(`Fichas que ya existían: ${r.yaEstaban}`);
console.log(`\n▸ JUEGOS QUE SE CREAN: ${r.creados.length}`);
if (r.creados.length <= 60) console.log('  ' + r.creados.join(' · '));

console.log(`\n▸ PORTADAS QUE SE PEGAN: ${r.portadas.length}`);
for (const p of r.portadas) console.log('  ' + p);

console.log(`\n▸ COMPRAS QUE SE ENLAZAN: ${r.enlazados.length}`);
for (const e of r.enlazados) console.log('  ' + e);

console.log(`\n▸ COMPLEMENTOS QUE SE ENLAZAN: ${r.complementos.length}`);
for (const c of r.complementos) console.log('  ' + c);

if (r.sinCatalogo.length) {
  console.log(`\n⚠️  SE JUEGAN PERO NO QUEDARÍAN EN EL CATÁLOGO: ${r.sinCatalogo.length}`);
  for (const s of r.sinCatalogo) console.log('  ' + s);
} else {
  console.log('\n✅ Todo lo que se jugó en los últimos 90 días queda en el catálogo.');
}

if (r.avisos.length) {
  console.log('\n⚠️  AVISOS:');
  for (const a of r.avisos) console.log('  ' + a);
}

console.log(`\n(${Date.now() - t} ms)`);
if (dry) console.log('\nPara aplicarla:  npm run migrar-juegos\n');

await mongoose.disconnect();
