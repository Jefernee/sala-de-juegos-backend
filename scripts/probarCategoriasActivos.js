// scripts/probarCategoriasActivos.js
//
// Pruebas de las CATEGORÍAS de los activos de la sala, con foco en la nueva
// "Complementos" (lo que se compra aparte para un juego que ya se tiene: mapas
// y DLC de Call of Duty, pases de temporada, monedas).
//
// POR QUÉ EXISTE
// Una categoría vive escrita en tres lugares y si se separan el bug es
// silencioso: el enum del modelo, la guarda de los controladores (crear y
// editar) y la lista del formulario del frontend. Si el formulario ofrece una
// opción que el backend no conoce, el usuario la elige, la ve seleccionada y el
// guardado se cae con un 400 por un campo que en pantalla se ve bien.
//
// Se prueban los DOS caminos que el usuario toca: registrar un activo nuevo
// (addActivo) y editar uno existente (updateActivo). Para no necesitar Mongo se
// reemplazan solo las llamadas a la base (el contador de placas, save,
// findById y findByIdAndUpdate); la lógica del controlador corre de verdad.
//
// Corre con `npm run probar-categorias` (o `node --test scripts/probarCategoriasActivos.js`).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

import ActivoSala, { CATEGORIAS_ACTIVO } from '../models/ActivoSala.js';
import Counter from '../models/Counter.js';
import { addActivo, updateActivo } from '../controllers/activosSalaController.js';

// La categoría nueva, en un solo lugar para que la prueba se lea sola.
const NUEVA = 'Complementos';
// Algo que NADIE debe poder guardar: sirve para probar el rechazo.
const INVENTADA = 'Mapas COD';

// Si algo se escapa a la base (los reportes que se regeneran en segundo plano),
// que falle de una en vez de esperar 10 s a que mongoose deje de bufferear.
mongoose.set('bufferTimeoutMS', 1);

// Los controladores son habladores (console.log de cada guardado) y los reportes
// en segundo plano avisan que no hay base. Nada de eso aporta acá.
console.log = () => {};
console.error = () => {};

// ─── DOBLES DE PRUEBA ────────────────────────────────────────────────────────

// res falso: guarda el código y el cuerpo con los que respondió el controlador.
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

const idValido = () => new mongoose.Types.ObjectId().toString();

// Reemplaza SOLO lo que toca Mongo al crear: el contador de placas y el save.
// El save corre la validación del esquema igual que el de verdad, así que si el
// enum y la guarda del controlador se separan, la prueba lo caza.
const conMongoFalsoAlCrear = async (fn) => {
  const counterOriginal = Counter.findByIdAndUpdate;
  const saveOriginal = ActivoSala.prototype.save;
  Counter.findByIdAndUpdate = async () => ({ seq: 7 });
  ActivoSala.prototype.save = async function guardarEnMemoria() {
    const error = this.validateSync();
    if (error) throw error;
    return this;
  };
  try {
    return await fn();
  } finally {
    Counter.findByIdAndUpdate = counterOriginal;
    ActivoSala.prototype.save = saveOriginal;
  }
};

// Reemplaza lo que toca Mongo al editar. Devuelve lo que el controlador mandó
// en el $set, que es lo que de verdad se iba a escribir en la base.
// findByIdAndUpdate valida como el real (va con runValidators: true).
const conMongoFalsoAlEditar = async (activoActual, fn) => {
  const findOriginal = ActivoSala.findById;
  const updateOriginal = ActivoSala.findByIdAndUpdate;
  const capturado = {};
  ActivoSala.findById = async () => activoActual;
  ActivoSala.findByIdAndUpdate = async (_id, update) => {
    capturado.$set = update.$set;
    await ActivoSala.validate(update.$set, Object.keys(update.$set));
    return { ...activoActual, ...update.$set };
  };
  try {
    await fn();
    return capturado;
  } finally {
    ActivoSala.findById = findOriginal;
    ActivoSala.findByIdAndUpdate = updateOriginal;
  }
};

// Un activo ya guardado, como lo devuelve findById al editar.
const activoGuardado = () => ({
  _id: idValido(),
  numeroPlaca: 7,
  nombre: 'Mapas Call of Duty',
  categoria: 'Otros',
  costo: 12000,
  estado: 'En uso',
  estadoOverride: null,
  reparaciones: [],
  fechaCompra: null,
  imagenUrl: null,
  imagenFacturaUrl: null,
});

