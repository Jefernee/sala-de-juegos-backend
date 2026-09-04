// scripts/backfillTipoProducto.js
//
// Le pone `tipoProducto` a los productos que ya existían antes de que el campo
// se guardara en la base.
//
// POR QUÉ HACE FALTA
// El formulario preguntaba "¿Qué es?" pero solo guardaba la unidad, así que al
// reabrir un producto intentaba deducir el tipo desde la unidad y devolvía
// siempre el primero de la lista. Resultado: 83 de 85 productos abrían diciendo
// "Bebida". Ahora el campo se guarda, pero los productos viejos lo tienen en
// null y seguirían mostrando la deducción vieja hasta que alguien los abra y
// corrija uno por uno. Esto los corrige todos de una.
//
// LA REGLA: NUNCA SE TOCA LA UNIDAD
// Cada tipo implica una unidad ("Helado a granel" se pesa en gramos). Asignar un
// tipo cuya unidad no sea la que el producto YA tiene cambiaría el significado
// de su stock: los 500 de un producto en unidades pasarían a leerse como 500
// gramos. Es el problema de los "44 vasos". Por eso el tipo se elige SOLO entre
// los que respetan la unidad guardada, y este script no escribe `unidad` nunca.
//
// DE DÓNDE SALE EL TIPO
// De la categoría, que ya está curada a mano en los 85 productos (snacks,
// helados, bebidas…), cruzada con la unidad. No se adivina por el nombre: eso
// falla justo con las marcas — "Crunchy" y "Chokies" son helados y suenan a
// galleta. La categoría ya tiene esa respuesta y la puso el dueño.
//
// Uso:
//   node scripts/backfillTipoProducto.js            → muestra qué haría (simulación)
//   node scripts/backfillTipoProducto.js aplicar    → lo aplica
//
// Requiere MONGO_URI en el .env. Solo escribe el campo `tipoProducto` y solo en
// los que lo tienen vacío: no toca cantidades, precios, unidades ni recetas.
// Volver a correrlo no hace nada.
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { UNIDAD_POR_TIPO, TIPOS_PRODUCTO } from '../config/tiposProducto.js';
import { normalizarUnidad } from '../config/unidadesEnvases.js';

dns.setServers(['1.1.1.1', '8.8.8.8']);
dotenv.config();

const APLICAR = process.argv[2] === 'aplicar';

// Los tres desechables del inventario. Van por nombre exacto y no por categoría
// porque en "otros" conviven los desechables con la mercadería (tazas, carros,
// sandalias, bolsas de regalo), y desde la categoría no hay forma de separarlos.
// Es una lista de una sola vez para esta migración, no una regla del sistema:
// de acá en adelante el tipo lo elige el dueño en el formulario y se guarda.
const DESECHABLES = ['vasos', 'cucharas', 'servilletas'];

// categoría → tipo, dentro de cada unidad. La unidad manda: si el tipo elegido
// no se cuenta igual que el producto, no se aplica y el producto queda para
// revisar a mano.
const POR_UNIDAD = {
  unidades: {
    bebidas: 'bebida',
    snacks: 'golosina',
    helados: 'helado_empacado', // bolis, conos, sandwiches: helado que se cuenta
    otros: 'otro',
  },
  gramos: {
    helados: 'helado',
    otros: 'polvo', // gelatina, chispas, cacao
    snacks: 'polvo',
  },
  mililitros: {
    bebidas: 'liquido',
    otros: 'liquido',
  },
};

const decidir = (p) => {
  // Las recetas no tienen "¿Qué es?": el formulario ni siquiera muestra el
  // bloque. Se saltan.
  if (p.tipo === 'receta') return { tipo: null, motivo: 'es receta, no aplica' };

  // Sin unidad guardada, el formulario la lee como "unidades" (normalizarUnidad
  // devuelve eso para vacío). Se usa el mismo criterio para no discrepar.
  const unidad = normalizarUnidad(p.unidad) || 'unidades';

  if (DESECHABLES.includes((p.nombre || '').trim().toLowerCase())) {
    if (UNIDAD_POR_TIPO.desechable === unidad) {
      return { tipo: 'desechable', motivo: 'desechable de la lista' };
    }
  }

  const tabla = POR_UNIDAD[unidad];
  if (!tabla) return { tipo: null, motivo: `unidad "${unidad}" sin regla` };

  const tipo = tabla[p.categoria];
  if (!tipo) return { tipo: null, motivo: `categoría "${p.categoria}" sin regla para ${unidad}` };

  // Cinturón de seguridad: nunca asignar un tipo que implique otra unidad.
  if (UNIDAD_POR_TIPO[tipo] !== unidad) {
    return { tipo: null, motivo: `"${tipo}" se cuenta en ${UNIDAD_POR_TIPO[tipo]} y el producto está en ${unidad}` };
  }

  return { tipo, motivo: `categoría ${p.categoria} + ${unidad}` };
};

await mongoose.connect(process.env.MONGO_URI);
const col = mongoose.connection.collection('inventarios');

const pendientes = await col
  .find({ $or: [{ tipoProducto: null }, { tipoProducto: { $exists: false } }] })
  .project({ nombre: 1, unidad: 1, categoria: 1, tipo: 1 })
  .sort({ nombre: 1 })
  .toArray();

console.log(`\n${APLICAR ? 'APLICANDO' : 'SIMULACIÓN (no se escribe nada)'}`);
console.log(`Productos sin tipo guardado: ${pendientes.length}\n`);

const porTipo = new Map();
const sinRegla = [];

for (const p of pendientes) {
  const { tipo, motivo } = decidir(p);
  if (!tipo) {
    sinRegla.push({ ...p, motivo });
    continue;
  }
  if (!porTipo.has(tipo)) porTipo.set(tipo, []);
  porTipo.get(tipo).push(p);
}

for (const tipo of TIPOS_PRODUCTO) {
  const lista = porTipo.get(tipo);
  if (!lista) continue;
  console.log(`${tipo}  (${UNIDAD_POR_TIPO[tipo]})  ×${lista.length}`);
  for (const p of lista) console.log(`    ${p.nombre}`);
  console.log('');
}

if (sinRegla.length > 0) {
  console.log(`Quedan sin tipo (${sinRegla.length}) — se corrigen a mano al editarlos:`);
  for (const p of sinRegla) console.log(`    ${p.nombre}  →  ${p.motivo}`);
  console.log('');
}

if (!APLICAR) {
  console.log('Nada se escribió. Para aplicarlo:');
  console.log('   node scripts/backfillTipoProducto.js aplicar\n');
  await mongoose.disconnect();
  process.exit(0);
}

let escritos = 0;
for (const [tipo, lista] of porTipo) {
  const r = await col.updateMany(
    { _id: { $in: lista.map((p) => p._id) } },
    { $set: { tipoProducto: tipo, updatedAt: new Date() } },
  );
  escritos += r.modifiedCount;
  console.log(`${tipo}: ${r.modifiedCount} actualizados`);
}

console.log(`\nListo. ${escritos} productos con su tipo guardado.`);
console.log(`${sinRegla.length} quedaron sin tipo, para elegir a mano.\n`);
await mongoose.disconnect();
