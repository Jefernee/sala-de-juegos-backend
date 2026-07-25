// controllers/finanzasPersonalesController.js
// Finanzas Personales (SOLO administrador). Módulo APARTE de la sala de juegos:
// no lee ni escribe nada del negocio. Solo maneja los ingresos y gastos
// personales que el administrador registra a mano, filtrados por su usuario.
import mongoose from 'mongoose';
import MovimientoPersonal, {
  TIPOS_MOVIMIENTO,
  CATEGORIAS_INGRESO,
  CATEGORIAS_EGRESO,
  CATEGORIAS_DEUDA,
  CATEGORIAS_AHORRO,
  MONEDAS,
  categoriasPorTipo,
  esAhorro,
  esGastoFijo,
  esDeBatan,
} from '../models/MovimientoPersonal.js';
import { crearFiltroMes, crearFechaParaMes } from '../utils/dateUtils.js';

// Caché en memoria del tipo de cambio (una llamada a Hacienda por día).
// `cacheTC` guarda el último valor bueno conocido; `cacheDiaTC` es el día CR
// (YYYY-MM-DD) en que se obtuvo con éxito. Se mantiene entre requests mientras
// el proceso viva; si el proceso reinicia, se vuelve a consultar.
let cacheTC = null;      // { fecha, venta, compra }
let cacheDiaTC = null;   // 'YYYY-MM-DD'

const HACIENDA_TC_URL = 'https://api.hacienda.go.cr/indicadores/tc/dolar';

// Día actual en Costa Rica como 'YYYY-MM-DD' (en-CA ya da ese formato).
const hoyCostaRica = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Costa_Rica',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

// Resuelve la fecha a guardar según el mes/año elegido en el frontend.
// El frontend NUNCA envía fechas, solo mes y anio (opcionales): si no vienen,
// el registro queda en el mes actual con la fecha de ahora.
// Retorna: { fecha: Date } | { fecha: undefined } (no vinieron) | { error }
const resolverFechaDelMes = (mesRaw, anioRaw) => {
  if (mesRaw === undefined && anioRaw === undefined) return { fecha: undefined };

  const mes = parseInt(mesRaw);
  const anio = parseInt(anioRaw);

  if (!mes || !anio || mes < 1 || mes > 12 || anio < 2000 || anio > 2100) {
    return { error: 'mes (1-12) y anio deben enviarse juntos y ser válidos' };
  }

  const fecha = crearFechaParaMes(mes, anio);
  if (!fecha) {
    return { error: 'No se pueden registrar movimientos en meses futuros' };
  }

  return { fecha };
};

// Valida tipo + categoria juntos (la categoría depende del tipo).
// Retorna { error } o { tipo, categoria } normalizados.
const validarTipoCategoria = (tipoRaw, categoriaRaw) => {
  const tipo = String(tipoRaw || '').trim().toLowerCase();
  if (!TIPOS_MOVIMIENTO.includes(tipo)) {
    return { error: 'El tipo es obligatorio y debe ser "ingreso" o "egreso"' };
  }

  // Normalizamos a NFC para que los acentos comparen bien: el frontend puede
  // mandar la misma letra acentuada en forma descompuesta (NFD) y se vería
  // idéntica pero no coincidiría con la lista. Guardamos también en NFC.
  const categoria = String(categoriaRaw || '').trim().normalize('NFC');
  const validas = categoriasPorTipo(tipo);
  const match = validas.find((c) => c.normalize('NFC') === categoria);
  if (!match) {
    return {
      error: `Categoría inválida para ${tipo}. Válidas: ${validas.join(', ')}`,
    };
  }

  // Devolvemos el valor canónico de la lista (ortografía/acentos oficiales).
  return { tipo, categoria: match };
};

// Normaliza monto + moneda. El valor canónico SIEMPRE es `monto` en colones.
//   • CRC (o sin moneda): `monto` es el valor en colones; montoOriginal = monto,
//     tipoCambio = null.
//   • USD: requiere montoOriginal y tipoCambio (> 0). El monto en colones se
//     RECALCULA como round(montoOriginal * tipoCambio) para garantizar que el
//     canónico siempre sea consistente con el origen (aunque el frontend ya lo
//     mande convertido).
// Retorna { error } o { monto, moneda, montoOriginal, tipoCambio }.
const normalizarMonto = ({ moneda, monto, montoOriginal, tipoCambio }) => {
  const mon = String(moneda || 'CRC').trim().toUpperCase();
  if (!MONEDAS.includes(mon)) {
    return { error: 'moneda inválida (usar "CRC" o "USD")' };
  }

  if (mon === 'USD') {
    const orig = Number(montoOriginal);
    const tc = Number(tipoCambio);
    if (montoOriginal === undefined || montoOriginal === null || isNaN(orig) || orig <= 0) {
      return { error: 'Para pagos en USD, montoOriginal (dólares) debe ser un número mayor a 0' };
    }
    if (tipoCambio === undefined || tipoCambio === null || isNaN(tc) || tc <= 0) {
      return { error: 'Para pagos en USD, tipoCambio (colones por US$1) debe ser un número mayor a 0' };
    }
    return { moneda: 'USD', montoOriginal: orig, tipoCambio: tc, monto: Math.round(orig * tc) };
  }

  // CRC
  const col = Number(monto);
  if (monto === undefined || monto === null || isNaN(col) || col <= 0) {
    return { error: 'El monto (colones) debe ser un número mayor a 0' };
  }
  return { moneda: 'CRC', montoOriginal: col, tipoCambio: null, monto: col };
};

// ============================================
// GET /api/finanzas-personales/categorias
// Devuelve las listas de categorías para poblar los selects del frontend.
// ============================================
export const getCategorias = async (_req, res) => {
  res.status(200).json({
    tipos: TIPOS_MOVIMIENTO,
    categorias: {
      ingreso: CATEGORIAS_INGRESO,
      egreso: CATEGORIAS_EGRESO,
    },
  });
};

