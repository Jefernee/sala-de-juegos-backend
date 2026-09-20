// scripts/probarJuegosController.js
//
// Pruebas de los endpoints del módulo de Juegos.
//
// POR QUÉ EXISTE
// Este módulo es la única pantalla, además de Activos, desde la que se puede
// crear plata. La regla es: sin "compra" no nace ningún activo, y con "compra"
// nace por el MISMO camino que usa el formulario de Activos. Si eso se rompe,
// o un juego de PS Plus empieza a contar como gasto, o una compra deja de
// contar. Las dos cosas son silenciosas y caras.
//
// Corre sin base de datos.
//
//   npm run probar-juegos-modulo

import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import Juego from '../models/Juego.js';
import ActivoSala from '../models/ActivoSala.js';
import Play from '../models/plays.js';
import {
  getJuegos, getVitrina, crearJuego, actualizarJuego, borrarJuego,
  agregarCompra, editarCompra,
} from '../controllers/juegosController.js';

console.log = () => {};
console.error = () => {};

const idFalso = () => new mongoose.Types.ObjectId();

const fakeRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

// ─── BASE FALSA ──────────────────────────────────────────────────────────────

const armarBase = ({ fichas = [], activos = [] } = {}) => {
  const estado = { fichas, activos, creados: [], borrados: [] };

  const filtrar = (lista, filtro = {}) =>
    lista.filter((x) =>
      Object.entries(filtro).every(([campo, cond]) => {
        const v = x[campo];
        if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
          if ('$ne' in cond) return String(v) !== String(cond.$ne) && v !== undefined;
          if ('$in' in cond) return cond.$in.some((c) => String(c) === String(v));
        }
        if (campo === '_id') return String(v) === String(cond);
        return String(v) === String(cond);
      })
    );

  const consulta = (filas) => {
    const q = {
      sort: () => q, select: () => q, lean: async () => filas,
      then: (ok, mal) => Promise.resolve(filas).then(ok, mal),
    };
    return q;
  };

  Juego.find = (filtro) => consulta(filtrar(estado.fichas, filtro));
  Juego.findOne = (filtro) => consulta(filtrar(estado.fichas, filtro)[0] || null);
  // Sirve para las dos formas en que el controlador lo usa: como documento
  // (para editar y guardar) y con .lean() (para solo leer).
  Juego.findById = (id) => {
    const f = estado.fichas.find((x) => String(x._id) === String(id)) || null;
    const doc = f
      ? { ...f, save: async function () { Object.assign(f, this); return this; }, toObject: () => ({ ...f }) }
      : null;
    return {
      lean: async () => (f ? { ...f } : null),
      select: () => ({ lean: async () => (f ? { ...f } : null) }),
      then: (ok, mal) => Promise.resolve(doc).then(ok, mal),
    };
  };
  Juego.create = async (doc) => {
    const guardado = { _id: idFalso(), enVitrina: false, noSeOfrece: false, ...doc };
    estado.fichas.push(guardado);
    estado.creados.push(guardado);
    return { ...guardado, toObject: () => ({ ...guardado }) };
  };
  Juego.deleteOne = async (f) => {
    estado.fichas = estado.fichas.filter((x) => String(x._id) !== String(f._id));
    return { deletedCount: 1 };
  };
  Juego.deleteMany = async (f) => {
    const ids = (f._id?.$in || []).map(String);
    estado.borrados.push(...ids);
    estado.fichas = estado.fichas.filter((x) => !ids.includes(String(x._id)));
    return { deletedCount: ids.length };
  };

  ActivoSala.find = (filtro) => consulta(filtrar(estado.activos, filtro));
  ActivoSala.findOne = (filtro) => consulta(filtrar(estado.activos, filtro)[0] || null);
  Play.aggregate = async () => [{ _id: 'FIFA 26', veces: 267 }];

  return estado;
};

const ficha = (nombre, extra = {}) => ({
  _id: idFalso(), nombre, clave: nombre.toLowerCase(), padre: null,
  imagenUrl: null, enVitrina: false, noSeOfrece: false, ...extra,
});

// ─── LA REGLA: SIN COMPRA NO HAY PLATA ───────────────────────────────────────

