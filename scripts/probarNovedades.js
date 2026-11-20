// scripts/probarNovedades.js
//
// Pruebas del módulo de Novedades (portada pública).
// Corre sin base de datos ni servidor:
//
//   node --test scripts/probarNovedades.js
//
// POR QUÉ EXISTE
// La portada muestra máximo 3 novedades. Si el filtro se rompe, o sale una
// novedad oculta/vencida, o se queda afuera la que sí toca. Además la fecha
// "mostrar hasta" es por día en hora de Costa Rica: una novedad con
// mostrarHasta = 15 debe verse TODO el día 15 (hasta las 23:59 CR).

import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import Novedad from '../models/Novedad.js';
import {
  getNovedadesPublicas, getNovedades, addNovedad, reordenarNovedades,
  estaVencida, decorarLista, debeBorrarAfiche,
} from '../controllers/novedadesController.js';
import { migrarNovedades, NOVEDAD_INICIAL } from '../utils/migrarNovedades.js';

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
const crear = (extra = {}) => ({
  _id: idFalso(), titulo: 'X', texto: '', etiqueta: 'Nuevo juego', afiche: '/a.jpg',
  juego: null, publicada: true, orden: 0, mostrarHasta: null,
  createdAt: new Date('2026-01-01T00:00:00Z'), ...extra,
});

const armarBase = (filas = []) => {
  const estado = { filas, bulk: [], creadas: [] };
  const ordenar = (lista, sort) => {
    if (!sort) return lista;
    const claves = Object.entries(sort);
    return [...lista].sort((a, b) => {
      for (const [k, dir] of claves) {
        const d = a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0;
        if (d) return d * dir;
      }
      return 0;
    });
  };
  const consulta = (lista, uno = false) => {
    let sort = null;
    const q = {
      sort: (s) => { sort = s; return q; },
      select: () => q,
      lean: async () => {
        const r = ordenar(lista, sort).map((f) => ({ ...f }));
        return uno ? r[0] || null : r;
      },
      then: (ok, mal) => Promise.resolve(ordenar(lista, sort)[0] || null).then(ok, mal),
    };
    return q;
  };
  Novedad.find = (filtro = {}) =>
    consulta(estado.filas.filter((f) => Object.entries(filtro).every(([k, v]) => f[k] === v)));
  Novedad.findOne = () => consulta(estado.filas, true);
  Novedad.countDocuments = async () => estado.filas.length;
  Novedad.create = async (d) => { const f = crear(d); estado.filas.push(f); estado.creadas.push(f); return f; };
  Novedad.bulkWrite = async (ops) => {
    estado.bulk = ops;
    for (const op of ops) {
      const f = estado.filas.find((x) => String(x._id) === String(op.updateOne.filter._id));
      f.orden = op.updateOne.update.$set.orden;
    }
  };
  Novedad.prototype.save = async function () {
    const f = crear(this.toObject());
    estado.filas.push(f);
    return { ...f, toObject: () => ({ ...f }) };
  };
  return estado;
};

const ayer = () => new Date(Date.now() - 24 * 3600 * 1000);
const manana = () => new Date(Date.now() + 24 * 3600 * 1000);

// ─── PÚBLICO ─────────────────────────────────────────────────────────────────