// ============================================
// POST /api/finanzas-personales — Registrar movimiento (ingreso o egreso)
// Body: { tipo, categoria, monto, descripcion?, mes?, anio? }
// La fecha la asigna el backend; el usuario sale del token.
// ============================================
export const addMovimiento = async (req, res) => {
  try {
    const { tipo, categoria, error } = validarTipoCategoria(req.body.tipo, req.body.categoria);
    if (error) return res.status(400).json({ message: error });

    const dinero = normalizarMonto({
      moneda: req.body.moneda,
      monto: req.body.monto,
      montoOriginal: req.body.montoOriginal,
      tipoCambio: req.body.tipoCambio,
    });
    if (dinero.error) return res.status(400).json({ message: dinero.error });

    const resultadoFecha = resolverFechaDelMes(req.body.mes, req.body.anio);
    if (resultadoFecha.error) {
      return res.status(400).json({ message: resultadoFecha.error });
    }

    const movimiento = await MovimientoPersonal.create({
      usuario: req.user.id,
      tipo,
      categoria,
      monto: dinero.monto,
      moneda: dinero.moneda,
      montoOriginal: dinero.montoOriginal,
      tipoCambio: dinero.tipoCambio,
      descripcion: req.body.descripcion?.trim() || null,
      ...(resultadoFecha.fecha && { fecha: resultadoFecha.fecha }),
    });

    res.status(201).json({ message: 'Movimiento registrado', data: movimiento });
  } catch (error) {
    console.error('❌ Error al registrar movimiento personal:', error);
    res.status(500).json({ message: 'Error al registrar el movimiento', error: error.message });
  }
};

// ============================================
// GET /api/finanzas-personales?mes=&anio=[&tipo=&page=&limit=]
// Lista los movimientos del usuario en ese mes (opcional filtrar por tipo).
// ============================================
export const getMovimientos = async (req, res) => {
  try {
    const mes = parseInt(req.query.mes);
    const anio = parseInt(req.query.anio);

    if (!mes || !anio || mes < 1 || mes > 12 || anio < 2000 || anio > 2100) {
      return res.status(400).json({
        message: 'Los parámetros mes (1-12) y anio son obligatorios. Ej: ?mes=7&anio=2026',
      });
    }

    const filtro = {
      usuario: req.user.id,
      fecha: crearFiltroMes(mes, anio),
    };

    // Filtro opcional por tipo
    if (req.query.tipo !== undefined) {
      const tipo = String(req.query.tipo).trim().toLowerCase();
      if (!TIPOS_MOVIMIENTO.includes(tipo)) {
        return res.status(400).json({ message: 'tipo inválido (usar "ingreso" o "egreso")' });
      }
      filtro.tipo = tipo;
    }

    // Paginación opcional
    const page = parseInt(req.query.page) || null;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    let consulta = MovimientoPersonal.find(filtro).sort({ fecha: -1 });
    if (page) {
      consulta = consulta.skip((page - 1) * limit).limit(limit);
    }

    const [data, totalRegistros] = await Promise.all([
      consulta.lean(),
      MovimientoPersonal.countDocuments(filtro),
    ]);

    const respuesta = { data };

    if (page) {
      const totalPages = Math.ceil(totalRegistros / limit);
      respuesta.pagination = {
        currentPage: page,
        totalPages,
        totalItems: totalRegistros,
        itemsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      };
    }

    res.status(200).json(respuesta);
  } catch (error) {
    console.error('❌ Error al obtener movimientos personales:', error);
    res.status(500).json({ message: 'Error al obtener los movimientos', error: error.message });
  }
};

// ============================================
// GET /api/finanzas-personales/resumen?mes=&anio=
// "Estado de resultados personal" del mes: total ingresos, total egresos,
// balance (ingresos - egresos) y el desglose por categoría de cada uno.
// Se calcula EN VIVO desde los movimientos del propio usuario (no snapshot):
// esos movimientos son la única fuente, así que no hay nada que sobreviva a
// su borrado. Agregación en Mongo (no carga toda la colección a memoria).
// ============================================
// Calcula los totales del mes de un usuario: total ingresos, total egresos,
// balance y desglose por categoría (ordenado de mayor a menor). Se usa tanto
// para el resumen como para las recomendaciones (mes actual y mes anterior).
const calcularResumenMes = async (usuarioId, mes, anio) => {
  const match = {
    usuario: new mongoose.Types.ObjectId(usuarioId),
    fecha: crearFiltroMes(mes, anio),
  };

  const grupos = await MovimientoPersonal.aggregate([
    { $match: match },
    {
      $group: {
        _id: { tipo: '$tipo', categoria: '$categoria' },
        total: { $sum: '$monto' },
        cantidad: { $sum: 1 },
      },
    },
    { $sort: { total: -1 } },
  ]);

  const desglose = { ingreso: [], egreso: [] };
  let totalIngresos = 0;
  let totalEgresos = 0;

  for (const g of grupos) {
    const fila = { categoria: g._id.categoria, total: g.total, cantidad: g.cantidad };
    if (g._id.tipo === 'ingreso') {
      desglose.ingreso.push(fila);
      totalIngresos += g.total;
    } else {
      desglose.egreso.push(fila);
      totalEgresos += g.total;
    }
  }

  return {
    totalIngresos,
    totalEgresos,
    balance: totalIngresos - totalEgresos,
    desglose, // { ingreso: [{categoria,total,cantidad}], egreso: [...] }
  };
};

// Suma el ahorro del mes a partir del desglose (todas las categorías de ahorro:
// Ahorro, Ahorro CreAI, Ahorro MEP). El ahorro vive dentro de `totalEgresos`,
// pero lo separamos para mostrarlo aparte y no tratarlo como gasto de consumo.
const calcularAhorro = (desglose) =>
  desglose.egreso.filter((e) => esAhorro(e.categoria)).reduce((s, e) => s + e.total, 0);