test('un juego sin compra no crea ningún activo', async () => {
  const base = armarBase();
  const res = fakeRes();
  await crearJuego({ body: { nombre: 'Fall Guys' } }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(base.activos.length, 0, 'un juego de PS Plus no puede crear plata');
  assert.deepEqual(res.body.data.compras, []);
});

test('un juego con compra crea el activo por el camino de siempre', async () => {
  const base = armarBase();
  let registrado = null;
  // El activo se crea de verdad: se intercepta el guardado para revisarlo.
  const originalSave = ActivoSala.prototype.save;
  ActivoSala.prototype.save = async function () { registrado = this; return this; };
  const { default: Counter } = await import('../models/Counter.js');
  const originalCounter = Counter.findByIdAndUpdate;
  Counter.findByIdAndUpdate = async () => ({ seq: 77 });

  const res = fakeRes();
  await crearJuego({
    body: {
      nombre: 'Tekken 8',
      compra: { tipo: 'digital', costo: '30000', fechaCompra: '2026-09-19', usuario: 'jefernee' },
    },
  }, res);

  ActivoSala.prototype.save = originalSave;
  Counter.findByIdAndUpdate = originalCounter;

  assert.equal(res.statusCode, 201);
  assert.ok(registrado, 'tenía que crearse el activo');
  assert.equal(registrado.costo, 30000);
  assert.equal(registrado.numeroPlaca, 77, 'con su placa consecutiva');
  assert.equal(registrado.categoria, 'Juegos digitales');
  // EL NOMBRE ES SIEMPRE EL DEL JUEGO. Antes había un campo para reescribirlo
  // y terminó usándose para anotar de quién era la copia, así que en Activos
  // 17 de 19 filas de juegos no decían de qué juego eran.
  assert.equal(registrado.nombre, 'Tekken 8', 'la fila de Activos tiene que decir qué juego es');
  assert.equal(registrado.descripcion, 'jefernee', 'y de quién es va debajo, en la descripción');
  assert.ok(registrado.juegoId, 'y queda enlazado a la ficha');
  assert.ok(registrado.fechaCompra instanceof Date, 'con fecha: si no, no cae en ningún mes');
});

test('la foto de la factura se guarda igual que en Activos', async () => {
  // El formulario de compra de Juegos no tenía dónde adjuntarla, así que de
  // 19 compras de juegos NINGUNA tenía factura. Entra por el mismo campo que
  // usa Activos y se guarda en el mismo lugar: es la misma factura, entre por
  // donde entre.
  armarBase();
  let registrado = null;
  const originalSave = ActivoSala.prototype.save;
  ActivoSala.prototype.save = async function () { registrado = this; return this; };
  const { default: Counter } = await import('../models/Counter.js');
  const originalCounter = Counter.findByIdAndUpdate;
  Counter.findByIdAndUpdate = async () => ({ seq: 78 });

  const res = fakeRes();
  await crearJuego({
    // El middleware de subida deja la URL acá antes de llegar al controlador.
    cloudinaryFacturaUrl: 'https://res.cloudinary.com/x/factura.jpg',
    body: {
      nombre: 'Tekken 9',
      compra: { tipo: 'digital', costo: '25000', fechaCompra: '2026-09-19' },
    },
  }, res);

  ActivoSala.prototype.save = originalSave;
  Counter.findByIdAndUpdate = originalCounter;

  assert.equal(res.statusCode, 201);
  assert.equal(registrado.imagenFacturaUrl, 'https://res.cloudinary.com/x/factura.jpg');
});

test('sin foto de factura, el campo queda en null y no en undefined', async () => {
  // Con undefined el campo ni se guarda, y después una edición no lo encuentra.
  armarBase();
  let registrado = null;
  const originalSave = ActivoSala.prototype.save;
  ActivoSala.prototype.save = async function () { registrado = this; return this; };
  const { default: Counter } = await import('../models/Counter.js');
  const originalCounter = Counter.findByIdAndUpdate;
  Counter.findByIdAndUpdate = async () => ({ seq: 79 });

  const res = fakeRes();
  await crearJuego({
    body: { nombre: 'Tekken 10', compra: { tipo: 'digital', costo: '1000', fechaCompra: '2026-09-19' } },
  }, res);

  ActivoSala.prototype.save = originalSave;
  Counter.findByIdAndUpdate = originalCounter;
  assert.equal(registrado.imagenFacturaUrl, null);
});

test('una compra sin fecha se rechaza: quedaría fuera del estado de resultados', async () => {
  armarBase();
  const res = fakeRes();
  await crearJuego({ body: { nombre: 'X', compra: { tipo: 'digital', costo: 1000 } } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /fecha de compra es obligatoria/i);
});

test('una compra con costo inválido se rechaza antes de crear nada', async () => {
  const base = armarBase();
  for (const costo of [0, -5, 'abc', null]) {
    const res = fakeRes();
    await crearJuego({ body: { nombre: `J${costo}`, compra: { costo, fechaCompra: '2026-09-19' } } }, res);
    assert.equal(res.statusCode, 400, `aceptó un costo de ${costo}`);
  }
  assert.equal(base.fichas.length, 0, 'no puede quedar ninguna ficha suelta');
});

// ─── NOMBRES ─────────────────────────────────────────────────────────────────

test('no entran dos juegos con el mismo nombre', async () => {
  const base = armarBase({ fichas: [ficha('GTA V', { clave: 'gta v' })] });
  const res = fakeRes();
  await crearJuego({ body: { nombre: '  gta   v ' } }, res);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /ya está en la lista/);
  assert.equal(base.fichas.length, 1);
});

test('sin nombre no se guarda', async () => {
  const base = armarBase();
  const res = fakeRes();
  await crearJuego({ body: { nombre: '   ' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(base.fichas.length, 0);
});

test('un complemento no puede colgar de otro complemento', async () => {
  const padre = ficha('Call of Duty 2');
  const hijo = ficha('Mapas', { padre: padre._id });
  armarBase({ fichas: [padre, hijo] });
  const res = fakeRes();
  await crearJuego({ body: { nombre: 'Sub-mapa', padre: String(hijo._id) } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /no puede colgar de otro complemento/);
});

// ─── BORRAR: LA PLATA NO SE BORRA DESDE ACÁ ──────────────────────────────────

test('no se puede borrar un juego que tiene compras', async () => {
  const j = ficha('Call of Duty 2');
  const base = armarBase({
    fichas: [j],
    activos: [{ _id: idFalso(), numeroPlaca: 24, nombre: 'Juego: COD BO2', costo: 9056, juegoId: j._id }],
  });
  const res = fakeRes();
  await borrarJuego({ params: { id: String(j._id) } }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'TIENE_COMPRAS');
  assert.match(res.body.message, /9.056/);
  assert.match(res.body.message, /#24/);
  assert.equal(base.fichas.length, 1, 'la ficha no se puede haber borrado');
});

test('tampoco si el que tiene la compra es un complemento suyo', async () => {
  const j = ficha('Assetto Corsa');
  const h = ficha('Mapa comprado', { padre: j._id });
  const base = armarBase({
    fichas: [j, h],
    activos: [{ _id: idFalso(), numeroPlaca: 45, nombre: 'Mapa', costo: 3241, juegoId: h._id }],
  });
  const res = fakeRes();
  await borrarJuego({ params: { id: String(j._id) } }, res);

  assert.equal(res.statusCode, 409, 'la plata del complemento también protege al juego');
  assert.equal(base.fichas.length, 2);
});

test('un juego sin compras se borra, y se lleva sus complementos gratis', async () => {
  const j = ficha('Fall Guys');
  const h1 = ficha('Skin gratis', { padre: j._id });
  const h2 = ficha('Otro extra', { padre: j._id });
  const base = armarBase({ fichas: [j, h1, h2] });
  const res = fakeRes();
  await borrarJuego({ params: { id: String(j._id) } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(base.fichas.length, 0, 'se va con sus complementos');
  assert.match(res.body.message, /2 complemento/);
});

// ─── LA PÁGINA PÚBLICA ───────────────────────────────────────────────────────

test('la vitrina muestra todos los que se ofrecen y tienen foto', async () => {
  let filtro = null;
  Juego.find = (f) => {
    filtro = f;
    return { select: () => ({ lean: async () => [] }) };
  };
  Play.aggregate = async () => [];
  const res = fakeRes();
  await getVitrina({}, res);

  assert.equal(filtro.padre, null, 'un complemento no sale en la página');
  assert.equal(filtro.noSeOfrece, false, 'lo retirado no se le muestra al cliente');
  assert.deepEqual(filtro.imagenUrl, { $ne: null }, 'nunca una tarjeta sin foto');
  assert.equal(filtro.enVitrina, undefined, 'la estrella ya no decide quién entra, sino el orden');
});

test('en la página abren los más jugados', async () => {
  Juego.find = () => ({
    select: () => ({
      lean: async () => [
        { nombre: 'Sackboy', clave: 'sackboy', enVitrina: true },
        { nombre: 'FIFA 26', clave: 'fifa 26', enVitrina: false },
        { nombre: 'GTA V', clave: 'gta v', enVitrina: false },
      ],
    }),
  });
  Play.aggregate = async () => [
    { _id: 'FIFA 26', veces: 267 },
    { _id: 'GTA V', veces: 62 },
  ];
  const res = fakeRes();
  await getVitrina({}, res);

  assert.deepEqual(
    res.body.data.map((j) => j.nombre),
    ['FIFA 26', 'GTA V', 'Sackboy'],
    'manda lo jugado: la estrella de Sackboy no lo pone adelante de FIFA 26'
  );
});

test('entre los que se jugaron lo mismo, la estrella desempata', async () => {
  Juego.find = () => ({
    select: () => ({
      lean: async () => [
        { nombre: 'Zzz sin estrella', clave: 'zzz sin estrella', enVitrina: false },
        { nombre: 'Aaa sin estrella', clave: 'aaa sin estrella', enVitrina: false },
        { nombre: 'Mmm con estrella', clave: 'mmm con estrella', enVitrina: true },
      ],
    }),
  });
  Play.aggregate = async () => [];
  const res = fakeRes();
  await getVitrina({}, res);

  assert.deepEqual(
    res.body.data.map((j) => j.nombre),
    ['Mmm con estrella', 'Aaa sin estrella', 'Zzz sin estrella'],
    'primero la estrella, y después el abecedario'
  );
});

test('para mostrarlo en la página primero hace falta la portada', async () => {
  const j = ficha('Sin foto');
  armarBase({ fichas: [j] });
  const res = fakeRes();
  await actualizarJuego({ params: { id: String(j._id) }, body: { enVitrina: true } }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /necesita una portada/i);
});

test('con portada sí se puede marcar', async () => {
  const j = ficha('Con foto', { imagenUrl: 'https://x.jpg' });
  armarBase({ fichas: [j] });
  const res = fakeRes();
  await actualizarJuego({ params: { id: String(j._id) }, body: { enVitrina: true } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.enVitrina, true);
});

// ─── LA LISTA DEL MÓDULO ─────────────────────────────────────────────────────

test('el módulo ordena igual que la página: primero los más jugados', async () => {
  const a = ficha('Poco jugado', { clave: 'poco jugado' });
  const b = ficha('FIFA 26', { clave: 'fifa 26' });
  armarBase({ fichas: [a, b], activos: [] });
  Play.aggregate = async () => [{ _id: 'FIFA 26', veces: 267 }];

  const res = fakeRes();
  await getJuegos({}, res);

  assert.deepEqual(
    res.body.data.map((j) => j.nombre),
    ['FIFA 26', 'Poco jugado'],
    'lo que ve el dueño en el módulo es el orden que ve el cliente'
  );
});

test('cada juego llega con sus complementos y lo gastado sumado', async () => {
  const j = ficha('Call of Duty 2', { clave: 'call of duty 2' });
  const h = ficha('DLC', { padre: j._id, clave: 'dlc' });
  armarBase({
    fichas: [j, h],
    activos: [
      { _id: idFalso(), numeroPlaca: 24, costo: 9056, juegoId: j._id, nombre: 'Juego: COD BO2' },
      { _id: idFalso(), numeroPlaca: 25, costo: 4474, juegoId: h._id, nombre: 'DLC COD' },
    ],
  });
  const res = fakeRes();
  await getJuegos({}, res);

  const juego = res.body.data.find((x) => x.nombre === 'Call of Duty 2');
  assert.equal(juego.complementos.length, 1);
  assert.equal(juego.gastado, 13530, 'el juego más su complemento');
  assert.equal(juego.compras.length, 1, 'y se ve de dónde sale cada monto');
  assert.equal(res.body.data.length, 1, 'los complementos no se listan como juegos');
});

// ─── DE GRATIS A COMPRADO, Y DE VUELTA ───────────────────────────────────────

// Deja lista la creación de activos sin tocar Mongo, y devuelve lo que se creó.
const conRegistroDeActivos = async (fn, placa = 90) => {
  const { default: Counter } = await import('../models/Counter.js');
  const originalSave = ActivoSala.prototype.save;
  const originalCounter = Counter.findByIdAndUpdate;
  let creado = null;
  ActivoSala.prototype.save = async function () { creado = this; return this; };
  Counter.findByIdAndUpdate = async () => ({ seq: placa });
  try {
    await fn();
    return creado;
  } finally {
    ActivoSala.prototype.save = originalSave;
    Counter.findByIdAndUpdate = originalCounter;
  }
};

test('un juego que estaba gratis puede pasar a comprado', async () => {
  const j = ficha('Dragon Ball Sparking Zero');
  armarBase({ fichas: [j] });
  const res = fakeRes();

  const activo = await conRegistroDeActivos(() =>
    agregarCompra(
      { params: { id: String(j._id) }, body: { tipo: 'fisico', costo: '32500', fechaCompra: '2026-09-19' } },
      res
    )
  );

  assert.equal(res.statusCode, 201);
  assert.equal(activo.costo, 32500);
  assert.equal(activo.categoria, 'Juegos físicos');
  assert.equal(String(activo.juegoId), String(j._id), 'la compra queda pegada a ese juego');
  assert.equal(activo.numeroPlaca, 90);
  assert.match(res.body.message, /2026-09/, 'dice en qué mes va a contar');
});

test('la compra que se agrega después también exige costo y fecha', async () => {
  const j = ficha('Dragon Ball Sparking Zero');
  armarBase({ fichas: [j] });

  let res = fakeRes();
  await agregarCompra({ params: { id: String(j._id) }, body: { costo: 0, fechaCompra: '2026-09-19' } }, res);
  assert.equal(res.statusCode, 400, 'un costo en cero no es una compra');

  res = fakeRes();
  await agregarCompra({ params: { id: String(j._id) }, body: { costo: 5000 } }, res);
  assert.equal(res.statusCode, 400, 'sin fecha quedaría fuera del estado de resultados');
});

test('no se le puede registrar una compra a un juego que no existe', async () => {
  armarBase({ fichas: [] });
  const res = fakeRes();
  await agregarCompra({ params: { id: String(idFalso()) }, body: { costo: 100, fechaCompra: '2026-09-19' } }, res);
  assert.equal(res.statusCode, 404);
});

test('corregir el monto de una compra ya registrada', async () => {
  const j = ficha('Dragon Ball Sparking Zero');
  const guardado = {
    numeroPlaca: 90, costo: 32500, juegoId: j._id, nombre: 'Juego DBSZ',
    fechaCompra: new Date('2026-09-19T06:00:00Z'),
    save: async function () { return this; },
  };
  armarBase({ fichas: [j] });
  ActivoSala.findOne = () => ({ then: (ok) => Promise.resolve(guardado).then(ok) });

  const res = fakeRes();
  await editarCompra({ params: { id: String(j._id), placa: '90' }, body: { costo: 29900 } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(guardado.costo, 29900, 'el monto nuevo queda en el activo');
  assert.match(res.body.message, /reportes se rehicieron/i);
});

test('no se puede poner un costo inválido al corregir', async () => {
  const j = ficha('X');
  const guardado = { numeroPlaca: 90, costo: 100, juegoId: j._id, fechaCompra: new Date(), save: async function () { return this; } };
  armarBase({ fichas: [j] });
  ActivoSala.findOne = () => ({ then: (ok) => Promise.resolve(guardado).then(ok) });

  const res = fakeRes();
  await editarCompra({ params: { id: String(j._id), placa: '90' }, body: { costo: -1 } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(guardado.costo, 100, 'no se pudo haber cambiado nada');
});

test('una placa que no es de un juego no se edita desde acá', async () => {
  armarBase({ fichas: [] });
  const suelto = { numeroPlaca: 12, costo: 350000, juegoId: null, save: async function () { return this; } };
  ActivoSala.findOne = () => ({ then: (ok) => Promise.resolve(suelto).then(ok) });

  const res = fakeRes();
  await editarCompra({ params: { id: String(idFalso()), placa: '12' }, body: { costo: 1 } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /desde Activos/);
});
