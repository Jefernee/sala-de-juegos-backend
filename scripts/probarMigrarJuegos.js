// scripts/probarMigrarJuegos.js
//
// Pruebas de la migración del catálogo de Juegos y del modelo que la sostiene.
//
// POR QUÉ EXISTE
// Esta migración toca la colección de activos, que es de donde salen TODOS los
// números de plata del negocio. Lo único que le hace es agregar un enlace
// (`juegoId`); si algún día tocara un costo, una fecha o una placa, un mes ya
// cerrado cambiaría solo. Estas pruebas están para que eso no pueda pasar.
//
// Corre sin base de datos: se reemplazan las llamadas a Mongo y la lógica de
// la migración corre de verdad.
//
//   npm run probar-migrar-juegos

import test from 'node:test';
import assert from 'node:assert/strict';

import Juego, { normalizarNombre } from '../models/Juego.js';
import ActivoSala from '../models/ActivoSala.js';
import Play from '../models/plays.js';
import { migrarJuegos } from '../utils/migrarJuegos.js';

// ─── BASE FALSA ──────────────────────────────────────────────────────────────

const armarBase = (activos) => {
  const fichas = [];
  let n = 0;
  const escrituras = [];   // todo lo que la migración intenta escribir

  Juego.find = () => ({ lean: async () => fichas.map((f) => ({ ...f })) });
  Juego.create = async (doc) => {
    const guardado = { ...doc, _id: `f${++n}` };
    fichas.push(guardado);
    return { toObject: () => ({ ...guardado }) };
  };
  Juego.updateOne = async (filtro, cambio) => {
    escrituras.push({ coleccion: 'juegos', filtro, cambio });
    const f = fichas.find((x) => x._id === filtro._id);
    if (f) Object.assign(f, cambio.$set);
    return { modifiedCount: 1 };
  };

  // Respeta el filtro igual que Mongo: si no, un complemento entraría por el
  // camino de los juegos y la prueba mentiría.
  ActivoSala.find = (filtro = {}) => ({
    select: () => ({
      lean: async () => {
        const cats = filtro.categoria?.$in || (filtro.categoria ? [filtro.categoria] : null);
        return activos
          .filter((a) => !cats || cats.includes(a.categoria))
          .map((a) => ({ ...a }));
      },
    }),
  });
  ActivoSala.updateOne = async (filtro, cambio) => {
    escrituras.push({ coleccion: 'activos', filtro, cambio });
    const a = activos.find((x) => x._id === filtro._id);
    if (a) Object.assign(a, cambio.$set);
    return { modifiedCount: 1 };
  };

  Play.aggregate = async () => [
    { _id: 'FIFA 26', veces: 267 },
    { _id: 'Call of Duty 2', veces: 13 },
    { _id: 'Nombre viejo que ya nadie usa', veces: 1 },
  ];

  return { fichas, activos, escrituras };
};

// Los 4 activos reales de la sala, con sus montos exactos.
const activosReales = () => [
  { _id: 'a24', numeroPlaca: 24, nombre: 'Juego: COD BO2', categoria: 'Juegos digitales',
    costo: 9056, fechaCompra: new Date('2026-07-16'), juegoId: null },
  { _id: 'a49', numeroPlaca: 49, nombre: 'Juego de EA FC 27', categoria: 'Juegos digitales',
    costo: 45577, fechaCompra: new Date('2026-09-17'), juegoId: null },
  { _id: 'a25', numeroPlaca: 25, nombre: 'DLC COD Black Ops 2 usuario Antoyef', categoria: 'Complementos',
    costo: 4474, fechaCompra: new Date('2026-07-22'), juegoId: null },
  { _id: 'a45', numeroPlaca: 45, nombre: 'Compra de Mapa de Asetto Corza Usuario de Jefernee',
    categoria: 'Complementos', costo: 3241, fechaCompra: new Date('2026-08-09'), juegoId: null },
];

const juegoPorNombre = (fichas, nombre) =>
  fichas.find((f) => !f.padre && f.clave === normalizarNombre(nombre));

// ─── LO QUE NO SE PUEDE TOCAR ────────────────────────────────────────────────

test('la migración NO toca un solo campo de plata de los activos', async () => {
  const base = armarBase(activosReales());
  const antes = JSON.parse(JSON.stringify(base.activos));
  await migrarJuegos();

  const aActivos = base.escrituras.filter((e) => e.coleccion === 'activos');
  for (const e of aActivos) {
    assert.deepEqual(Object.keys(e.cambio.$set), ['juegoId'],
      `la migración escribió ${Object.keys(e.cambio.$set)} en un activo: solo puede escribir juegoId`);
  }
  for (const a of base.activos) {
    const original = antes.find((x) => x._id === a._id);
    assert.equal(a.costo, original.costo, `cambió el costo de la placa ${a.numeroPlaca}`);
    assert.equal(a.nombre, original.nombre, `cambió el nombre de la placa ${a.numeroPlaca}`);
    assert.equal(new Date(a.fechaCompra).getTime(), new Date(original.fechaCompra).getTime(),
      `cambió la fecha de compra de la placa ${a.numeroPlaca}: eso movería un mes ya cerrado`);
    assert.equal(a.numeroPlaca, original.numeroPlaca, 'la placa es inmutable');
  }
});

test('la simulación no escribe absolutamente nada', async () => {
  const base = armarBase(activosReales());
  const informe = await migrarJuegos({ dry: true });

  assert.equal(base.escrituras.length, 0, 'con --dry no se puede escribir');
  assert.equal(base.fichas.length, 0, 'ni crear fichas');
  assert.ok(informe.creados.length > 40, 'pero sí tiene que informar lo que haría');
});

// ─── QUE NO SE PIERDA NI SE DUPLIQUE NADA ────────────────────────────────────