// ============================================
// Saldo Inicial del Mes (NO se almacena en la base de datos).
//
// Se deriva EN VIVO como el "saldo final" acumulado de TODOS los meses
// anteriores. Matemáticamente, si SaldoFinal[m] = SaldoInicial[m] + Ingresos[m]
// - Egresos[m] y SaldoInicial[m] = SaldoFinal[m-1], al desplegar la recursión
// queda que el saldo inicial de un mes es simplemente el neto (ingresos -
// egresos) de todos los movimientos con fecha ANTERIOR al día 1 de ese mes.
//
// Ventajas de calcularlo así (una sola agregación, sin guardar nada):
//   • Si se edita/borra/agrega cualquier movimiento de un mes previo, el saldo
//     inicial del mes siguiente se recalcula solo en la próxima consulta.
//   • Si no hay ningún movimiento anterior, la suma es 0 (primer mes → ₡0).
// El ahorro está incluido en los egresos, así que resta del saldo acumulado
// (es dinero apartado que ya no está disponible), acorde con la fórmula pedida.
// ============================================
const calcularSaldoInicial = async (usuarioId, mes, anio) => {
  // Día 1 del mes a medianoche de Costa Rica (06:00 UTC): mismo borde que usa
  // crearFiltroMes como inicio, para que "antes de este mes" no deje huecos.
  const inicioMes = new Date(Date.UTC(anio, mes - 1, 1, 6, 0, 0, 0));

  const grupos = await MovimientoPersonal.aggregate([
    { $match: { usuario: new mongoose.Types.ObjectId(usuarioId), fecha: { $lt: inicioMes } } },
    { $group: { _id: '$tipo', total: { $sum: '$monto' } } },
  ]);

  let ingresos = 0;
  let egresos = 0;
  for (const g of grupos) {
    if (g._id === 'ingreso') ingresos = g.total;
    else egresos = g.total;
  }

  return ingresos - egresos; // puede ser negativo si se arrastra un déficit
};

// ============================================
// Gasto de consumo PROMEDIO por mes (sin ahorro) de los meses ANTERIORES al
// consultado. Con esto los mensajes pueden decir algo que no está en pantalla:
// cuántos meses aguantaría el saldo disponible si se cayeran los ingresos.
// Se promedia solo entre los meses que SÍ tuvieron gastos (si hay un mes vacío
// no diluye el promedio). Devuelve null si no hay historial previo.
// ============================================
const calcularGastoPromedioMensual = async (usuarioId, mes, anio, meses = 3) => {
  const fin = new Date(Date.UTC(anio, mes - 1, 1, 6, 0, 0, 0));        // día 1 del mes consultado
  const inicio = new Date(Date.UTC(anio, mes - 1 - meses, 1, 6, 0, 0, 0)); // N meses atrás

  const grupos = await MovimientoPersonal.aggregate([
    {
      $match: {
        usuario: new mongoose.Types.ObjectId(usuarioId),
        tipo: 'egreso',
        categoria: { $nin: CATEGORIAS_AHORRO },
        fecha: { $gte: inicio, $lt: fin },
      },
    },
    {
      // Agrupamos por mes en hora de Costa Rica (no UTC) para que un gasto de
      // la noche del último día no se cuente en el mes siguiente.
      $group: {
        _id: { $dateToString: { date: '$fecha', format: '%Y-%m', timezone: 'America/Costa_Rica' } },
        total: { $sum: '$monto' },
      },
    },
  ]);

  if (grupos.length === 0) return null;
  const total = grupos.reduce((s, g) => s + g.total, 0);
  return Math.round(total / grupos.length);
};

// A partir del resumen crudo del mes (calcularResumenMes) y su saldo inicial,
// arma el bloque financiero que consume el frontend. El saldo inicial se suma a
// TODOS los cálculos del mes (es dinero disponible del mes anterior), pero NO
// se cuenta como ingreso: `totalIngresos` y `desglose.ingreso` quedan intactos.
//   Disponible  = SaldoInicial + Ingresos
//   SaldoFinal  = SaldoInicial + Ingresos - Gastos - Ahorro (= Disponible - Egresos)
//   Balance     = SaldoFinal (dinero restante al cerrar el mes, ya con el saldo inicial)
const componerFinanzasMes = (resumen, saldoInicial) => {
  const { totalIngresos, totalEgresos, desglose } = resumen;
  const totalAhorro = calcularAhorro(desglose);
  const totalGastos = totalEgresos - totalAhorro; // egresos SIN ahorro (gasto de consumo)
  const disponible = saldoInicial + totalIngresos;
  const saldoFinal = disponible - totalGastos - totalAhorro; // = saldoInicial + ingresos - egresos

  return {
    saldoInicial,   // dinero traído del mes anterior (NO es ingreso)
    totalIngresos,  // ingresos propios del mes (sin saldo inicial)
    disponible,     // saldoInicial + ingresos
    totalGastos,    // egresos sin ahorro
    totalAhorro,    // suma de categorías de ahorro
    totalEgresos,   // gastos + ahorro (compat con lo anterior)
    saldoFinal,     // saldo con el que se cierra el mes
    balance: saldoFinal, // el "Balance del mes" ahora usa el saldo inicial
    desglose,
  };
};

export const getResumenMensual = async (req, res) => {
  try {
    const mes = parseInt(req.query.mes);
    const anio = parseInt(req.query.anio);

    if (!mes || !anio || mes < 1 || mes > 12 || anio < 2000 || anio > 2100) {
      return res.status(400).json({
        message: 'Los parámetros mes (1-12) y anio son obligatorios. Ej: ?mes=7&anio=2026',
      });
    }

    const [resumen, saldoInicial] = await Promise.all([
      calcularResumenMes(req.user.id, mes, anio),
      calcularSaldoInicial(req.user.id, mes, anio),
    ]);
    res.status(200).json({ mes, anio, ...componerFinanzasMes(resumen, saldoInicial) });
  } catch (error) {
    console.error('❌ Error al generar el resumen personal:', error);
    res.status(500).json({ message: 'Error al generar el resumen', error: error.message });
  }
};