// ─── EL VOCABULARIO ──────────────────────────────────────────────────────────

test('"Complementos" es una categoría válida del backend', () => {
  assert.ok(
    CATEGORIAS_ACTIVO.includes(NUEVA),
    `CATEGORIAS_ACTIVO debería incluir "${NUEVA}"; tiene: ${CATEGORIAS_ACTIVO.join(', ')}`
  );
});

test('el esquema acepta "Complementos" y sigue rechazando lo inventado', () => {
  const bueno = new ActivoSala({ nombre: 'Mapas Call of Duty', costo: 12000, categoria: NUEVA });
  assert.equal(bueno.validateSync(), undefined, 'el esquema debería aceptar la categoría nueva');

  const malo = new ActivoSala({ nombre: 'Mapas Call of Duty', costo: 12000, categoria: INVENTADA });
  assert.ok(malo.validateSync(), 'el esquema no debería aceptar una categoría que no está en la lista');
});

// ─── CREAR UN ACTIVO NUEVO (POST /api/activos-sala) ──────────────────────────

test('crear: guarda un activo con categoría "Complementos"', async () => {
  const req = {
    body: {
      nombre: 'Mapas Call of Duty',
      costo: '12000',
      categoria: NUEVA,
      fechaCompra: '2026-09-19',
    },
  };
  const res = fakeRes();

  await conMongoFalsoAlCrear(() => addActivo(req, res));

  assert.equal(res.statusCode, 201, `esperaba 201 y respondió ${res.statusCode}: ${res.body?.message}`);
  assert.equal(res.body.data.categoria, NUEVA, 'la categoría tiene que quedar guardada como vino');
  assert.equal(res.body.data.nombre, 'Mapas Call of Duty');
  assert.equal(res.body.data.numeroPlaca, 7, 'el activo nuevo lleva su placa consecutiva');
  assert.equal(res.body.data.estado, 'En uso', 'sin reparaciones, arranca en uso');
});

test('crear: una categoría que no existe se rechaza con 400', async () => {
  const req = { body: { nombre: 'Mapas Call of Duty', costo: '12000', categoria: INVENTADA } };
  const res = fakeRes();

  await conMongoFalsoAlCrear(() => addActivo(req, res));

  assert.equal(res.statusCode, 400, 'una categoría inventada no se puede guardar');
  assert.match(res.body.message, /Categoría inválida/);
  assert.ok(
    res.body.message.includes(NUEVA),
    'el mensaje de error le tiene que ofrecer "Complementos" entre las válidas'
  );
});

test('crear: sin categoría sigue cayendo en "Otros"', async () => {
  const req = { body: { nombre: 'Cables HDMI', costo: '3500' } };
  const res = fakeRes();

  await conMongoFalsoAlCrear(() => addActivo(req, res));

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.categoria, 'Otros');
});

// ─── EDITAR UN ACTIVO (PUT /api/activos-sala/:id) ────────────────────────────

test('editar: se le puede cambiar la categoría a "Complementos"', async () => {
  const actual = activoGuardado(); // estaba en "Otros"
  const req = { params: { id: actual._id }, body: { categoria: NUEVA } };
  const res = fakeRes();

  const escrito = await conMongoFalsoAlEditar(actual, () => updateActivo(req, res));

  assert.equal(res.statusCode, 200, `esperaba 200 y respondió ${res.statusCode}: ${res.body?.message}`);
  assert.equal(escrito.$set.categoria, NUEVA, 'la categoría nueva tiene que llegar al $set');
  assert.equal(res.body.data.categoria, NUEVA, 'y volver en la respuesta');
});

test('editar: cambiar nombre y categoría a la vez no pisa lo demás', async () => {
  const actual = activoGuardado();
  const req = {
    params: { id: actual._id },
    body: { nombre: 'Mapas COD: Black Ops', categoria: NUEVA, costo: '15000' },
  };
  const res = fakeRes();

  const escrito = await conMongoFalsoAlEditar(actual, () => updateActivo(req, res));

  assert.equal(res.statusCode, 200);
  assert.equal(escrito.$set.categoria, NUEVA);
  assert.equal(escrito.$set.nombre, 'Mapas COD: Black Ops');
  assert.equal(escrito.$set.costo, 15000, 'el costo viaja como número');
  assert.equal(escrito.$set.numeroPlaca, undefined, 'la placa nunca se toca al editar');
});