test('público: devuelve máximo 3, ordenadas por orden', async () => {
  armarBase([
    crear({ titulo: 'D', orden: 3 }), crear({ titulo: 'B', orden: 1 }),
    crear({ titulo: 'A', orden: 0 }), crear({ titulo: 'C', orden: 2 }),
  ]);
  const res = fakeRes();
  await getNovedadesPublicas({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.map((n) => n.titulo), ['A', 'B', 'C']);
});

test('público: empate de orden, la más nueva primero; y solo los campos de la página', async () => {
  armarBase([
    crear({ titulo: 'vieja', createdAt: new Date('2026-01-01') }),
    crear({ titulo: 'nueva', createdAt: new Date('2026-06-01') }),
  ]);
  const res = fakeRes();
  await getNovedadesPublicas({}, res);
  assert.deepEqual(res.body.data.map((n) => n.titulo), ['nueva', 'vieja']);
  assert.deepEqual(
    Object.keys(res.body.data[0]).sort(),
    ['_id', 'afiche', 'etiqueta', 'juego', 'texto', 'titulo']
  );
});

test('público: excluye las no publicadas', async () => {
  armarBase([crear({ titulo: 'oculta', publicada: false, orden: 0 }), crear({ titulo: 'visible', orden: 1 })]);
  const res = fakeRes();
  await getNovedadesPublicas({}, res);
  assert.deepEqual(res.body.data.map((n) => n.titulo), ['visible']);
});

test('público: excluye vencidas, no las vigentes y las que no tienen fecha', async () => {
  armarBase([
    crear({ titulo: 'vencida', orden: 0, mostrarHasta: ayer() }),
    crear({ titulo: 'vigente', orden: 1, mostrarHasta: manana() }),
    crear({ titulo: 'sinfecha', orden: 2 }),
  ]);
  const res = fakeRes();
  await getNovedadesPublicas({}, res);
  assert.deepEqual(res.body.data.map((n) => n.titulo), ['vigente', 'sinfecha']);
});

test('vencimiento: frontera del día en hora de Costa Rica', () => {
  // mostrarHasta = 15 de agosto → medianoche CR = 06:00Z. El día termina a las
  // 23:59:59.999 CR = 05:59:59.999Z del 16.
  const n = { mostrarHasta: new Date('2026-08-15T06:00:00Z') };
  assert.equal(estaVencida(n, new Date('2026-08-15T06:00:00Z')), false, 'a las 00:00 CR del 15 aún se ve');
  assert.equal(estaVencida(n, new Date('2026-08-16T05:59:59.999Z')), false, 'a las 23:59:59 CR del 15 aún se ve');
  assert.equal(estaVencida(n, new Date('2026-08-16T06:00:00Z')), true, 'a las 00:00 CR del 16 ya no');
  assert.equal(estaVencida({ mostrarHasta: null }), false);
});

// ─── LUGAR / VENCIDA ─────────────────────────────────────────────────────────

test('admin: lugar 1-3 para las que salen, null para el resto', async () => {
  armarBase([
    crear({ titulo: 'a', orden: 0 }),
    crear({ titulo: 'oculta', orden: 1, publicada: false }),
    crear({ titulo: 'vencida', orden: 2, mostrarHasta: ayer() }),
    crear({ titulo: 'b', orden: 3 }), crear({ titulo: 'c', orden: 4 }), crear({ titulo: 'd', orden: 5 }),
  ]);
  const res = fakeRes();
  await getNovedades({}, res);
  const porTitulo = Object.fromEntries(res.body.data.map((n) => [n.titulo, n]));
  assert.equal(porTitulo.a.lugar, 1);
  assert.equal(porTitulo.oculta.lugar, null);
  assert.equal(porTitulo.vencida.lugar, null);
  assert.equal(porTitulo.vencida.vencida, true);
  assert.equal(porTitulo.b.lugar, 2);
  assert.equal(porTitulo.c.lugar, 3);
  assert.equal(porTitulo.d.lugar, null);
  assert.equal(porTitulo.a.vencida, false);
  assert.equal(res.body.data.length, 6, 'el admin ve todas');
});

test('decorarLista: sin novedades devuelve vacío', () => {
  assert.deepEqual(decorarLista([]), []);
});

// ─── REORDENAR ───────────────────────────────────────────────────────────────

test('reordenar: asigna orden 0..n según el arreglo', async () => {
  const [a, b, c] = [crear({ titulo: 'a', orden: 0 }), crear({ titulo: 'b', orden: 1 }), crear({ titulo: 'c', orden: 2 })];
  const estado = armarBase([a, b, c]);
  const res = fakeRes();
  await reordenarNovedades({ body: { ids: [c._id, a._id, b._id] } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.map((n) => n.titulo), ['c', 'a', 'b']);
  assert.deepEqual(estado.filas.map((f) => f.orden), [1, 2, 0]);
});

test('reordenar: las que no vienen en el arreglo quedan después', async () => {
  const [a, b, c] = [crear({ titulo: 'a', orden: 0 }), crear({ titulo: 'b', orden: 1 }), crear({ titulo: 'c', orden: 2 })];
  armarBase([a, b, c]);
  const res = fakeRes();
  await reordenarNovedades({ body: { ids: [c._id] } }, res);
  assert.deepEqual(res.body.data.map((n) => n.titulo), ['c', 'a', 'b']);
});

test('reordenar: rechaza ids inválidos, repetidos, vacíos o inexistentes', async () => {
  const a = crear();
  armarBase([a]);
  const casos = [
    [{}, 400], [{ ids: [] }, 400], [{ ids: ['nope'] }, 400],
    [{ ids: [a._id, a._id] }, 400], [{ ids: [idFalso()] }, 404],
  ];
  for (const [body, esperado] of casos) {
    const res = fakeRes();
    await reordenarNovedades({ body }, res);
    assert.equal(res.statusCode, esperado, JSON.stringify(body));
    assert.ok(res.body.message);
  }
});

// ─── VALIDACIONES ────────────────────────────────────────────────────────────

test('crear: etiqueta inválida → 400 en español', async () => {
  armarBase();
  const res = fakeRes();
  await addNovedad({ body: { titulo: 'Hola', afiche: '/a.jpg', etiqueta: 'Otra' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /etiqueta inválida/);
});

test('crear: título vacío → 400', async () => {
  armarBase();
  const res = fakeRes();
  await addNovedad({ body: { titulo: '   ', afiche: '/a.jpg' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /título/);
});

test('crear: sin afiche → 400', async () => {
  armarBase();
  const res = fakeRes();
  await addNovedad({ body: { titulo: 'Hola' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /afiche/);
});

test('crear: sin orden va al final', async () => {
  armarBase([crear({ orden: 0 }), crear({ orden: 4 })]);
  const res = fakeRes();
  await addNovedad({ body: { titulo: 'Nueva', afiche: '/a.jpg' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.orden, 5);
});

test('modelo: etiqueta inválida, título vacío y texto largo no pasan', () => {
  const malo = (d) => new Novedad({ afiche: '/a.jpg', titulo: 'ok', ...d }).validateSync();
  assert.ok(malo({ etiqueta: 'Otra' }).errors.etiqueta);
  assert.ok(malo({ titulo: '' }).errors.titulo);
  assert.ok(malo({ texto: 'x'.repeat(401) }).errors.texto);
  assert.ok(malo({ titulo: 'x'.repeat(81) }).errors.titulo);
  assert.equal(malo({}), undefined);
  const n = new Novedad({ afiche: '/a.jpg', titulo: 'ok' });
  assert.equal(n.etiqueta, 'Nuevo juego');
  assert.equal(n.publicada, true);
  assert.equal(n.texto, '');
});

// ─── SEMILLA ─────────────────────────────────────────────────────────────────

test('semilla: con la colección vacía crea la de FC27, y la segunda vez no duplica', async () => {
  const estado = armarBase();
  assert.deepEqual(await migrarNovedades(), { creada: true });
  assert.equal(estado.filas.length, 1);
  assert.equal(estado.filas[0].titulo, 'EA Sports FC 27');
  assert.equal(estado.filas[0].etiqueta, 'Recién llegado');
  assert.equal(estado.filas[0].afiche, '/afiche-fc27.jpg');
  assert.equal(estado.filas[0].juego, 'EA FC 27');
  assert.equal(estado.filas[0].orden, 0);
  assert.deepEqual(await migrarNovedades(), { creada: false });
  assert.equal(estado.filas.length, 1);
});

test('semilla: si ya hay novedades (aunque ocultas) no crea nada', async () => {
  const estado = armarBase([crear({ publicada: false })]);
  assert.deepEqual(await migrarNovedades(), { creada: false });
  assert.equal(estado.creadas.length, 0);
  assert.equal(NOVEDAD_INICIAL.publicada, true);
});

// ─── AFICHES: nunca borrar la carátula de un juego del catálogo ─────────────
test('afiche: solo se borra de Cloudinary el que se subió desde la novedad', () => {
  const nube = 'https://res.cloudinary.com/drjsg8j92/image/upload/v1/activos-sala/gta6.jpg';
  assert.equal(debeBorrarAfiche({ afiche: nube, aficheSubido: true }), true, 'subido desde la novedad → se borra');
  assert.equal(debeBorrarAfiche({ afiche: nube, aficheSubido: false }), false, 'imagen del juego → NO se borra');
  assert.equal(debeBorrarAfiche({ afiche: nube }), false, 'sin marca (novedades viejas) → NO se borra');
  assert.equal(debeBorrarAfiche({ afiche: '/afiche-fc27.jpg', aficheSubido: true }), false, 'ruta del sitio → NO');
  assert.equal(debeBorrarAfiche(), false);
});

test('crear con la imagen de un juego (URL de texto): queda aficheSubido=false', async () => {
  const base = armarBase([]);
  const res = fakeRes();
  await addNovedad({ body: { titulo: 'GTA 6', afiche: 'https://res.cloudinary.com/x/image/upload/v1/activos-sala/gta6.jpg' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(base.filas.at(-1).aficheSubido, false);
});

test('crear subiendo una imagen: queda aficheSubido=true', async () => {
  const base = armarBase([]);
  const res = fakeRes();
  await addNovedad({ body: { titulo: 'Promo' }, cloudinaryUrl: 'https://res.cloudinary.com/x/image/upload/v1/productos/p.jpg' }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(base.filas.at(-1).aficheSubido, true);
});