// Formatea un monto como colones para los mensajes (ej. "₡50.000"), con punto
// de miles. Manual para no depender del locale/ICU del entorno.
const fmtCRC = (n) => {
  const r = Math.round(n);
  const s = Math.abs(r).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (r < 0 ? '-₡' : '₡') + s;
};

const NOMBRES_MES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre',
];

// Días del mes consultado y, si es el mes EN CURSO en Costa Rica, cuántos días
// van corridos. Sirve para proyectar el cierre de un mes que todavía no acaba
// (comparar un mes a medias contra uno completo daría avisos falsos).
const infoDelMes = (mes, anio) => {
  const [anioHoy, mesHoy, diaHoy] = hoyCostaRica().split('-').map(Number);
  const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate(); // día 0 del mes siguiente
  const esMesEnCurso = anioHoy === anio && mesHoy === mes;
  return {
    diasDelMes,
    esMesEnCurso,
    diasTranscurridos: esMesEnCurso ? diaHoy : diasDelMes,
  };
};

// Suma los totales de las filas cuya categoría cumple el predicado.
const sumarSi = (filas, predicado) =>
  filas.filter((f) => predicado(f.categoria)).reduce((s, f) => s + f.total, 0);

// "Comida ₡41.775, Transporte ₡12.000" (de mayor a menor)
const listarFilas = (filas) =>
  filas
    .slice()
    .sort((a, b) => b.total - a.total)
    .map((f) => `${f.categoria} ${fmtCRC(f.total)}`)
    .join(', ');

// Orden en que se muestran los mensajes: primero lo que hay que atender.
const PRIORIDAD_NIVEL = { critico: 0, advertencia: 1, consejo: 2, bien: 3, info: 4 };

// Pocos mensajes y que valgan: solo los 4 más importantes del mes. Se generan
// todos los avisos posibles, se ordenan por urgencia y se muestran los primeros.
const MAX_RECOMENDACIONES = 4;

// Cambios de al menos ₡5.000 en una categoría: menos que eso es ruido.
const UMBRAL_CAMBIO = 5000;

