// scripts/probarLimitesCategoria.js
// Pruebas de "lo que solés gastar" por categoría (utils/limitesCategoria.js).
// Correr: node --test scripts/probarLimitesCategoria.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularLimites, avanceDelMes, gastoPorCategoria } from '../utils/limitesCategoria.js';

const reglas = {
  esAhorro: (c) => c.startsWith('Ahorro'),
  esPrestamo: (c) => c === 'Préstamo dado',
  esFijo: (c) => ['Internet/Celular', 'Vivienda/Alquiler', 'Mis deudas y cuotas'].includes(c),
};
const snap = (anio, mes, pares) => ({ anio, mes, desgloseEgreso: pares.map(([categoria, total]) => ({ categoria, total })) });
const buscar = (r, c) => r.categorias.find((x) => x.categoria === c);

test('promedio de los últimos 3 meses; un mes sin gasto cuenta como ₡0', () => {
  const r = calcularLimites({
    previos: [
      snap(2026, 7, [['Regalos', 999999]]), // el 4.º más viejo: no entra
      snap(2026, 8, [['Regalos', 12350], ['Ropa', 16750]]),
      snap(2026, 9, [['Regalos', 35000]]),
      snap(2026, 10, [['Regalos', 62025], ['Ropa', 14990]]),
    ],
    delMes: snap(2026, 11, [['Regalos', 25550]]),
    reglas,
  });
  assert.deepEqual(r.mesesBase, [{ anio: 2026, mes: 10 }, { anio: 2026, mes: 9 }, { anio: 2026, mes: 8 }]);
  const regalos = buscar(r, 'Regalos');
  assert.equal(regalos.promedio, 36458);
  assert.equal(regalos.limite, 36458);
  assert.equal(regalos.gastado, 25550);
  assert.equal(buscar(r, 'Ropa').promedio, Math.round((16750 + 0 + 14990) / 3));
});

test('el límite propio manda sobre el promedio', () => {
  const r = calcularLimites({
    previos: [snap(2026, 10, [['Regalos', 30000]])],
    delMes: snap(2026, 11, []),
    propios: new Map([['Regalos', 25000]]),
    reglas,
  });
  const regalos = buscar(r, 'Regalos');
  assert.equal(regalos.promedio, 30000);
  assert.equal(regalos.propio, 25000);
  assert.equal(regalos.limite, 25000);
});

test('con menos de 3 meses usa los que haya; sin ninguno, no hay límite', () => {
  const uno = calcularLimites({ previos: [snap(2026, 10, [['Súper', 40000]])], delMes: null, reglas });
  assert.equal(buscar(uno, 'Súper').limite, 40000);

  const nuevo = calcularLimites({ previos: [], delMes: snap(2026, 11, [['Súper', 5000]]), reglas });
  assert.deepEqual(nuevo.mesesBase, []);
  assert.equal(buscar(nuevo, 'Súper').limite, null);
  assert.equal(buscar(nuevo, 'Súper').gastado, 5000);
});

test('ahorro y préstamos no cuentan; los fijos van sin límite', () => {
  const r = calcularLimites({
    previos: [snap(2026, 10, [['Ahorro MEP', 400000], ['Préstamo dado', 50000], ['Internet/Celular', 22000]])],
    delMes: snap(2026, 11, [['Ahorro', 1500], ['Internet/Celular', 21614]]),
    propios: new Map([['Internet/Celular', 10000]]),
    reglas,
  });
  assert.equal(buscar(r, 'Ahorro MEP'), undefined);
  assert.equal(buscar(r, 'Ahorro'), undefined);
  assert.equal(buscar(r, 'Préstamo dado'), undefined);
  const internet = buscar(r, 'Internet/Celular');
  assert.equal(internet.fijo, true);
  assert.equal(internet.limite, null);
  assert.equal(internet.propio, null);
  assert.equal(internet.promedio, 22000);
});

test('una categoría sin gasto ni historia no aparece', () => {
  const r = calcularLimites({ previos: [snap(2026, 10, [])], delMes: snap(2026, 11, []), reglas });
  assert.equal(r.categorias.length, 0);
});

test('gastoPorCategoria suma repetidas', () => {
  const m = gastoPorCategoria([{ categoria: 'A', total: 100 }, { categoria: 'A', total: 50 }], reglas);
  assert.equal(m.get('A'), 150);
});

test('avance del mes en hora de Costa Rica', () => {
  // 9 nov 2026 a las 20:00 CR = 10 nov 02:00 UTC: sigue siendo el día 9.
  const ahora = new Date('2026-11-10T02:00:00Z');
  assert.equal(avanceDelMes(11, 2026, ahora), 0.3);
  assert.equal(avanceDelMes(10, 2026, ahora), 1);
  assert.equal(avanceDelMes(12, 2026, ahora), 0);
});
