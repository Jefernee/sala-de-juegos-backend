// scripts/fotoDeReportes.js
//
// Toma una "foto" de los números que dan los reportes hoy, para poder
// compararlos después de un cambio y comprobar que no se movió ni un colón.
//
//   node scripts/fotoDeReportes.js antes.json     → guarda la foto
//   node scripts/fotoDeReportes.js despues.json antes.json  → guarda y compara
//
// Solo LEE. Reconstruye los totales desde la colección de activos, igual que
// lo hacen construirReporteActivos y el estado de resultados.
import fs from 'fs';
import { connectDB, mongoose } from '../db.js';
import ActivoSala from '../models/ActivoSala.js';

const [salida, contra] = process.argv.slice(2);
if (!salida) {
  console.error('Uso: node scripts/fotoDeReportes.js <archivo.json> [archivoAnterior.json]');
  process.exit(1);
}

await connectDB();

// Totales del reporte de activos: todo, por categoría y por estado.
const activos = await ActivoSala.find()
  .select('numeroPlaca nombre categoria costo estado fechaCompra reparaciones juegoId')
  .lean();

const foto = {
  cuantos: activos.length,
  invertido: 0,
  enReparaciones: 0,
  porCategoria: {},
  porMesDeCompra: {},   // así se arma el estado de resultados
  placas: {},           // placa → costo y fecha: lo que no puede cambiar
};

for (const a of activos) {
  const costo = a.costo || 0;
  foto.invertido += costo;
  foto.porCategoria[a.categoria || 'Sin categoría'] =
    (foto.porCategoria[a.categoria || 'Sin categoría'] || 0) + costo;

  const mes = a.fechaCompra ? a.fechaCompra.toISOString().slice(0, 7) : 'SIN FECHA';
  foto.porMesDeCompra[mes] = (foto.porMesDeCompra[mes] || 0) + costo;

  for (const r of a.reparaciones || []) foto.enReparaciones += r.costo || 0;

  foto.placas[a.numeroPlaca] = {
    costo,
    fecha: a.fechaCompra ? a.fechaCompra.toISOString().slice(0, 10) : null,
    categoria: a.categoria,
    nombre: a.nombre,
  };
}

fs.writeFileSync(salida, JSON.stringify(foto, null, 2), 'utf8');

const crc = (n) => '₡' + (n || 0).toLocaleString('es-CR');
console.log(`\nActivos: ${foto.cuantos}`);
console.log(`Invertido: ${crc(foto.invertido)}   |   Reparaciones: ${crc(foto.enReparaciones)}`);
console.log('\nPor mes de compra (lo que ve el estado de resultados):');
for (const [mes, total] of Object.entries(foto.porMesDeCompra).sort())
  console.log(`  ${mes}  ${crc(total)}`);

if (contra) {
  const antes = JSON.parse(fs.readFileSync(contra, 'utf8'));
  const dif = [];
  const comparar = (campo, a, b) => { if (a !== b) dif.push(`${campo}: ${a} → ${b}`); };

  comparar('cantidad de activos', antes.cuantos, foto.cuantos);
  comparar('total invertido', antes.invertido, foto.invertido);
  comparar('total en reparaciones', antes.enReparaciones, foto.enReparaciones);
  for (const k of new Set([...Object.keys(antes.porCategoria), ...Object.keys(foto.porCategoria)]))
    comparar(`categoría ${k}`, antes.porCategoria[k], foto.porCategoria[k]);
  for (const k of new Set([...Object.keys(antes.porMesDeCompra), ...Object.keys(foto.porMesDeCompra)]))
    comparar(`mes ${k}`, antes.porMesDeCompra[k], foto.porMesDeCompra[k]);
  for (const k of new Set([...Object.keys(antes.placas), ...Object.keys(foto.placas)])) {
    const x = antes.placas[k], y = foto.placas[k];
    if (!x || !y) { dif.push(`placa ${k}: ${x ? 'desapareció' : 'apareció'}`); continue; }
    comparar(`placa ${k} costo`, x.costo, y.costo);
    comparar(`placa ${k} fecha`, x.fecha, y.fecha);
    comparar(`placa ${k} categoría`, x.categoria, y.categoria);
    comparar(`placa ${k} nombre`, x.nombre, y.nombre);
  }

  console.log('\n══════════════════════════════════════');
  if (dif.length === 0) {
    console.log('✅ IDÉNTICO. No se movió un solo colón ni una sola fecha.');
  } else {
    console.log(`❌ HAY ${dif.length} DIFERENCIA(S):`);
    for (const d of dif) console.log('  ' + d);
  }
  console.log('══════════════════════════════════════');
}

await mongoose.disconnect();