// ============================================
// Construye los mensajes inteligentes del mes. La idea NO es repetir los
// números que ya se ven en las tarjetas (ingresos, egresos, ahorro, saldo),
// sino decir lo que esos números NO muestran:
//   • alertas de flujo (¿el mes se pagó solo o se financió con el colchón?)
//   • proyección de cierre si el mes va a medias
//   • comparación contra el mes anterior, incluyendo QUÉ categoría cambió
//   • gastos nuevos que no existían el mes pasado
//   • estructura del gasto: fijos, deudas, concentración, Batán
//   • cuánto aguanta el saldo disponible si se caen los ingresos
// Cada mensaje trae `nivel` (para que el frontend lo pinte), `icono` y `mensaje`.
//   niveles: 'critico' | 'advertencia' | 'bien' | 'consejo' | 'info'
// ============================================
const construirRecomendaciones = ({ actual, previo, saldoInicial = 0, gastoPromedio = null, mes, anio }) => {
  const recs = [];
  const add = (nivel, icono, mensaje) => recs.push({ nivel, icono, mensaje });

  // --- Números del mes actual (el ahorro se separa: es dinero apartado, no gasto)
  const fin = componerFinanzasMes(actual, saldoInicial);
  const { totalIngresos, totalGastos, totalAhorro, totalEgresos, saldoFinal } = fin;
  const filasAhorro = actual.desglose.egreso.filter((e) => esAhorro(e.categoria));
  const filasGasto = actual.desglose.egreso.filter((e) => !esAhorro(e.categoria));

  // --- Números del mes anterior (para comparar)
  const filasGastoPrevio = (previo.desglose?.egreso || []).filter((e) => !esAhorro(e.categoria));
  const ahorroPrevio = calcularAhorro(previo.desglose || { egreso: [] });
  const gastoPrevio = previo.totalEgresos - ahorroPrevio;
  const ingresoPrevio = previo.totalIngresos;
  const hayMesPrevio = ingresoPrevio > 0 || previo.totalEgresos > 0;
  const nombrePrevio = NOMBRES_MES[(mes === 1 ? 12 : mes - 1) - 1];

  // Sin movimientos: no hay nada que analizar todavía.
  if (totalIngresos === 0 && totalEgresos === 0) {
    add('info', '📝', 'Todavía no registraste movimientos este mes. Anotá tus ingresos y gastos para ver los avisos.');
    return recs;
  }

  // ¿El mes consultado todavía va corriendo? Cambia cómo se redactan los
  // avisos (no se puede decir "cerraste" a mitad de mes) y habilita la proyección.
  const { diasDelMes, esMesEnCurso, diasTranscurridos } = infoDelMes(mes, anio);
  const mesAMedias = esMesEnCurso && diasTranscurridos < diasDelMes;

  // --- 0) Hueco arrastrado de meses anteriores
  if (saldoInicial < 0) {
    add('critico', '🕳️', `Arrancaste el mes debiendo ${fmtCRC(Math.abs(saldoInicial))}: venís arrastrando un hueco de meses anteriores. Mientras el saldo final no quede positivo, cada mes nuevo empieza en contra.`);
  }

  // --- 1) ¿El mes se pagó solo o se financió con el saldo acumulado?
  // `flujo` es lo que entró menos TODO lo que salió (gastos + ahorro), sin
  // contar el saldo inicial: mide si el mes se sostuvo por sí mismo.
  const flujo = totalIngresos - totalEgresos;
  if (totalIngresos === 0 && totalGastos > 0) {
    add('advertencia', '❓', `Registraste ${fmtCRC(totalGastos)} en gastos y ningún ingreso este mes. Si te falta anotar el salario, todos los porcentajes de abajo van a salir mal.`);
  } else if (totalGastos > totalIngresos) {
    add('critico', '🚨', `Alerta: los gastos del mes pasaron lo que entró por ${fmtCRC(totalGastos - totalIngresos)}. Ese hueco lo estás tapando con el saldo de meses anteriores, no con dinero nuevo.`);
  } else if (flujo < 0) {
    add('advertencia', '🏦', `Para apartar ${fmtCRC(totalAhorro)} de ahorro tuviste que sacar ${fmtCRC(Math.abs(flujo))} del saldo acumulado. Así el ahorro solo cambia de bolsillo: lo sano es que salga de lo que entra en el mes.`);
  } else if (totalIngresos > 0 && flujo < totalIngresos * 0.05) {
    add('advertencia', '😬', `${mesAMedias ? 'Vas al filo' : 'Cerraste al filo'}: de los ${fmtCRC(totalIngresos)} que entraron ${mesAMedias ? 'solo quedan' : 'solo sobraron'} ${fmtCRC(flujo)} libres después de gastos y ahorro. Un imprevisto te deja en rojo.`);
  } else if (flujo > 0) {
    add('bien', '✅', `${mesAMedias ? 'Por ahora el mes va sano' : 'Mes sano'}: lo que entró alcanzó para los gastos y el ahorro, y ${mesAMedias ? 'quedan' : 'todavía sobraron'} ${fmtCRC(flujo)} libres. Tu saldo pasó de ${fmtCRC(saldoInicial)} a ${fmtCRC(saldoFinal)}.`);
  }

  // --- 2) Proyección de cierre (solo si el mes va a medias y ya hay días suficientes)
  let proyeccionGastos = null;
  if (mesAMedias && diasTranscurridos >= 5 && totalGastos > 0) {
    const porDia = totalGastos / diasTranscurridos;
    proyeccionGastos = Math.round(porDia * diasDelMes);
    const faltan = diasDelMes - diasTranscurridos;
    if (totalIngresos > 0 && proyeccionGastos + totalAhorro > totalIngresos) {
      add('advertencia', '⏳', `Vas gastando ${fmtCRC(porDia)} por día: a ese ritmo el mes cierra en ${fmtCRC(proyeccionGastos)} de gastos y no alcanzaría con lo que entró. Te quedan ${faltan} días y ${fmtCRC(saldoFinal)} de saldo.`);
    } else {
      add('info', '⏳', `Vas gastando ${fmtCRC(porDia)} por día: a ese ritmo el mes cerraría cerca de ${fmtCRC(proyeccionGastos)} en gastos (faltan ${faltan} días).`);
    }
  }

  // --- 3) Ingresos vs mes anterior
  if (ingresoPrevio > 0 && totalIngresos > 0) {
    const dif = totalIngresos - ingresoPrevio;
    const pct = Math.round((Math.abs(dif) / ingresoPrevio) * 100);
    if (dif < 0 && pct >= 10) {
      add('advertencia', '📉', `Tus ingresos bajaron ${pct}% contra ${nombrePrevio} (${fmtCRC(totalIngresos)} vs ${fmtCRC(ingresoPrevio)}). Si no fue algo puntual, hay que bajar los gastos a este nuevo nivel.`);
    } else if (dif > 0 && pct >= 10) {
      add('consejo', '📈', `Tus ingresos subieron ${pct}% contra ${nombrePrevio} (${fmtCRC(dif)} más). El momento de subir el ahorro es ahora, antes de acostumbrarte al extra.`);
    }
  }

  // --- 4) Gasto total vs mes anterior (si el mes va a medias, compara la proyección)
  if (gastoPrevio > 0) {
    const base = proyeccionGastos ?? totalGastos;
    const dif = base - gastoPrevio;
    const pct = Math.round((Math.abs(dif) / gastoPrevio) * 100);
    if (pct >= 10) {
      const comoVa = proyeccionGastos ? 'Vas a cerrar gastando' : 'Gastaste';
      if (dif > 0) {
        add('advertencia', '⬆️', `${comoVa} ${pct}% más que en ${nombrePrevio}: ${fmtCRC(base)} vs ${fmtCRC(gastoPrevio)} (${fmtCRC(dif)} de más, sin contar ahorro).`);
      } else {
        add('bien', '⬇️', `${comoVa} ${pct}% menos que en ${nombrePrevio}: ${fmtCRC(base)} vs ${fmtCRC(gastoPrevio)}. Son ${fmtCRC(Math.abs(dif))} que no se fueron.`);
      }
    }
  }

  // --- 5) ¿QUÉ categoría cambió? (lo más útil de la comparación)
  const mapaPrevio = new Map(filasGastoPrevio.map((f) => [f.categoria, f.total]));
  const cambios = filasGasto.map((f) => ({
    categoria: f.categoria,
    antes: mapaPrevio.get(f.categoria) || 0,
    ahora: f.total,
  }));
  for (const [categoria, antes] of mapaPrevio) {
    if (!cambios.some((c) => c.categoria === categoria)) cambios.push({ categoria, antes, ahora: 0 });
  }
  for (const c of cambios) c.dif = c.ahora - c.antes;

  if (hayMesPrevio) {
    const subidas = cambios
      .filter((c) => c.antes > 0 && c.dif >= UMBRAL_CAMBIO)
      .sort((a, b) => b.dif - a.dif)
      .slice(0, 3);
    if (subidas.length > 0) {
      const detalle = subidas
        .map((c) => `${c.categoria} ${fmtCRC(c.dif)} más (${fmtCRC(c.antes)} → ${fmtCRC(c.ahora)})`)
        .join('; ');
      add('advertencia', '🔍', `Lo que más subió contra ${nombrePrevio}: ${detalle}. Ahí está el dinero que se fue de más.`);
    }

    const nuevas = cambios
      .filter((c) => c.antes === 0 && c.ahora >= UMBRAL_CAMBIO)
      .sort((a, b) => b.ahora - a.ahora)
      .slice(0, 3);
    if (nuevas.length > 0) {
      const detalle = nuevas.map((c) => `${c.categoria} ${fmtCRC(c.ahora)}`).join(', ');
      add('info', '🆕', `Gastos que no tenías en ${nombrePrevio}: ${detalle}. Revisá si son de una sola vez o si se van a repetir todos los meses.`);
    }

    const bajadas = cambios
      .filter((c) => c.dif <= -UMBRAL_CAMBIO)
      .sort((a, b) => a.dif - b.dif)
      .slice(0, 2);
    if (bajadas.length > 0 && subidas.length === 0) {
      const detalle = bajadas
        .map((c) => `${c.categoria} ${fmtCRC(Math.abs(c.dif))} menos`)
        .join(', ');
      add('bien', '👏', `Bajaste contra ${nombrePrevio} en: ${detalle}. Si lo mantenés, eso es ahorro fijo cada mes.`);
    }
  }

  // --- 6) Gastos fijos: la parte del ingreso que no podés mover
  const totalFijos = sumarSi(filasGasto, esGastoFijo);
  if (totalFijos > 0 && totalIngresos > 0) {
    const pct = Math.round((totalFijos / totalIngresos) * 100);
    if (pct >= 50) {
      add('advertencia', '🧱', `Tus gastos fijos (alquiler, servicios, internet, seguros, cuota del banco, suscripciones) se llevan el ${pct}% de lo que entra: ${fmtCRC(totalFijos)}. Arriba del 50% cualquier bajón de ingresos pega fuerte, porque esa plata no se puede recortar de un día para otro.`);
    } else if (pct >= 35) {
      add('info', '🧱', `Tenés ${fmtCRC(totalFijos)} comprometidos en gastos fijos, el ${pct}% de tus ingresos. Es manejable, pero es la parte que no baja rápido si algo se complica.`);
    }
  }

  // --- 7) Peso de las deudas SOBRE LOS INGRESOS (regla clásica: máx. 30%)
  const filasDeuda = filasGasto.filter((e) => CATEGORIAS_DEUDA.includes(e.categoria));
  const totalDeuda = filasDeuda.reduce((s, e) => s + e.total, 0);
  if (totalDeuda > 0 && totalIngresos > 0) {
    const pct = Math.round((totalDeuda / totalIngresos) * 100);
    const detalle = filasDeuda.length > 1 ? ` (${listarFilas(filasDeuda)})` : '';
    if (pct >= 30) {
      add('critico', '💳', `Las deudas se llevan el ${pct}% de tus ingresos: ${fmtCRC(totalDeuda)}${detalle}. Pasar del 30% es zona de riesgo: cualquier gasto extra vuelve a entrar como deuda. Priorizá abonar a la de interés más alto.`);
    } else if (pct >= 15) {
      add('advertencia', '💳', `Pagaste ${fmtCRC(totalDeuda)} en deudas, el ${pct}% de tus ingresos${detalle}. Un abono extra a la más cara te libera cuota para todos los meses siguientes.`);
    }
  }

  // --- 8) Concentración: una sola categoría que se come el gasto
  if (filasGasto.length > 1 && totalGastos > 0) {
    const top = filasGasto[0]; // ya vienen de mayor a menor
    const pct = Math.round((top.total / totalGastos) * 100);
    if (pct >= 35) {
      const antes = mapaPrevio.get(top.categoria) || 0;
      const comparacion = antes > 0 ? ` En ${nombrePrevio} fueron ${fmtCRC(antes)}.` : '';
      add('advertencia', '🎯', `${top.categoria} concentra el ${pct}% de todos tus gastos (${fmtCRC(top.total)}). Es el único lugar donde recortar mueve la aguja de verdad.${comparacion}`);
    }
  }

  // --- 9) Cuánto cuesta Batán (comida allá + viajes), para tenerlo controlado
  const filasBatan = filasGasto.filter((e) => esDeBatan(e.categoria));
  const totalBatan = filasBatan.reduce((s, e) => s + e.total, 0);
  if (totalBatan > 0) {
    const pct = totalGastos > 0 ? Math.round((totalBatan / totalGastos) * 100) : 0;
    const batanPrevio = sumarSi(filasGastoPrevio, esDeBatan);
    const comparacion = batanPrevio > 0
      ? ` En ${nombrePrevio} fue ${fmtCRC(batanPrevio)} (${totalBatan >= batanPrevio ? 'subió' : 'bajó'} ${fmtCRC(Math.abs(totalBatan - batanPrevio))}).`
      : '';
    add(pct >= 20 ? 'advertencia' : 'info', '🚗', `Batán te costó ${fmtCRC(totalBatan)} este mes (${listarFilas(filasBatan)}), el ${pct}% de tus gastos.${comparacion}`);
  }

  // --- 10) Ahorro: lo que interesa es la TASA y cómo se mueve, no el monto
  if (totalIngresos > 0) {
    const tasa = Math.round((totalAhorro / totalIngresos) * 100);
    const tasaPrevia = ingresoPrevio > 0 ? Math.round((ahorroPrevio / ingresoPrevio) * 100) : null;
    const meta = Math.round(totalIngresos * 0.1);

    if (totalAhorro === 0) {
      add('consejo', '💰', ahorroPrevio > 0
        ? `Este mes no apartaste nada y en ${nombrePrevio} habías guardado ${fmtCRC(ahorroPrevio)}. Aunque sea ${fmtCRC(meta)} (el 10%), no rompás la racha.`
        : `No registraste ahorro. Lo que funciona es apartar ${fmtCRC(meta)} (10% de lo que entró) el mismo día del pago, no lo que sobre al final del mes.`);
    } else if (tasa < 10) {
      add('consejo', '💰', `Apartaste el ${tasa}% de tus ingresos; la meta sana arranca en 10% (${fmtCRC(meta)}, te faltaron ${fmtCRC(meta - totalAhorro)}).`);
    } else if (tasaPrevia !== null && tasa <= tasaPrevia - 5) {
      add('advertencia', '💰', `Tu tasa de ahorro bajó del ${tasaPrevia}% al ${tasa}% de tus ingresos. Sigue siendo buena, pero venías mejor.`);
    } else if (tasaPrevia !== null && tasa >= tasaPrevia + 5) {
      add('bien', '💰', `Subiste tu tasa de ahorro del ${tasaPrevia}% al ${tasa}% de tus ingresos${filasAhorro.length > 1 ? ` (${listarFilas(filasAhorro)})` : ''}. Ese es el hábito que mueve todo.`);
    }
  }

  // --- 11) ¿Cuánto aguanta el saldo disponible sin ingresos? (fondo de emergencia)
  // Usa el gasto promedio de los meses anteriores; si no hay historial, el de
  // este mes. El ahorro apartado NO cuenta acá: esto es el dinero a mano.
  const gastoReferencia = gastoPromedio || totalGastos;
  if (gastoReferencia > 0) {
    const mesesCubiertos = saldoFinal / gastoReferencia;
    const metaColchon = gastoReferencia * 3;
    if (saldoFinal <= 0) {
      add('critico', '🛟', `Te quedás sin saldo disponible (${fmtCRC(saldoFinal)}). Cualquier imprevisto entra directo como deuda; lo primero es reconstruir un colchón, aunque sea de un mes de gastos (${fmtCRC(gastoReferencia)}).`);
    } else if (mesesCubiertos < 1) {
      add('advertencia', '🛟', `Tu saldo disponible (${fmtCRC(saldoFinal)}, sin contar el ahorro apartado) cubre ${Math.round(mesesCubiertos * 30)} días de gastos. La meta es 3 meses: ${fmtCRC(metaColchon)}.`);
    } else if (mesesCubiertos < 3) {
      add('consejo', '🛟', `Con ${fmtCRC(saldoFinal)} disponibles aguantarías ${mesesCubiertos.toFixed(1).replace('.', ',')} meses sin ingresos (gastás ~${fmtCRC(gastoReferencia)} al mes). Te faltan ${fmtCRC(metaColchon - saldoFinal)} para el colchón de 3 meses.`);
    } else {
      add('bien', '🛟', `Tu saldo disponible (${fmtCRC(saldoFinal)}) cubre ${Math.floor(mesesCubiertos)} meses de gastos. Eso ya es un fondo de emergencia de verdad.`);
    }
  }

  // Primero lo urgente, y sin abrumar: solo los mensajes que más importan. El
  // orden dentro de cada nivel se conserva (sort estable) y se lee natural.
  return recs
    .sort((a, b) => PRIORIDAD_NIVEL[a.nivel] - PRIORIDAD_NIVEL[b.nivel])
    .slice(0, MAX_RECOMENDACIONES);
};

