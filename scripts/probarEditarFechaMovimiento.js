// scripts/probarEditarFechaMovimiento.js
//
// Editar un movimiento de Finanzas Personales NO le cambia la fecha.
//
// POR QUÉ EXISTE
// El formulario de edición manda mes/anio SIEMPRE, aunque no se haya tocado el
// mes. El backend armaba una fecha nueva con eso: en el mes actual quedaba con
// la fecha del momento de editar, y en un mes pasado con el día 1. Editar el
// monto de una compra del 4 de octubre el 20 la pasaba al 20. Importa sobre
// todo para los gastos que entran solos desde el correo del BCR, que traen la
// fecha exacta de la compra.
//
// El controlador corre de verdad sobre una base falsa en memoria: no toca Mongo.
//
// Corre con `npm run probar-editar-fecha`.

import test from 'node:test';
import assert from 'node:assert/strict';

import MovimientoPersonal from '../models/MovimientoPersonal.js';
import ResumenPersonalMes from '../models/ResumenPersonalMes.js';
import { updateMovimiento } from '../controllers/finanzasPersonalesController.js';

console.error = () => {};

const USUARIO = '64b000000000000000000001';
const ID = '64b0000000000000000000aa';

// Mes y año de hoy en Costa Rica, y un mes que ya pasó.
const hoyCR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }));
const MES_ACTUAL = { mes: hoyCR.getMonth() + 1, anio: hoyCR.getFullYear() };
const MES_PASADO = MES_ACTUAL.mes === 1
  ? { mes: 12, anio: MES_ACTUAL.anio - 1 }
  : { mes: MES_ACTUAL.mes - 1, anio: MES_ACTUAL.anio };

// Día 4 del mes dado a las 12:45 hora CR: nunca coincide con "ahora" ni con el día 1.
const dia4 = ({ mes, anio }) =>
  new Date(`${anio}-${String(mes).padStart(2, '0')}-04T12:45:12-06:00`);

let guardado; // el movimiento en la "base"
let $setRecibido;

MovimientoPersonal.findOne = async () => guardado;
MovimientoPersonal.findByIdAndUpdate = async (_id, { $set }) => {
  $setRecibido = $set;
  guardado = { ...guardado, ...$set };
  return guardado;
};
MovimientoPersonal.aggregate = async () => [];
ResumenPersonalMes.deleteOne = async () => ({});

const editar = async (body) => {
  const req = { params: { id: ID }, user: { id: USUARIO }, body };
  const res = {
    statusCode: null,
    status(c) { this.statusCode = c; return this; },
    json() { return this; },
  };
  await updateMovimiento(req, res);
  return res;
};

const gasto = (fecha) => ({
  _id: ID,
  usuario: USUARIO,
  tipo: 'egreso',
  categoria: 'Otros',
  fondo: 'mes',
  monto: 11900,
  fecha,
});

test('editar un gasto del mes actual conserva su fecha', async () => {
  const fecha = dia4(MES_ACTUAL);
  guardado = gasto(fecha);
  const res = await editar({ tipo: 'egreso', categoria: 'Comida preparada', monto: 12000, fondo: 'mes', ...MES_ACTUAL });
  assert.equal(res.statusCode, 200);
  assert.equal('fecha' in $setRecibido, false);
  assert.equal(guardado.fecha.getTime(), fecha.getTime());
});

test('editar un gasto de un mes pasado conserva su fecha (no lo pasa al día 1)', async () => {
  const fecha = dia4(MES_PASADO);
  guardado = gasto(fecha);
  const res = await editar({ tipo: 'egreso', categoria: 'Comida preparada', monto: 12000, fondo: 'mes', ...MES_PASADO });
  assert.equal(res.statusCode, 200);
  assert.equal(guardado.fecha.getTime(), fecha.getTime());
});

test('moverlo a OTRO mes sí le cambia la fecha', async () => {
  guardado = gasto(dia4(MES_ACTUAL));
  const res = await editar({ tipo: 'egreso', categoria: 'Otros', monto: 11900, fondo: 'mes', ...MES_PASADO });
  assert.equal(res.statusCode, 200);
  assert.ok($setRecibido.fecha);
  const cr = new Date(guardado.fecha.toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }));
  assert.equal(cr.getMonth() + 1, MES_PASADO.mes);
});

test('un mes futuro se sigue rechazando', async () => {
  guardado = gasto(dia4(MES_ACTUAL));
  const futuro = MES_ACTUAL.mes === 12
    ? { mes: 1, anio: MES_ACTUAL.anio + 1 }
    : { mes: MES_ACTUAL.mes + 1, anio: MES_ACTUAL.anio };
  const res = await editar({ tipo: 'egreso', categoria: 'Otros', monto: 11900, fondo: 'mes', ...futuro });
  assert.equal(res.statusCode, 400);
});
