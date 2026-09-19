// scripts/probarFiltroPendiente.js
//
// Pruebas del filtro "Solo con pendiente" y del "Pendiente mínimo" de la lista
// de plays.
//
// POR QUÉ EXISTE
// El tiempo pendiente baja cuando se cierra un turno vencido, y eso pasa al
// LEER la lista. Si se cerrara después de filtrar, un play al que se le acaba
// de terminar el pendiente ya habría entrado por el filtro y saldría en
// pantalla con 0 min — que es justo lo que el filtro promete que no va a pasar.
// Con el mínimo es igual: se colaba uno que ya había bajado por debajo.
//
// El orden importa y no se ve en el código de un vistazo, así que se prueba lo
// observable: qué plays salen en la lista. Para eso hay una base falsa en
// memoria que entiende los cuatro operadores que usa el controlador; el
// controlador corre de verdad, sin tocar Mongo.
//
// Corre con `npm run probar-filtro-pendiente`.

import test from 'node:test';
import assert from 'node:assert/strict';

import Play from '../models/plays.js';
import { getAllPlays } from '../controllers/playsController.js';

// El controlador avisa por consola cada turno que cierra; acá no aporta.
console.log = () => {};
console.error = () => {};

const MIN = 60 * 1000;
const haceMinutos = (m) => new Date(Date.now() - m * MIN);
const enMinutos = (m) => new Date(Date.now() + m * MIN);

// ─── BASE FALSA ──────────────────────────────────────────────────────────────

// Solo lo que el controlador usa: $gt, $gte, $ne y la igualdad simple.
const coincide = (doc, filtro) =>
  Object.entries(filtro).every(([campo, cond]) => {
    const valor = doc[campo];
    if (cond && typeof cond === 'object' && !(cond instanceof RegExp) && !(cond instanceof Date)) {
      if ('$gt' in cond && !(valor > cond.$gt)) return false;
      if ('$gte' in cond && !(valor >= cond.$gte)) return false;
      if ('$ne' in cond && (valor === cond.$ne || valor === undefined)) return false;
      return true;
    }
    return String(valor) === String(cond);
  });

// Consulta encadenable (.sort().skip().limit(), .select().lean()) que se puede
// esperar con await, como las de mongoose.
const consulta = (filas) => {
  let desde = 0;
  let tope = Infinity;
  const q = {
    sort: () => q,
    select: () => q,
    lean: () => q,
    skip: (n) => {
      desde = n || 0;
      return q;
    },
    limit: (n) => {
      tope = n || Infinity;
      return q;
    },
    then: (ok, mal) =>
      Promise.resolve()
        .then(() => filas().slice(desde, desde + tope))
        .then(ok, mal),
  };
  return q;
};

// Reemplaza la colección de plays por una lista en memoria. Devuelve el orden
// en que el controlador fue llamando a la base, para poder revisarlo.
const conBaseFalsa = async (docs, fn) => {
  const originales = {
    find: Play.find,
    countDocuments: Play.countDocuments,
    updateOne: Play.updateOne,
  };
  const orden = [];

  Play.find = (filtro = {}) => {
    orden.push('find');
    return consulta(() => docs.filter((d) => coincide(d, filtro)));
  };
  Play.countDocuments = async (filtro = {}) => {
    orden.push('countDocuments');
    return docs.filter((d) => coincide(d, filtro)).length;
  };
  Play.updateOne = async (filtro, cambios) => {
    orden.push('updateOne');
    const doc = docs.find((d) => coincide(d, filtro));
    if (!doc) return { modifiedCount: 0 };
    Object.assign(doc, cambios.$set);
    return { modifiedCount: 1 };
  };

  try {
    return { orden, salida: await fn() };
  } finally {
    Object.assign(Play, originales);
  }
};

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

const listar = async (docs, query) => {
  const res = fakeRes();
  const { orden } = await conBaseFalsa(docs, () => getAllPlays({ query }, res));
  return { res, orden, clientes: (res.body?.data || []).map((p) => p.cliente) };
};

// Un play cualquiera; se le pisa lo que la prueba necesite.
const play = (extra) => ({
  _id: `id-${extra.cliente}`,
  cliente: extra.cliente,
  fecha: new Date(),
  tiempoPendiente: 0,
  pendienteEnCurso: null,
  ...extra,
});

// ─── EL FILTRO "SOLO CON PENDIENTE" ──────────────────────────────────────────

