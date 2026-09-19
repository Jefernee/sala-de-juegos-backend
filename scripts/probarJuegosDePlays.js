// scripts/probarJuegosDePlays.js
//
// Pruebas del selector "Juegos Jugados" del formulario de plays, que se arma
// con DOS fuentes — la lista fija del frontend (JUEGOS_BASE) y los activos de
// la sala con categoría de juego — y se ORDENA por lo que más se está jugando.
// Todo eso llega junto en GET /api/plays/juegos.
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
//   4. Que el orden deje de responder a los plays y el selector vuelva a
//      abrir mostrando cualquier cosa en vez de lo que la gente pide.
//
// No necesita Mongo: se reemplaza la consulta y el resto corre de verdad.
//
// Corre con `npm run probar-juegos` (o `node --test scripts/probarJuegosDePlays.js`).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { CATEGORIAS_ACTIVO, CATEGORIAS_JUEGO } from '../models/ActivoSala.js';
import Juego from '../models/Juego.js';
import Play from '../models/plays.js';
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
const { JUEGOS_BASE, fusionarJuegos, normalizarJuego, ordenarPorPopularidad } = catalogo;

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

// Reemplaza las dos consultas que hace el endpoint: el catálogo de juegos y
// el ranking de los plays. El controlador corre de verdad.
const conCatalogo = async (fichas, fn, filasRanking = []) => {
  const originalFind = Juego.find;
  const originalAgg = Play.aggregate;
  const llamada = {};
  Juego.find = (filtro) => {
    llamada.filtro = filtro;
    return {
      select: () => ({
        lean: async () => {
          if (fichas instanceof Error) throw fichas;
          return fichas;
        },
      }),
    };
  };
  Play.aggregate = async (etapas) => {
    llamada.etapas = etapas;
    if (filasRanking instanceof Error) throw filasRanking;
    return filasRanking;
  };
  try {
    await fn();
    return llamada;
  } finally {
    Juego.find = originalFind;
    Play.aggregate = originalAgg;
  }
};

// ─── LAS CATEGORÍAS QUE CUENTAN COMO JUEGO ───────────────────────────────────

test('las categorías de juego son categorías de activo de verdad', () => {
  assert.deepEqual(CATEGORIAS_JUEGO, ['Juegos digitales', 'Juegos físicos']);
  const fuera = CATEGORIAS_JUEGO.filter((c) => !CATEGORIAS_ACTIVO.includes(c));
  assert.deepEqual(fuera, [], `Estas no existen en CATEGORIAS_ACTIVO: ${fuera.join(', ')}`);
});

// ─── EL ENDPOINT QUE LOS ENTREGA ─────────────────────────────────────────────

test('el endpoint pide los juegos que se están ofreciendo, y solo esos', async () => {
  const res = fakeRes();
  const llamada = await conCatalogo([{ nombre: 'GTA V' }], () => getJuegosDeActivos({}, res));

  assert.deepEqual(
    llamada.filtro,
    { padre: null, noSeOfrece: false },
    'padre:null deja fuera los complementos; noSeOfrece:false, los que se retiraron'
  );
});

test('el endpoint devuelve los juegos ordenados y limpios', async () => {
  const res = fakeRes();
  await conCatalogo(
    [{ nombre: '  Tekken 8 ' }, { nombre: 'EA FC 27' }, { nombre: '' }, { nombre: null }, { nombre: 'Assetto Corsa' }],
    () => getJuegosDeActivos({}, res)
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    res.body.data,
    ['Assetto Corsa', 'EA FC 27', 'Tekken 8'],
    'ordenados en español, sin espacios de sobra y sin nombres vacíos'
  );
});

test('si el catálogo falla, el endpoint avisa pero no rompe el formulario', async () => {
  const res = fakeRes();
  await conCatalogo(new Error('Mongo caído'), () => getJuegosDeActivos({}, res));

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

// ─── EL ORDEN: ADELANTE LO QUE MÁS SE JUEGA ────────────────────────────

test('el endpoint cuenta los juegos de los plays recientes, no los de siempre', async () => {
  const res = fakeRes();
  const llamada = await conCatalogo([], () => getJuegosDeActivos({}, res), []);

  const [match, unwind, group] = llamada.etapas;
  assert.ok(match.$match.fecha.$gte instanceof Date, 'tiene que mirar solo una ventana de tiempo');
  const dias = Math.round((Date.now() - match.$match.fecha.$gte.getTime()) / 86400000);
  assert.equal(dias, 90, 'la ventana del ranking son 90 días');
  assert.equal(res.body.diasRanking, 90, 'y el endpoint dice cuál usó');

  assert.equal(unwind.$unwind, '$juegosJugados', 'un play con 2 juegos cuenta para los dos');
  assert.deepEqual(group.$group.veces, { $sum: 1 }, 'cuenta plays, no suma tiempos');
});

test('el ranking llega con el nombre limpio y las veces que se jugó', async () => {
  const res = fakeRes();
  await conCatalogo([], () => getJuegosDeActivos({}, res), [
    { _id: ' FIFA 26 ', veces: 88 },
    { _id: 'GTA V', veces: 10 },
    { _id: '', veces: 5 },
    { _id: null, veces: 3 },
  ]);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.ranking, [
    { juego: 'FIFA 26', veces: 88 },
    { juego: 'GTA V', veces: 10 },
  ]);
});

test('si el ranking falla, el endpoint no se lleva puesto el formulario', async () => {
  const res = fakeRes();
  await conCatalogo([{ nombre: 'Tekken 8' }], () => getJuegosDeActivos({}, res), new Error('Mongo caído'));

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body.ranking, [], 'el front cae en el orden de siempre');
});

