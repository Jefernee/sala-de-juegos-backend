// scripts/probarJuegosDePlays.js
//
// Pruebas del selector "Juegos Jugados" del formulario de plays, que ahora se
// arma con DOS fuentes: la lista fija del frontend (JUEGOS_BASE) y los activos
// de la sala con categoría de juego, que llegan de GET /api/plays/juegos.
//
// POR QUÉ EXISTE
// Tres cosas se pueden romper solas y ninguna se ve hasta que alguien está
// cobrando un play:
//   1. Que el endpoint devuelva basura (nombres con espacios, vacíos) o
//      repetidos, y el selector muestre el mismo juego dos veces.
//   2. Que la ruta /juegos quede DESPUÉS de /:id en el router: Express la
//      tomaría como un id y contestaría "play no encontrado".
//   3. Que alguien vuelva a escribir la lista de juegos dentro de la página y
//      el agregado automático deje de pasar por ahí.
//
// No necesita Mongo: se reemplaza la consulta y el resto corre de verdad.
//
// Corre con `npm run probar-juegos` (o `node --test scripts/probarJuegosDePlays.js`).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import ActivoSala, { CATEGORIAS_ACTIVO, CATEGORIAS_JUEGO } from '../models/ActivoSala.js';
import { getJuegosDeActivos } from '../controllers/playsController.js';
import rutasPlays from '../routes/plays.js';

const aquí = path.dirname(fileURLToPath(import.meta.url));
const RUTA_FRONT = path.resolve(aquí, '../../sala-juegos-frontend-vite/src');
const RUTA_CATALOGO = path.join(RUTA_FRONT, 'constants/juegos.js');
const RUTA_PAGINA = path.join(RUTA_FRONT, 'pages/PlaysManagement.jsx');

// El catálogo del frontend es JS plano (no JSX) justamente para poder probarlo
// desde acá, igual que src/constants/inventario.js en verificarVocabulario.js.
let catalogo;
try {
  catalogo = await import(pathToFileURL(RUTA_CATALOGO).href);
} catch (err) {
  console.error(`No pude leer el catálogo de juegos del frontend en:\n  ${RUTA_CATALOGO}`);
  console.error('Si moviste la carpeta del frontend, actualizá RUTA_FRONT en este script.');
  console.error(err.message);
  process.exit(1);
}
const { JUEGOS_BASE, fusionarJuegos, normalizarJuego } = catalogo;

// Los controladores loguean cada error; acá no aporta.
console.error = () => {};

const fakeRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
};

// Reemplaza SOLO la consulta a Mongo. `distinct` recibe el filtro de verdad que
// arma el controlador, así que se puede revisar por qué categorías preguntó.
const conActivos = async (nombres, fn) => {
  const original = ActivoSala.distinct;
  const llamada = {};
  ActivoSala.distinct = async (campo, filtro) => {
    llamada.campo = campo;
    llamada.filtro = filtro;
    if (nombres instanceof Error) throw nombres;
    return nombres;
  };
  try {
    await fn();
    return llamada;
  } finally {
    ActivoSala.distinct = original;
  }
};

// ─── LAS CATEGORÍAS QUE CUENTAN COMO JUEGO ───────────────────────────────────

test('las categorías de juego son categorías de activo de verdad', () => {
  assert.deepEqual(CATEGORIAS_JUEGO, ['Juegos digitales', 'Juegos físicos']);
  const fuera = CATEGORIAS_JUEGO.filter((c) => !CATEGORIAS_ACTIVO.includes(c));
  assert.deepEqual(fuera, [], `Estas no existen en CATEGORIAS_ACTIVO: ${fuera.join(', ')}`);
});

// ─── EL ENDPOINT QUE LOS ENTREGA ─────────────────────────────────────────────

test('el endpoint pregunta por las dos categorías de juego, y solo por esas', async () => {
  const res = fakeRes();
  const llamada = await conActivos(['GTA V'], () => getJuegosDeActivos({}, res));

  assert.equal(llamada.campo, 'nombre');
  assert.deepEqual(llamada.filtro, { categoria: { $in: CATEGORIAS_JUEGO } });
});

test('el endpoint devuelve los juegos ordenados y limpios', async () => {
  const res = fakeRes();
  await conActivos(['  Tekken 8 ', 'EA FC 27', '', null, 'Assetto Corsa'], () =>
    getJuegosDeActivos({}, res)
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    res.body.data,
    ['Assetto Corsa', 'EA FC 27', 'Tekken 8'],
    'ordenados en español, sin espacios de sobra y sin nombres vacíos'
  );
});

test('si la consulta falla, el endpoint avisa pero no rompe el formulario', async () => {
  const res = fakeRes();
  await conActivos(new Error('Mongo caído'), () => getJuegosDeActivos({}, res));

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body.data, [], 'devuelve lista vacía: el front cae en JUEGOS_BASE');
});