test('solo con pendiente: trae los que tienen minutos y deja fuera al que no', async () => {
  const docs = [
    play({ cliente: 'Lechita', tiempoPendiente: 26 }),
    play({ cliente: 'Sin nada', tiempoPendiente: 0 }),
    play({ cliente: 'Joseph', tiempoPendiente: 9 }),
  ];

  const { res, clientes } = await listar(docs, { soloPendiente: 'true' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(clientes, ['Lechita', 'Joseph']);
  assert.equal(res.body.pagination.total, 2, 'el contador tampoco cuenta al que no tiene');
});

test('al que se le acaba el pendiente jugándolo NO sale en la lista', async () => {
  // El caso real: tenía 45 min, los puso a correr todos y el turno ya venció.
  // Al leer la lista se cierra el turno y queda en 0. Si el cierre pasara
  // después del filtro, este play saldría igual, con 0 min en pantalla.
  const docs = [
    play({
      cliente: 'Thiago',
      tiempoPendiente: 45,
      pendienteEnCurso: { minutos: 45, inicio: haceMinutos(50), fin: haceMinutos(5) },
    }),
    play({ cliente: 'Lechita', tiempoPendiente: 26 }),
  ];

  const { res, clientes } = await listar(docs, { soloPendiente: 'true' });

  assert.deepEqual(clientes, ['Lechita'], 'Thiago ya no tiene pendiente: no puede aparecer');
  assert.equal(res.body.pagination.total, 1);
  assert.equal(docs[0].tiempoPendiente, 0, 'y su turno quedó cerrado en la base');
  assert.equal(docs[0].pendienteEnCurso, null);
});

test('el que jugó solo una parte sigue apareciendo, con lo que le queda', async () => {
  const docs = [
    play({
      cliente: 'Cristopher',
      tiempoPendiente: 43,
      pendienteEnCurso: { minutos: 20, inicio: haceMinutos(25), fin: haceMinutos(5) },
    }),
  ];

  const { clientes } = await listar(docs, { soloPendiente: 'true' });

  assert.deepEqual(clientes, ['Cristopher']);
  assert.equal(docs[0].tiempoPendiente, 23, 'le quedan 43 - 20');
});

test('el turno que todavía corre no se toca ni saca al play de la lista', async () => {
  const docs = [
    play({
      cliente: 'Jayron',
      tiempoPendiente: 25,
      pendienteEnCurso: { minutos: 25, inicio: haceMinutos(5), fin: enMinutos(20) },
    }),
  ];

  const { clientes, orden } = await listar(docs, { soloPendiente: 'true' });

  assert.deepEqual(clientes, ['Jayron']);
  assert.equal(docs[0].tiempoPendiente, 25, 'el pendiente baja al cerrar, no al arrancar');
  assert.ok(!orden.includes('updateOne'), 'no se escribe nada por un turno que sigue vivo');
});

test('los turnos vencidos se cierran ANTES de contar y de filtrar', async () => {
  const docs = [
    play({
      cliente: 'Thiago',
      tiempoPendiente: 45,
      pendienteEnCurso: { minutos: 45, inicio: haceMinutos(50), fin: haceMinutos(5) },
    }),
  ];

  const { orden } = await listar(docs, { soloPendiente: 'true' });

  const cierre = orden.indexOf('updateOne');
  const cuenta = orden.indexOf('countDocuments');
  assert.notEqual(cierre, -1, 'el turno vencido tenía que cerrarse');
  assert.ok(
    cierre < cuenta,
    `el cierre quedó después de contar (${orden.join(' → ')}): la lista sale con datos viejos`
  );
});

// ─── EL FILTRO "PENDIENTE MÍNIMO" ────────────────────────────────────────────

test('pendiente mínimo: deja fuera a los que no llegan', async () => {
  const docs = [
    play({ cliente: 'Cristopher', tiempoPendiente: 43 }),
    play({ cliente: 'Enyel', tiempoPendiente: 4 }),
    play({ cliente: 'Justo', tiempoPendiente: 30 }),
  ];

  const { clientes } = await listar(docs, { minPendiente: '30' });

  assert.deepEqual(clientes, ['Cristopher', 'Justo'], 'el mínimo incluye al que tiene exactamente 30');
});

test('un turno vencido que baja del mínimo saca al play de la lista', async () => {
  const docs = [
    play({
      cliente: 'Gabriel',
      tiempoPendiente: 38,
      pendienteEnCurso: { minutos: 20, inicio: haceMinutos(25), fin: haceMinutos(5) },
    }),
    play({ cliente: 'Cristopher', tiempoPendiente: 43 }),
  ];

  const { res, clientes } = await listar(docs, { minPendiente: '30' });

  assert.equal(docs[0].tiempoPendiente, 18, 'a Gabriel le quedaron 18');
  assert.deepEqual(clientes, ['Cristopher'], '18 no llega al mínimo de 30: no puede aparecer');
  assert.equal(res.body.pagination.total, 1);
});

test('sin filtros salen todos, con pendiente o sin él', async () => {
  const docs = [
    play({ cliente: 'Lechita', tiempoPendiente: 26 }),
    play({ cliente: 'Sin nada', tiempoPendiente: 0 }),
  ];

  const { clientes } = await listar(docs, {});

  assert.deepEqual(clientes, ['Lechita', 'Sin nada']);
});

test('un mínimo en cero o inválido no filtra nada (la lista completa)', async () => {
  const docs = [
    play({ cliente: 'Lechita', tiempoPendiente: 26 }),
    play({ cliente: 'Sin nada', tiempoPendiente: 0 }),
  ];

  assert.deepEqual((await listar(docs, { minPendiente: '0' })).clientes, ['Lechita', 'Sin nada']);
  assert.deepEqual((await listar(docs, { minPendiente: 'abc' })).clientes, ['Lechita', 'Sin nada']);
});