// ============================================
// GET /api/finanzas-personales/recomendaciones?mes=&anio=
// Analiza el mes (y lo compara con el anterior) y devuelve mensajes para
// tomar decisiones. Todo se calcula con reglas en el backend (sin IA).
// Respuesta: { mes, anio, resumen, recomendaciones: [{ nivel, icono, mensaje }] }
// ============================================
export const getRecomendaciones = async (req, res) => {
  try {
    const mes = parseInt(req.query.mes);
    const anio = parseInt(req.query.anio);

    if (!mes || !anio || mes < 1 || mes > 12 || anio < 2000 || anio > 2100) {
      return res.status(400).json({
        message: 'Los parámetros mes (1-12) y anio son obligatorios. Ej: ?mes=7&anio=2026',
      });
    }

    // Mes anterior (para comparar). Si es enero, retrocede a diciembre del año previo.
    const mesPrevio = mes === 1 ? 12 : mes - 1;
    const anioPrevio = mes === 1 ? anio - 1 : anio;

    const [actual, previo, saldoInicial, gastoPromedio] = await Promise.all([
      calcularResumenMes(req.user.id, mes, anio),
      calcularResumenMes(req.user.id, mesPrevio, anioPrevio),
      calcularSaldoInicial(req.user.id, mes, anio),
      calcularGastoPromedioMensual(req.user.id, mes, anio),
    ]);

    res.status(200).json({
      mes,
      anio,
      resumen: componerFinanzasMes(actual, saldoInicial),
      recomendaciones: construirRecomendaciones({ actual, previo, saldoInicial, gastoPromedio, mes, anio }),
    });
  } catch (error) {
    console.error('❌ Error al generar recomendaciones:', error);
    res.status(500).json({ message: 'Error al generar las recomendaciones', error: error.message });
  }
};