test('la ruta /juegos va ANTES de /:id o Express la toma como un id', () => {
  const rutas = rutasPlays.stack.filter((capa) => capa.route).map((capa) => capa.route.path);

  const iJuegos = rutas.indexOf('/juegos');
  const iId = rutas.indexOf('/:id');
  assert.notEqual(iJuegos, -1, 'la ruta /juegos no está registrada en routes/plays.js');
  assert.notEqual(iId, -1, 'no encontré la ruta /:id para comparar');
  assert.ok(
    iJuegos < iId,
    `/juegos quedó después de /:id (posiciones ${iJuegos} y ${iId}): la petición caería en getPlayById`
  );
});

// ─── LA FUSIÓN DE LAS DOS LISTAS ─────────────────────────────────────────────

test('los juegos de siempre siguen estando todos', () => {
  const fusionados = fusionarJuegos(JUEGOS_BASE, ['Tekken 8']);
  const faltan = JUEGOS_BASE.filter((j) => !fusionados.includes(j));
  assert.deepEqual(faltan, [], `Se perdieron juegos de la lista de siempre: ${faltan.join(', ')}`);
  assert.equal(fusionados.length, JUEGOS_BASE.length + 1, 'y el nuevo se suma una sola vez');
  assert.equal(fusionados.at(-1), 'Tekken 8', 'lo nuevo va al final');
});

test('un activo que ya estaba en la lista no se duplica', () => {
  const fusionados = fusionarJuegos(JUEGOS_BASE, ['GTA V', 'Minecraft']);
  assert.equal(fusionados.length, JUEGOS_BASE.length, 'no entra ninguno nuevo');
  assert.equal(fusionados.filter((j) => j === 'GTA V').length, 1);
});

test('tildes, mayúsculas y espacios no cuelan el mismo juego dos veces', () => {
  const base = ['God of War Ragnarök', 'GTA V'];
  const fusionados = fusionarJuegos(base, ['god of war ragnarok', ' gta  v ', 'GTA-V']);
  assert.deepEqual(fusionados, base, 'todos eran el mismo juego escrito distinto');
});

test('el nombre que gana es el de la lista de siempre, no el del activo', () => {
  // El activo se llama distinto (así lo anotaron en Activos), pero el selector
  // tiene que seguir diciendo lo que siempre dijo.
  const fusionados = fusionarJuegos(['Minecraft'], ['minecraft']);
  assert.deepEqual(fusionados, ['Minecraft']);
});

test('nombres vacíos o en blanco no llegan al selector', () => {
  const fusionados = fusionarJuegos(['GTA V'], ['', '   ', null, undefined, '!!!']);
  assert.deepEqual(fusionados, ['GTA V']);
});

test('los juegos del play que se edita no desaparecen aunque ya no existan', () => {
  // Un juego que se borró de Activos y nunca estuvo en la lista fija: el play
  // viejo lo tiene guardado y su propia edición tiene que poder mostrarlo.
  const fusionados = fusionarJuegos(['GTA V'], [], ['Juego que ya no existe']);
  assert.deepEqual(fusionados, ['GTA V', 'Juego que ya no existe']);
});

test('sin activos y sin nada más, el selector queda igual que antes', () => {
  assert.deepEqual(fusionarJuegos(JUEGOS_BASE, [], []), JUEGOS_BASE);
});

test('normalizarJuego reconoce el mismo nombre escrito de otra forma', () => {
  assert.equal(normalizarJuego('Pokémon'), normalizarJuego('pokemon'));
  assert.equal(normalizarJuego('Call of Duty 2'), normalizarJuego('call  of-duty  2'));
  assert.notEqual(normalizarJuego('FIFA 25'), normalizarJuego('FIFA 26'));
});

// ─── QUE LA PÁGINA SIGA USANDO ESTO ──────────────────────────────────────────

test('la página de plays arma el selector con la fusión, sin lista propia', () => {
  const fuente = fs.readFileSync(RUTA_PAGINA, 'utf8');

  assert.ok(
    !/const\s+JUEGOS_DISPONIBLES\s*=\s*\[/.test(fuente),
    'PlaysManagement.jsx volvió a tener su propia lista de juegos: el agregado automático deja de pasar por el catálogo'
  );
  assert.match(
    fuente,
    /fusionarJuegos\(JUEGOS_BASE/,
    'el selector tiene que armarse con fusionarJuegos(JUEGOS_BASE, ...)'
  );
  assert.match(
    fuente,
    /\/api\/plays\/juegos/,
    'la página tiene que pedirle los juegos de Activos al backend'
  );
});