test('los 49 juegos del selector quedan todos', async () => {
  const base = armarBase(activosReales());
  await migrarJuegos();
  for (const nombre of ['FIFA 26', 'GTA V', 'Assetto Corsa', "Assassin's Creed Valhalla", 'Uncharted 4']) {
    assert.ok(juegoPorNombre(base.fichas, nombre), `se perdió "${nombre}"`);
  }
  assert.ok(base.fichas.filter((f) => !f.padre).length >= 50);
});

test('correrla dos veces no duplica ni cambia nada', async () => {
  const base = armarBase(activosReales());
  await migrarJuegos();
  const despuesDeUna = base.fichas.length;
  const escriturasDeUna = base.escrituras.length;

  await migrarJuegos();
  assert.equal(base.fichas.length, despuesDeUna, 'la segunda corrida duplicó fichas');
  assert.equal(base.escrituras.length, escriturasDeUna, 'la segunda corrida volvió a escribir');
});

test('"COD BO2" se cuelga del "Call of Duty 2" que ya existía, sin crear otro', async () => {
  const base = armarBase(activosReales());
  await migrarJuegos();

  const cod2 = base.fichas.filter((f) => !f.padre && f.clave === normalizarNombre('Call of Duty 2'));
  assert.equal(cod2.length, 1, 'no puede haber dos "Call of Duty 2"');
  const activo = base.activos.find((a) => a.numeroPlaca === 24);
  assert.equal(activo.juegoId, cod2[0]._id, 'la compra tiene que quedar enlazada a ese juego');
});

test('EA FC 27 entra como juego nuevo, y el activo conserva su nombre de inventario', async () => {
  const base = armarBase(activosReales());
  await migrarJuegos();

  const ficha = juegoPorNombre(base.fichas, 'EA FC 27');
  assert.ok(ficha, 'tenía que crearse la ficha "EA FC 27"');
  const activo = base.activos.find((a) => a.numeroPlaca === 49);
  assert.equal(activo.juegoId, ficha._id);
  assert.equal(activo.nombre, 'Juego de EA FC 27', 'el inventario no se renombra');
});

test('los complementos quedan colgando de su juego, no sueltos', async () => {
  const base = armarBase(activosReales());
  await migrarJuegos();

  const cod2 = juegoPorNombre(base.fichas, 'Call of Duty 2');
  const assetto = juegoPorNombre(base.fichas, 'Assetto Corsa');
  const dlc = base.fichas.find((f) => f.nombre.startsWith('DLC COD'));
  const mapa = base.fichas.find((f) => f.nombre.startsWith('Compra de Mapa'));

  assert.equal(dlc.padre, cod2._id, 'el DLC es de Call of Duty 2');
  assert.equal(mapa.padre, assetto._id, 'el mapa es de Assetto Corsa');
  assert.equal(base.activos.find((a) => a.numeroPlaca === 25).juegoId, dlc._id);
  assert.equal(base.activos.find((a) => a.numeroPlaca === 45).juegoId, mapa._id);
});

test('avisa si algo que se juega quedó fuera del catálogo', async () => {
  const base = armarBase(activosReales());
  const informe = await migrarJuegos();
  assert.ok(
    informe.sinCatalogo.some((s) => s.includes('Nombre viejo')),
    'tiene que avisar de lo que se jugó y no está en la lista'
  );
  assert.ok(!informe.sinCatalogo.some((s) => s.includes('FIFA 26')), 'FIFA 26 sí está');
});

test('las portadas de la página se pegan a su juego', async () => {
  const base = armarBase(activosReales());
  await migrarJuegos();

  const cod6 = juegoPorNombre(base.fichas, 'Call of Duty 6');
  assert.ok(cod6.imagenUrl?.includes('cloudinary'), 'Call of Duty 6 tenía que recibir su portada');
  assert.equal(cod6.enVitrina, true);
  const gta = juegoPorNombre(base.fichas, 'GTA V');
  assert.ok(gta.imagenUrl, 'GTA V tenía que recibir la de "Grand Theft Auto Five"');
});

test('una portada que ya estaba puesta no se pisa', async () => {
  const base = armarBase(activosReales());
  await migrarJuegos();
  const cod6 = juegoPorNombre(base.fichas, 'Call of Duty 6');
  cod6.imagenUrl = 'https://mia.jpg';

  await migrarJuegos();
  assert.equal(cod6.imagenUrl, 'https://mia.jpg', 'la foto del usuario manda');
});

// ─── EL MODELO ───────────────────────────────────────────────────────────────

test('sin portada no se puede mandar a la página', async () => {
  // validate() es lo que corre al guardar; validateSync no dispara los hooks.
  const j = new Juego({ nombre: 'Prueba', enVitrina: true });
  await j.validate();
  assert.equal(j.enVitrina, false, 'sin imagen no puede quedar en la vitrina');

  const conFoto = new Juego({ nombre: 'Prueba 2', enVitrina: true, imagenUrl: 'https://x.jpg' });
  await conFoto.validate();
  assert.equal(conFoto.enVitrina, true);
});

test('la clave normalizada es la que impide los repetidos', () => {
  const a = new Juego({ nombre: '  GTA  V ' });
  const b = new Juego({ nombre: 'gta v' });
  a.validateSync(); b.validateSync();
  assert.equal(a.clave, b.clave, 'los dos tienen que chocar contra el índice único');
  assert.equal(normalizarNombre('Pokémon'), normalizarNombre('pokemon'));
  assert.notEqual(normalizarNombre('FIFA 25'), normalizarNombre('FIFA 26'));
});

test('el nombre es obligatorio', () => {
  const j = new Juego({ nombre: '' });
  assert.ok(j.validateSync(), 'sin nombre no se guarda');
});