// ============================================
// GET /api/finanzas-personales/anios-disponibles
// Años en los que el usuario tiene movimientos (para el selector del frontend).
// ============================================
export const getAniosDisponibles = async (req, res) => {
  try {
    const anios = await MovimientoPersonal.aggregate([
      { $match: { usuario: new mongoose.Types.ObjectId(req.user.id) } },
      { $group: { _id: { $year: '$fecha' } } },
      { $sort: { _id: -1 } },
    ]);

    res.status(200).json({ anios: anios.map((a) => a._id) });
  } catch (error) {
    console.error('❌ Error al obtener años disponibles:', error);
    res.status(500).json({ message: 'Error al obtener los años', error: error.message });
  }
};

// ============================================
// GET /api/finanzas-personales/tipo-cambio
// Devuelve el tipo de cambio del dólar consultado del lado del servidor (así
// no lo bloquean navegadores/redes/extensiones). Forma plana:
//   { fecha, venta, compra }
//   • venta  = cuesta comprar dólares  → se usa para GASTOS en USD.
//   • compra = te dan al cambiar a CRC → se usa para INGRESOS en USD.
// Cachea una vez por día. Si Hacienda falla pero hay un valor previo (aunque
// sea viejo), devuelve ese último conocido (con stale:true). Si nunca se pudo
// obtener, responde 503.
// ============================================
export const getTipoCambio = async (_req, res) => {
  const hoy = hoyCostaRica();

  // 1. Cache del día: no llamamos a Hacienda si ya lo trajimos hoy.
  if (cacheTC && cacheDiaTC === hoy) {
    return res.status(200).json(cacheTC);
  }

  // 2. Consultar a Hacienda con timeout corto (7s) para no colgar la respuesta.
  try {
    const resp = await fetch(HACIENDA_TC_URL, {
      signal: AbortSignal.timeout(7000),
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`Hacienda respondió ${resp.status}`);

    const data = await resp.json();
    const venta = Number(data?.venta?.valor);
    const compra = Number(data?.compra?.valor);
    if (!venta || !compra || isNaN(venta) || isNaN(compra)) {
      throw new Error('Respuesta de Hacienda sin valores válidos');
    }

    const fecha = data?.venta?.fecha || data?.compra?.fecha || hoy;
    cacheTC = { fecha, venta, compra };
    cacheDiaTC = hoy;

    return res.status(200).json(cacheTC);
  } catch (error) {
    console.error('❌ Error al obtener el tipo de cambio de Hacienda:', error.message);

    // 3a. Fallback: devolver el último conocido, aunque sea de un día anterior.
    if (cacheTC) {
      return res.status(200).json({ ...cacheTC, stale: true });
    }

    // 3b. Nunca se pudo obtener: error claro para que el frontend reintente.
    return res.status(503).json({
      message: 'No se pudo obtener el tipo de cambio. Intentá de nuevo en unos segundos.',
    });
  }
};

// ============================================
// GET /api/finanzas-personales/:id — Ver un movimiento
// ============================================
export const getMovimientoById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'ID inválido' });
    }

    const movimiento = await MovimientoPersonal.findOne({
      _id: req.params.id,
      usuario: req.user.id,
    }).lean();

    if (!movimiento) {
      return res.status(404).json({ message: 'Movimiento no encontrado' });
    }

    res.status(200).json({ data: movimiento });
  } catch (error) {
    console.error('❌ Error al obtener movimiento personal:', error);
    res.status(500).json({ message: 'Error al obtener el movimiento', error: error.message });
  }
};

