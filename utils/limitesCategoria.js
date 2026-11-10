// utils/limitesCategoria.js
// Finanzas Personales — "Lo que solés gastar" en cada categoría.
//
// Cada usuario tiene un límite por categoría de gasto. Por defecto es su
// PROMEDIO de los últimos 3 meses cerrados (los anteriores al consultado que
// tienen datos); si tiene menos meses usa los que haya, y sin ninguno la
// categoría queda sin límite. El usuario puede ponerle uno PROPIO, que manda
// sobre el promedio hasta que lo quite.
//
// Acá solo hay funciones puras (sin base de datos) para poder probarlas con
// node --test. El controlador lee los snapshots y los límites guardados y se
// los pasa.
//
// Qué NO cuenta como gasto de una categoría:
//   • lo apartado al ahorro (no es consumo)
//   • los préstamos dados (es plata que vuelve)
//   • lo pagado CON el ahorro (va en desgloseGastoAhorro, no en desgloseEgreso)
// Los gastos FIJOS (alquiler, internet, cuotas… si de verdad no varían, ver
// esEstable) se devuelven con su promedio pero sin límite: no se recortan de
// un día para otro.

export const MESES_BASE = 3;

// Un gasto "fijo" por nombre (alquiler, internet, suscripciones…) solo se trata
// como fijo si de verdad costó casi lo mismo en los meses de la base: todos con
// gasto y la diferencia entre el más caro y el más barato hasta este porcentaje
// del más caro. Si varía (ej. suscripciones: ₡4.130, ₡21.566, ₡12.840) se
// comporta como cualquier otra categoría, con su promedio y su límite. Con
// menos de 2 meses no hay cómo saberlo y se respeta el nombre.
export const VARIACION_FIJO = 0.1;

export const esEstable = (totales) => {
  if (totales.length < 2) return true;
  if (totales.some((t) => t <= 0)) return false;
  const max = Math.max(...totales);
  return max - Math.min(...totales) <= max * VARIACION_FIJO;
};

// Suma por categoría un desglose [{ categoria, total }] dejando afuera lo que
// no es consumo.
export const gastoPorCategoria = (desglose, { esAhorro, esPrestamo }) => {
  const out = new Map();
  for (const it of desglose || []) {
    if (!it?.categoria || esAhorro(it.categoria) || esPrestamo(it.categoria)) continue;
    out.set(it.categoria, (out.get(it.categoria) || 0) + (Number(it.total) || 0));
  }
  return out;
};

// Qué parte del mes ya pasó (0 a 1), en hora de Costa Rica. Un mes pasado
// cuenta como completo y uno futuro como 0.
export const avanceDelMes = (mes, anio, ahora = new Date()) => {
  const cr = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }));
  const hoy = cr.getFullYear() * 12 + cr.getMonth() + 1;
  const consultado = anio * 12 + mes;
  if (consultado < hoy) return 1;
  if (consultado > hoy) return 0;
  const diasMes = new Date(anio, mes, 0).getDate();
  return Math.round((cr.getDate() / diasMes) * 1000) / 1000;
};

// Arma la lista de límites del mes.
//   previos: snapshots de meses ANTERIORES al consultado ({ anio, mes, desgloseEgreso }),
//            en cualquier orden; se usan los MESES_BASE más recientes.
//   delMes:  snapshot del mes consultado (o null).
//   propios: Map categoria → monto que el usuario fijó.
//   reglas:  { esAhorro, esPrestamo, esFijo }
export const calcularLimites = ({ previos = [], delMes = null, propios = new Map(), reglas }) => {
  const base = [...previos]
    .sort((a, b) => (b.anio * 12 + b.mes) - (a.anio * 12 + a.mes))
    .slice(0, MESES_BASE);
  const porMes = base.map((s) => ({ anio: s.anio, mes: s.mes, gastos: gastoPorCategoria(s.desgloseEgreso, reglas) }));
  const gastadoMes = gastoPorCategoria(delMes?.desgloseEgreso, reglas);

  const nombres = new Set([...gastadoMes.keys(), ...propios.keys()]);
  porMes.forEach((m) => m.gastos.forEach((_, c) => nombres.add(c)));

  const categorias = [];
  for (const categoria of nombres) {
    if (reglas.esAhorro(categoria) || reglas.esPrestamo(categoria)) continue;
    // Un mes de la base sin gasto en la categoría cuenta como ₡0: el promedio
    // es "lo que se gasta por mes", no "lo que se gasta los meses que se gasta".
    const historial = porMes.map((m) => ({ anio: m.anio, mes: m.mes, total: m.gastos.get(categoria) || 0 }));
    // Fijo = fijo por nombre, estable en la base y sin un límite propio (si el
    // usuario le puso uno, quiere controlarlo como cualquier otra).
    const fijo = reglas.esFijo(categoria) && esEstable(historial.map((h) => h.total)) && !propios.has(categoria);
    const promedio = porMes.length
      ? Math.round(historial.reduce((s, h) => s + h.total, 0) / porMes.length)
      : 0;
    const propio = fijo ? null : (propios.get(categoria) ?? null);
    const limite = fijo ? null : (propio ?? (promedio > 0 ? promedio : null));
    const gastado = gastadoMes.get(categoria) || 0;
    // Una categoría sin gasto este mes y sin límite no aporta nada a la pantalla.
    if (gastado === 0 && limite == null && !fijo) continue;
    if (fijo && gastado === 0 && promedio === 0) continue;
    categorias.push({ categoria, fijo, gastado, promedio, propio, limite, historial });
  }

  categorias.sort((a, b) => b.gastado - a.gastado || (b.limite || 0) - (a.limite || 0));
  return { mesesBase: porMes.map(({ anio, mes }) => ({ anio, mes })), categorias };
};