test('editar: una categoría que no existe se rechaza con 400', async () => {
  const actual = activoGuardado();
  const req = { params: { id: actual._id }, body: { categoria: INVENTADA } };
  const res = fakeRes();

  const escrito = await conMongoFalsoAlEditar(actual, () => updateActivo(req, res));

  assert.equal(res.statusCode, 400, 'una categoría inventada tampoco se puede guardar editando');
  assert.match(res.body.message, /Categoría inválida/);
  assert.ok(res.body.message.includes(NUEVA), 'el mensaje le ofrece "Complementos" entre las válidas');
  assert.equal(escrito.$set, undefined, 'no se debe haber intentado escribir nada');
});

test('editar: los validadores del update también aceptan "Complementos"', async () => {
  // findByIdAndUpdate va con runValidators: true; esto prueba esa red aparte
  // de la guarda del controlador.
  await ActivoSala.validate({ categoria: NUEVA }, ['categoria']);
  await assert.rejects(
    () => ActivoSala.validate({ categoria: INVENTADA }, ['categoria']),
    /Categoría inválida/
  );
});

// ─── QUE EL FORMULARIO OFREZCA LO MISMO ──────────────────────────────────────

const aquí = path.dirname(fileURLToPath(import.meta.url));
const RUTA_PANEL = path.resolve(aquí, '../../sala-juegos-frontend-vite/src/components/admin/ActivosPanel.jsx');

// Las listas del frontend viven dentro del componente (no son un módulo que se
// pueda importar desde Node, es JSX), así que se leen del archivo.
const leerPanel = () => {
  assert.ok(
    fs.existsSync(RUTA_PANEL),
    `No encontré el panel del frontend en:\n  ${RUTA_PANEL}\nSi moviste la carpeta, actualizá RUTA_PANEL en este script.`
  );
  return fs.readFileSync(RUTA_PANEL, 'utf8');
};

const bloque = (fuente, declaracion, cierre) => {
  const inicio = fuente.indexOf(declaracion);
  assert.notEqual(inicio, -1, `No encontré "${declaracion}" en ActivosPanel.jsx`);
  const fin = fuente.indexOf(cierre, inicio);
  assert.notEqual(fin, -1, `No encontré el cierre de "${declaracion}" en ActivosPanel.jsx`);
  return fuente.slice(inicio + declaracion.length, fin);
};

test('el formulario ofrece exactamente las categorías que el backend acepta', () => {
  const fuente = leerPanel();
  const lista = bloque(fuente, 'const CATEGORIAS = [', '];');
  const delFrontend = [...lista.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  const soloFrontend = delFrontend.filter((c) => !CATEGORIAS_ACTIVO.includes(c));
  const soloBackend = CATEGORIAS_ACTIVO.filter((c) => !delFrontend.includes(c));

  assert.deepEqual(
    soloFrontend,
    [],
    `El formulario ofrece categorías que el backend RECHAZA (elegirlas revienta el guardado con 400): ${soloFrontend.join(', ')}`
  );
  assert.deepEqual(
    soloBackend,
    [],
    `El backend acepta categorías que el formulario no ofrece (nadie puede elegirlas): ${soloBackend.join(', ')}`
  );
});

test('cada categoría tiene su ícono en el panel', () => {
  const fuente = leerPanel();
  const lista = bloque(fuente, 'const CATEGORIA_ICONO = {', '};');
  // Las llaves van con comillas ("Control PS4":) o sin ellas (Otros:).
  const conIcono = [...lista.matchAll(/(?:"([^"]+)"|([A-Za-zÁÉÍÓÚáéíóúÑñ]+))\s*:/g)]
    .map((m) => m[1] || m[2]);

  const sinIcono = CATEGORIAS_ACTIVO.filter((c) => !conIcono.includes(c));
  assert.deepEqual(sinIcono, [], `Estas categorías saldrían con el ícono genérico 📦: ${sinIcono.join(', ')}`);
});