// ============================================
// PUT /api/finanzas-personales/:id — Editar movimiento
// Se pueden editar tipo, categoria, monto, descripcion y mover de mes (mes/anio).
// ============================================
export const updateMovimiento = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'ID inválido' });
    }

    const actual = await MovimientoPersonal.findOne({
      _id: req.params.id,
      usuario: req.user.id,
    });
    if (!actual) {
      return res.status(404).json({ message: 'Movimiento no encontrado' });
    }

    const $set = {};

    // tipo y categoria van juntos: la categoría depende del tipo. Si se toca
    // uno de los dos, validamos el par resultante (mezclando con lo actual).
    if (req.body.tipo !== undefined || req.body.categoria !== undefined) {
      const tipoFinal = req.body.tipo !== undefined ? req.body.tipo : actual.tipo;
      const categoriaFinal = req.body.categoria !== undefined ? req.body.categoria : actual.categoria;
      const val = validarTipoCategoria(tipoFinal, categoriaFinal);
      if (val.error) return res.status(400).json({ message: val.error });
      $set.tipo = val.tipo;
      $set.categoria = val.categoria;
    }

    // Monto/moneda: si se toca cualquiera de estos campos, renormalizamos el
    // conjunto (mezclando lo enviado con lo guardado) para mantener el monto en
    // colones consistente con el origen.
    if (
      req.body.monto !== undefined ||
      req.body.moneda !== undefined ||
      req.body.montoOriginal !== undefined ||
      req.body.tipoCambio !== undefined
    ) {
      const dinero = normalizarMonto({
        moneda: req.body.moneda !== undefined ? req.body.moneda : actual.moneda,
        monto: req.body.monto !== undefined ? req.body.monto : actual.monto,
        montoOriginal: req.body.montoOriginal !== undefined ? req.body.montoOriginal : actual.montoOriginal,
        tipoCambio: req.body.tipoCambio !== undefined ? req.body.tipoCambio : actual.tipoCambio,
      });
      if (dinero.error) return res.status(400).json({ message: dinero.error });
      $set.monto = dinero.monto;
      $set.moneda = dinero.moneda;
      $set.montoOriginal = dinero.montoOriginal;
      $set.tipoCambio = dinero.tipoCambio;
    }

    if (req.body.descripcion !== undefined) {
      $set.descripcion = req.body.descripcion?.trim() || null;
    }

    if (req.body.mes !== undefined || req.body.anio !== undefined) {
      const resultadoFecha = resolverFechaDelMes(req.body.mes, req.body.anio);
      if (resultadoFecha.error) {
        return res.status(400).json({ message: resultadoFecha.error });
      }
      if (resultadoFecha.fecha) $set.fecha = resultadoFecha.fecha;
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ message: 'No se enviaron campos para actualizar' });
    }

    const movimiento = await MovimientoPersonal.findByIdAndUpdate(
      req.params.id,
      { $set },
      { new: true, runValidators: true }
    );

    res.status(200).json({ message: 'Movimiento actualizado', data: movimiento });
  } catch (error) {
    console.error('❌ Error al actualizar movimiento personal:', error);
    res.status(500).json({ message: 'Error al actualizar el movimiento', error: error.message });
  }
};

// ============================================
// DELETE /api/finanzas-personales/:id — Eliminar movimiento
// ============================================
export const deleteMovimiento = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'ID inválido' });
    }

    const movimiento = await MovimientoPersonal.findOneAndDelete({
      _id: req.params.id,
      usuario: req.user.id,
    });

    if (!movimiento) {
      return res.status(404).json({ message: 'Movimiento no encontrado' });
    }

    res.status(200).json({ message: 'Movimiento eliminado', id: req.params.id });
  } catch (error) {
    console.error('❌ Error al eliminar movimiento personal:', error);
    res.status(500).json({ message: 'Error al eliminar el movimiento', error: error.message });
  }
};