test('el más jugado queda de primero', () => {
  const juegos = ['Crash', 'FIFA 26', 'GTA V'];
  const ranking = [
    { juego: 'FIFA 26', veces: 88 },
    { juego: 'GTA V', veces: 10 },
    { juego: 'Crash', veces: 3 },
  ];
  assert.deepEqual(ordenarPorPopularidad(juegos, ranking), ['FIFA 26', 'GTA V', 'Crash']);
});

test('los que nadie jugó quedan al final, en el orden en que venían', () => {
  const juegos = ['Sackboy', 'Fall Guys', 'FIFA 26', 'Uncharted 4'];
  const ordenados = ordenarPorPopularidad(juegos, [{ juego: 'FIFA 26', veces: 88 }]);
  assert.deepEqual(ordenados, ['FIFA 26', 'Sackboy', 'Fall Guys', 'Uncharted 4']);
});

test('dos juegos con las mismas veces no se cambian de lugar entre cargas', () => {
  const juegos = ['Crash', 'Fortnite', 'Minecraft'];
  const ranking = [
    { juego: 'Minecraft', veces: 4 },
    { juego: 'Crash', veces: 4 },
    { juego: 'Fortnite', veces: 4 },
  ];
  // Empatados: manda el orden con el que llegaron, no el del ranking.
  assert.deepEqual(ordenarPorPopularidad(juegos, ranking), juegos);
});

test('el mismo juego guardado de dos formas suma, no se reparte', () => {
  // En los plays viejos quedó escrito distinto; si no se sumara, GTA V
  // aparecería abajo con 6 en vez de arriba con 12.
  const juegos = ['Crash', 'GTA V'];
  const ranking = [
    { juego: 'Crash', veces: 9 },
    { juego: 'GTA V', veces: 6 },
    { juego: 'gta v', veces: 6 },
  ];
  assert.deepEqual(ordenarPorPopularidad(juegos, ranking), ['GTA V', 'Crash']);
});

test('un juego jugado que ya no está en el selector no lo altera', () => {
  // Los plays viejos tienen nombres que ya no existen («EAFC25», «COD3»).
  const juegos = ['Crash', 'FIFA 26'];
  const ordenados = ordenarPorPopularidad(juegos, [
    { juego: 'EAFC25', veces: 267 },
    { juego: 'FIFA 26', veces: 88 },
  ]);
  assert.deepEqual(ordenados, ['FIFA 26', 'Crash'], 'no agrega ni corre nada de más');
});

test('ordenar no pierde ni repite ningún juego', () => {
  const ranking = [
    { juego: 'FIFA 26', veces: 88 },
    { juego: 'GTA V', veces: 10 },
    { juego: 'Minecraft', veces: 1 },
  ];
  const ordenados = ordenarPorPopularidad(JUEGOS_BASE, ranking);
  assert.equal(ordenados.length, JUEGOS_BASE.length);
  assert.deepEqual([...ordenados].sort(), [...JUEGOS_BASE].sort(), 'son exactamente los mismos');
});

test('sin ranking, el selector queda tal como venía', () => {
  assert.deepEqual(ordenarPorPopularidad(JUEGOS_BASE, []), JUEGOS_BASE);
  assert.deepEqual(ordenarPorPopularidad(JUEGOS_BASE), JUEGOS_BASE);
  assert.deepEqual(ordenarPorPopularidad(JUEGOS_BASE, [{ juego: '', veces: 9 }]), JUEGOS_BASE);
});

test('ordenar no modifica la lista original', () => {
  const juegos = ['Crash', 'FIFA 26'];
  ordenarPorPopularidad(juegos, [{ juego: 'FIFA 26', veces: 88 }]);
  assert.deepEqual(juegos, ['Crash', 'FIFA 26'], 'JUEGOS_BASE no se puede reordenar solo');
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
  assert.match(
    fuente,
    /ordenarPorPopularidad\(/,
    'el selector tiene que ordenarse por lo que más se juega'
  );
});
