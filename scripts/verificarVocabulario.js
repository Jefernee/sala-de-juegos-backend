// scripts/verificarVocabulario.js
//
// Compara el vocabulario cerrado del backend con el del formulario y avisa si
// se separaron.
//
// POR QUÉ EXISTE
// Las listas de unidades, envases y tipos de producto están escritas dos veces
// —una en config/ del backend, otra en src/constants/ del frontend— porque no
// hay paquete compartido entre los dos proyectos. Cuando se separan, el bug es
// silencioso y feo: el formulario ofrece una opción ("Lata", "Display"), el
// usuario la elige, la ve seleccionada, y el guardado se cae con un 400 por un
// campo que en pantalla se ve perfectamente bien. Un comentario que dice "acordate
// de tocar las dos" no alcanzó; esto lo revisa de verdad.
//
// Uso:
//   node scripts/verificarVocabulario.js
//
// Sale con código 1 si hay diferencias, para poder colgarlo de un hook o del CI.
// No toca la base de datos ni necesita MONGO_URI: solo lee los dos archivos.
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { UNIDADES_VALIDAS, ENVASES_VALIDOS } from '../config/unidadesEnvases.js';
import { TIPOS_PRODUCTO as TIPOS_BACKEND } from '../config/tiposProducto.js';

const aquí = path.dirname(fileURLToPath(import.meta.url));
const RUTA_FRONTEND = path.resolve(aquí, '../../sala-juegos-frontend-vite/src/constants/inventario.js');

let frontend;
try {
  frontend = await import(pathToFileURL(RUTA_FRONTEND).href);
} catch (err) {
  console.error(`No pude leer el vocabulario del frontend en:\n  ${RUTA_FRONTEND}\n`);
  console.error('Si moviste la carpeta del frontend, actualizá RUTA_FRONTEND en este script.');
  console.error(err.message);
  process.exit(1);
}

// El frontend guarda objetos con presentación (label, ícono, ejemplo); acá solo
// interesan los ids, que son los valores que viajan y que el backend valida.
const ids = (lista) => lista.map((x) => x.id);

const comparaciones = [
  { nombre: 'Unidades', backend: UNIDADES_VALIDAS, frontend: ids(frontend.UNIDADES) },
  { nombre: 'Envases', backend: ENVASES_VALIDOS, frontend: ids(frontend.TIPOS_ENVASE) },
  { nombre: 'Tipos de producto', backend: TIPOS_BACKEND, frontend: ids(frontend.TIPOS_PRODUCTO) },
];

let hayProblemas = false;

for (const { nombre, backend, frontend: front } of comparaciones) {
  const soloFrontend = front.filter((v) => !backend.includes(v));
  const soloBackend = backend.filter((v) => !front.includes(v));

  if (soloFrontend.length === 0 && soloBackend.length === 0) {
    console.log(`✅ ${nombre}: las dos listas coinciden (${backend.length} valores).`);
    continue;
  }

  hayProblemas = true;
  console.log(`❌ ${nombre}: las listas NO coinciden.`);
  if (soloFrontend.length > 0) {
    console.log(`   El formulario ofrece y el backend RECHAZA: ${soloFrontend.join(', ')}`);
    console.log('   → elegir eso en pantalla revienta el guardado con un 400.');
  }
  if (soloBackend.length > 0) {
    console.log(`   El backend acepta y el formulario no ofrece: ${soloBackend.join(', ')}`);
    console.log('   → valores muertos: nadie puede llegar a elegirlos.');
  }
}

if (hayProblemas) {
  console.log('\nArreglalo en config/unidadesEnvases.js, config/tiposProducto.js');
  console.log('y src/constants/inventario.js del frontend. Las tres tienen que decir lo mismo.');
  process.exit(1);
}

console.log('\nVocabulario parejo entre el backend y el formulario.');
