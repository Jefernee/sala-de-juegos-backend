// controllers/finanzasPersonalesController.js
// Finanzas Personales (SOLO administrador). Módulo APARTE de la sala de juegos:
// no lee ni escribe nada del negocio. Solo maneja los ingresos y gastos
// personales que el administrador registra a mano, filtrados por su usuario.
//
// ── Cómo se calculan los reportes (Patrón A, igual que el Estado de Resultados)
// Los totales de cada mes NO se recalculan al abrir un reporte: se guardan en
// `ResumenPersonalMes` (un snapshot por usuario/mes) cuando se crea, edita o
// borra un movimiento, en segundo plano. Los GET solo LEEN esos snapshots.
//   • Resumen del mes  → 1 snapshot + 1 agregación de acumulados.
//   • Reporte ANUAL    → 1 consulta que trae ≤24 snapshots (el año + el anterior)
//                        y se suma en memoria. Costo plano: no toca los
//                        movimientos ni una vez, por más que crezcan.
// Los ACUMULADOS (saldo inicial, ahorro acumulado) se derivan al leer sumando
// los snapshots (12 por año), no se guardan: si se guardaran, editar marzo
// dejaría mal abril→diciembre y habría que regenerar en cascada.
import mongoose from 'mongoose';
import MovimientoPersonal, {
  TIPOS_MOVIMIENTO,
  CATEGORIAS_INGRESO,
  CATEGORIAS_EGRESO,
  CATEGORIAS_DEUDA,
  CATEGORIAS_FIJAS,
  CATEGORIAS_AHORRO,
  MONEDAS,
  FONDOS,
  categoriasPorTipo,
  esAhorro,
  esRetiroAhorro,
  admiteFondoAhorro,
  esGastoFijo,
  esDeBatan,
} from '../models/MovimientoPersonal.js';
import ResumenPersonalMes, { NOMBRES_MES_PERSONAL } from '../models/ResumenPersonalMes.js';
import AperturaPersonal from '../models/AperturaPersonal.js';
import { crearFiltroMes, crearFechaParaMes } from '../utils/dateUtils.js';

// Versión del formato del snapshot mensual. Subir este número al agregar campos
// nuevos: los snapshots guardados con versión menor se regeneran solos al leerlos.
//   v1: totales del mes + desglose por categoría.
//   v2: + retiros del ahorro (totalRetiroAhorro, desgloseRetiro).
//   v3: + gasto pagado directo con el ahorro (totalGastoDesdeAhorro,
//       desgloseGastoAhorro, desgloseGastoAhorroPorBolsa).
export const SCHEMA_VERSION = 3;

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

// Año en curso EN COSTA RICA. El servidor corre en UTC, así que la noche del 31
// de diciembre `new Date().getFullYear()` ya devolvería el año siguiente mientras
// en CR todavía es diciembre.
const anioActualCR = () => Number(hoyCostaRica().slice(0, 4));

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

// Valida el par fondo + bolsaAhorro contra el tipo/categoría ya normalizados.
// `fondo` es opcional: si no viene, el movimiento es del mes (lo de siempre).
// Solo un egreso de consumo puede marcarse como pagado con el ahorro, y en ese
// caso hay que decir de CUÁL bolsa salió (Ahorro, Ahorro CreAI o Ahorro MEP).
// Retorna { error } o { fondo, bolsaAhorro } listos para guardar.
const validarFondo = (fondoRaw, bolsaRaw, tipo, categoria) => {
  const fondo = String(fondoRaw ?? 'mes').trim().toLowerCase();
  if (!FONDOS.includes(fondo)) {
    return { error: 'fondo inválido (usar "mes" o "ahorro")' };
  }

  if (fondo === 'mes') return { fondo: 'mes', bolsaAhorro: null };

  if (!admiteFondoAhorro(tipo, categoria)) {
    return {
      error: esAhorro(categoria)
        ? 'Un ahorro no se puede pagar con el ahorro: para mover plata entre bolsas usá un retiro y luego el ahorro nuevo'
        : 'Solo un egreso puede marcarse como pagado con el ahorro',
    };
  }

  const bolsa = String(bolsaRaw || '').trim().normalize('NFC');
  const match = CATEGORIAS_AHORRO.find((c) => c.normalize('NFC') === bolsa);
  if (!match) {
    return {
      error: `Para un gasto pagado con el ahorro hay que indicar bolsaAhorro. Válidas: ${CATEGORIAS_AHORRO.join(', ')}`,
    };
  }

  return { fondo: 'ahorro', bolsaAhorro: match };
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
    // `retiro_ahorro` YA NO SE OFRECE. Enredaba más de lo que servía: sacar
    // plata del ahorro para gastarla dejaba el saldo inflado hasta anotar el
    // gasto, y al anotarlo bajaba "Puedo gastar hasta" aunque el mes no hubiera
    // puesto un colón. Eso ahora se anota como un egreso con fondo='ahorro'.
    // El backend lo sigue ACEPTANDO (POST/PUT) para no romper lo ya guardado,
    // pero el frontend no debe mostrarlo como opción.
    tipos: TIPOS_MOVIMIENTO.filter((t) => t !== 'retiro_ahorro'),
    categorias: {
      ingreso: CATEGORIAS_INGRESO,
      egreso: CATEGORIAS_EGRESO,
      // Se mantiene por si hay movimientos viejos que haya que editar.
      retiro_ahorro: CATEGORIAS_AHORRO,
    },
    // Al registrar un EGRESO se puede indicar de qué bolsillo salió. Si es
    // 'ahorro', hay que mandar además `bolsaAhorro` (una de estas bolsas).
    fondos: FONDOS,
    bolsasAhorro: CATEGORIAS_AHORRO,
    // Categorías de egreso que NO admiten fondo='ahorro' (las de ahorro mismo).
    categoriasSinFondoAhorro: CATEGORIAS_AHORRO,
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

    const bolsillo = validarFondo(req.body.fondo, req.body.bolsaAhorro, tipo, categoria);
    if (bolsillo.error) return res.status(400).json({ message: bolsillo.error });

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

    // Sacar plata del ahorro —sea un retiro o un gasto pagado con él— no puede
    // dejar el acumulado en negativo en ningún mes.
    const salidaAhorro = esRetiroAhorro(tipo) || bolsillo.fondo === 'ahorro';
    if (salidaAhorro) {
      await asegurarSnapshots(req.user.id); // la validación lee snapshots
      const { anio, mes } = anioMesCR(resultadoFecha.fecha || new Date());
      const problema = await validarAhorroNoNegativo(req.user.id, [
        { anio, mes, ahorro: 0, salida: dinero.monto },
      ]);
      if (problema) {
        // `disponible` es el TOPE de ESTE movimiento, no el acumulado del mes:
        // si ya había otras salidas ese mes, lo que queda es menos. El frontend
        // usa este número para limitar el campo, así que tiene que ser el real.
        const tope = Math.max(0, dinero.monto - problema.exceso);
        const donde = `${NOMBRES_MES[problema.mes - 1]} ${problema.anio}`;
        const mismoMes = problema.anio === anio && problema.mes === mes;
        const verbo = esRetiroAhorro(tipo) ? 'sacar' : 'pagar con el ahorro';
        return res.status(400).json({
          message: tope === 0
            ? (mismoMes
                ? `No te queda ahorro para ${verbo} en ${donde}.`
                : `No podés ${verbo} nada: dejaría el ahorro en negativo en ${donde}.`)
            : (mismoMes
                ? `Solo podés ${verbo} ${fmtCRC(tope)}: es lo que te queda en el ahorro a ${donde}.`
                : `Solo podés ${verbo} ${fmtCRC(tope)}: más que eso deja el ahorro en negativo en ${donde}.`),
          disponible: tope,          // tope de este movimiento
          acumulado: problema.disponible, // ahorro acumulado a ese mes (informativo)
        });
      }
    }

    const movimiento = await MovimientoPersonal.create({
      usuario: req.user.id,
      tipo,
      categoria,
      fondo: bolsillo.fondo,
      bolsaAhorro: bolsillo.bolsaAhorro,
      monto: dinero.monto,
      moneda: dinero.moneda,
      montoOriginal: dinero.montoOriginal,
      tipoCambio: dinero.tipoCambio,
      descripcion: req.body.descripcion?.trim() || null,
      ...(resultadoFecha.fecha && { fecha: resultadoFecha.fecha }),
    });

    // Snapshot del mes al día (Patrón A). A diferencia del estado de resultados
    // del negocio —que se regenera en background— acá se ESPERA: el resumen del
    // mes que el frontend recarga justo después ya lee del snapshot, así que si
    // no se espera, la tarjeta no reflejaría el movimiento recién guardado.
    // Es una agregación de un mes + un upsert: milisegundos.
    await regenerarResumenDeFecha(req.user.id, movimiento.fecha);

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

// ════════════════════════════════════════════════════════════════════
// CAPA DE SNAPSHOTS MENSUALES (Patrón A)
// ════════════════════════════════════════════════════════════════════

// ============================================
// Calcula los totales de un mes LEYENDO LOS MOVIMIENTOS. Esta es la ÚNICA
// función que recorre la colección de movimientos, y solo corre cuando hay que
// (re)generar el snapshot de un mes: al crear/editar/borrar un movimiento, o la
// primera vez que se abre un mes que nunca se guardó. Nunca en cada carga.
// Una sola agregación en Mongo (no trae los movimientos a memoria de Node).
// ============================================
const construirResumenMes = async (usuarioId, mes, anio) => {
  const grupos = await MovimientoPersonal.aggregate([
    {
      $match: {
        usuario: new mongoose.Types.ObjectId(usuarioId),
        fecha: crearFiltroMes(mes, anio),
      },
    },
    {
      $group: {
        // `fondo` distingue el egreso normal del pagado con el ahorro, y
        // `bolsaAhorro` dice de cuál bolsa salió. Los movimientos viejos no
        // tienen el campo: $ifNull los deja como 'mes' (que es lo que eran).
        _id: {
          tipo: '$tipo',
          categoria: '$categoria',
          fondo: { $ifNull: ['$fondo', 'mes'] },
          bolsa: { $ifNull: ['$bolsaAhorro', null] },
        },
        total: { $sum: '$monto' },
        cantidad: { $sum: 1 },
      },
    },
    { $sort: { total: -1 } },
  ]);

  const desgloseIngreso = [];
  const desgloseEgreso = [];
  const desgloseRetiro = [];
  const desgloseGastoAhorro = [];
  const porBolsa = new Map();
  let totalIngresos = 0;
  let totalEgresos = 0;
  let totalAhorro = 0;
  let totalRetiroAhorro = 0;
  let totalGastoDesdeAhorro = 0;
  let movimientos = 0;

  for (const g of grupos) {
    const fila = { categoria: g._id.categoria, total: g.total, cantidad: g.cantidad };
    movimientos += g.cantidad;
    if (g._id.tipo === 'ingreso') {
      desgloseIngreso.push(fila);
      totalIngresos += g.total;
    } else if (esRetiroAhorro(g._id.tipo)) {
      // Ni ingreso ni egreso: traslado del ahorro al bolsillo del día a día.
      desgloseRetiro.push(fila);
      totalRetiroAhorro += g.total;
    } else if (g._id.fondo === 'ahorro') {
      // Egreso pagado DIRECTO con el ahorro: no pasó por la plata del mes, así
      // que no entra en totalEgresos ni en totalGastos. Solo baja el acumulado.
      desgloseGastoAhorro.push(fila);
      totalGastoDesdeAhorro += g.total;
      const bolsa = g._id.bolsa || 'Ahorro';
      const acc = porBolsa.get(bolsa) || { categoria: bolsa, total: 0, cantidad: 0 };
      acc.total += g.total;
      acc.cantidad += g.cantidad;
      porBolsa.set(bolsa, acc);
    } else {
      desgloseEgreso.push(fila);
      totalEgresos += g.total;
      if (esAhorro(fila.categoria)) totalAhorro += g.total;
    }
  }

  // El $group parte una misma categoría en varias filas cuando hay fondos o
  // bolsas distintas; se vuelven a juntar para que el desglose no la repita.
  const juntarPorCategoria = (filas) => {
    const mapa = new Map();
    for (const f of filas) {
      const acc = mapa.get(f.categoria) || { categoria: f.categoria, total: 0, cantidad: 0 };
      acc.total += f.total;
      acc.cantidad += f.cantidad;
      mapa.set(f.categoria, acc);
    }
    return [...mapa.values()].sort((a, b) => b.total - a.total);
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    anio,
    mes,
    nombreMes: NOMBRES_MES_PERSONAL[mes],
    totalIngresos,
    totalGastos: totalEgresos - totalAhorro, // egresos SIN ahorro (consumo del mes)
    totalAhorro,                             // apartado en el mes (BRUTO)
    totalEgresos,
    totalRetiroAhorro,
    totalGastoDesdeAhorro,                   // consumo pagado con el ahorro
    balanceMes: totalIngresos - totalEgresos, // flujo propio del mes, SIN retiros
    desgloseIngreso: juntarPorCategoria(desgloseIngreso),
    desgloseEgreso: juntarPorCategoria(desgloseEgreso),
    desgloseRetiro: juntarPorCategoria(desgloseRetiro),
    desgloseGastoAhorro: juntarPorCategoria(desgloseGastoAhorro),
    desgloseGastoAhorroPorBolsa: [...porBolsa.values()].sort((a, b) => b.total - a.total),
    movimientos,
    ultimaActualizacion: new Date(),
  };
};

// Un mes sin snapshot y sin movimientos: se responde en ceros SIN crear el
// documento (no ensucia la base con 12 docs vacíos por año).
const mesVacio = (mes, anio) => ({
  schemaVersion: SCHEMA_VERSION,
  anio,
  mes,
  nombreMes: NOMBRES_MES_PERSONAL[mes],
  totalIngresos: 0,
  totalGastos: 0,
  totalAhorro: 0,
  totalEgresos: 0,
  totalRetiroAhorro: 0,
  totalGastoDesdeAhorro: 0,
  balanceMes: 0,
  desgloseIngreso: [],
  desgloseEgreso: [],
  desgloseRetiro: [],
  desgloseGastoAhorro: [],
  desgloseGastoAhorroPorBolsa: [],
  movimientos: 0,
});

// Regenera y GUARDA (upsert) el snapshot de un mes. Si el mes quedó sin ningún
// movimiento se BORRA el snapshot (en vez de dejar un doc en ceros): así los
// acumulados no cambian y la base queda limpia. Devuelve el resumen calculado.
// Puede lanzar: para uso donde queremos reportar el error.
export const regenerarResumenMes = async (usuarioId, mes, anio) => {
  const datos = await construirResumenMes(usuarioId, mes, anio);

  if (datos.movimientos === 0) {
    await ResumenPersonalMes.deleteOne({ usuario: usuarioId, anio, mes });
    return datos;
  }

  await ResumenPersonalMes.findOneAndUpdate(
    { usuario: usuarioId, anio, mes },
    { $set: { ...datos, usuario: usuarioId } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
  return datos;
};

// Deriva { anio, mes } en hora Costa Rica de una fecha UTC guardada (igual que
// el estado de resultados del negocio).
const anioMesCR = (fecha) => {
  const cr = new Date(new Date(fecha).toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }));
  return { anio: cr.getFullYear(), mes: cr.getMonth() + 1 };
};

// Versión "en background" (como Plays/Ventas/Estado de Resultados): regenera
// el/los mes(es) CR de las fechas dadas, sin duplicar, y NUNCA lanza. Se llama
// después de crear/editar/borrar un movimiento. Al editar algo que cambia de
// mes hay que pasar la fecha VIEJA y la NUEVA (los dos meses se ven afectados).
export const regenerarResumenDeFecha = async (usuarioId, ...fechas) => {
  const vistos = new Set();
  for (const f of fechas) {
    if (!f) continue;
    const { anio, mes } = anioMesCR(f);
    const key = `${anio}-${mes}`;
    if (vistos.has(key)) continue;
    vistos.add(key);
    try {
      await regenerarResumenMes(usuarioId, mes, anio);
    } catch (err) {
      // No propagar: el movimiento ya se guardó bien. El snapshot se rehace solo
      // en la próxima lectura (asegurarSnapshots) o con POST /regenerar.
      console.error('⚠️ Error al regenerar el resumen personal del mes:', err.message);
    }
  }
};

// ============================================
// Red de seguridad: asegura que el usuario tenga snapshot de TODOS los meses en
// los que tiene movimientos, y que ninguno haya quedado con un formato viejo.
//
// ¿Cuándo hace falta? Al desplegar esto por primera vez (los meses que ya
// existen no tienen snapshot), o si alguien tocó la base a mano. Corre UNA sola
// vez por proceso y por usuario: la primera lectura después de un reinicio hace
// una agregación chiquita (una fila por mes) y, si no falta nada, no escribe
// nada. En prod las tareas de arranque están apagadas (EJECUTAR_MIGRACIONES=
// false), así que esta es la que mantiene todo consistente sola.
// ============================================
const snapshotsVerificados = new Set(); // ids de usuario ya verificados en este proceso

const asegurarSnapshots = async (usuarioId) => {
  const clave = String(usuarioId);
  if (snapshotsVerificados.has(clave)) return;

  // Meses (hora CR) en los que el usuario tiene movimientos: una fila por mes.
  const conDatos = await MovimientoPersonal.aggregate([
    { $match: { usuario: new mongoose.Types.ObjectId(usuarioId) } },
    {
      $group: {
        _id: {
          y: { $year: { date: '$fecha', timezone: 'America/Costa_Rica' } },
          m: { $month: { date: '$fecha', timezone: 'America/Costa_Rica' } },
        },
      },
    },
  ]);

  // Snapshots que YA están guardados con el formato actual.
  const guardados = await ResumenPersonalMes.find(
    { usuario: usuarioId, schemaVersion: SCHEMA_VERSION },
    'anio mes'
  ).lean();
  const alDia = new Set(guardados.map((s) => `${s.anio}-${s.mes}`));

  let generados = 0;
  for (const c of conDatos) {
    if (alDia.has(`${c._id.y}-${c._id.m}`)) continue;
    await regenerarResumenMes(usuarioId, c._id.m, c._id.y);
    generados++;
  }

  if (generados > 0) {
    console.log(`📊 Finanzas personales: ${generados} snapshot(s) mensual(es) generados.`);
  }

  snapshotsVerificados.add(clave); // solo si terminó bien: un fallo se reintenta
};

// Lee el snapshot de un mes (SIN recalcular). Si falta o quedó con formato
// viejo, lo regenera una vez y devuelve lo recién calculado.
const leerResumenMes = async (usuarioId, mes, anio) => {
  const guardado = await ResumenPersonalMes.findOne({ usuario: usuarioId, anio, mes }).lean();

  if (guardado && (guardado.schemaVersion || 0) >= SCHEMA_VERSION) return guardado;
  if (guardado) return regenerarResumenMes(usuarioId, mes, anio); // formato viejo

  // Sin snapshot: puede ser un mes vacío (lo normal) o uno que nunca se generó.
  const datos = await regenerarResumenMes(usuarioId, mes, anio);
  return datos.movimientos === 0 ? mesVacio(mes, anio) : datos;
};

// Adapta un snapshot al shape { totalIngresos, totalEgresos, desglose } que usan
// componerFinanzasMes y los mensajes inteligentes (se mantiene igual que antes
// para no cambiar lo que ya consume el frontend).
const comoResumen = (snap) => ({
  totalIngresos: snap.totalIngresos || 0,
  totalEgresos: snap.totalEgresos || 0,
  totalRetiroAhorro: snap.totalRetiroAhorro || 0,
  totalGastoDesdeAhorro: snap.totalGastoDesdeAhorro || 0,
  balance: (snap.totalIngresos || 0) - (snap.totalEgresos || 0),
  desglose: {
    ingreso: snap.desgloseIngreso || [],
    egreso: snap.desgloseEgreso || [],
    // Los retiros van en su propio bloque, con porcentaje sobre el total retirado.
    retiro: conPorcentaje(snap.desgloseRetiro || []),
    // Lo pagado con el ahorro: en qué se fue y de cuál bolsa salió.
    gastoAhorro: conPorcentaje(snap.desgloseGastoAhorro || []),
    gastoAhorroPorBolsa: conPorcentaje(snap.desgloseGastoAhorroPorBolsa || []),
  },
});

// Agrega `porcentaje` a filas { categoria, total, cantidad } sobre su propio total.
const conPorcentaje = (filas) => {
  const total = filas.reduce((s, f) => s + (f.total || 0), 0);
  return filas.map((f) => ({
    ...f,
    porcentaje: total > 0 ? Math.round((f.total / total) * 1000) / 10 : 0,
  }));
};

// Suma el ahorro del mes a partir del desglose (todas las categorías de ahorro:
// Ahorro, Ahorro CreAI, Ahorro MEP). El ahorro vive dentro de `totalEgresos`,
// pero lo separamos para mostrarlo aparte y no tratarlo como gasto de consumo.
const calcularAhorro = (desglose) =>
  desglose.egreso.filter((e) => esAhorro(e.categoria)).reduce((s, e) => s + e.total, 0);

// ════════════════════════════════════════════════════════════════════
// ACUMULADOS (saldo inicial y ahorro acumulado)
// ════════════════════════════════════════════════════════════════════

// Convierte (anio, mes) a un número ordenable, para comparar meses sin fechas.
const ordinalMes = (anio, mes) => anio * 12 + mes;

// Redondea a 1 decimal de forma simétrica: Math.round manda el medio siempre
// hacia arriba, así que 6,25 daría 6,3 pero −6,25 daría −6,2. Se redondea la
// magnitud y se le devuelve el signo, para que un porcentaje negativo y su
// positivo no queden con distinto decimal.
const redondear1 = (n) => (n < 0 ? -1 : 1) * Math.round(Math.abs(n) * 10) / 10;

// ============================================
// Saldo de apertura del usuario (o null). Es lo que se traía de ANTES de
// empezar a usar el módulo: no es movimiento de ningún mes.
//   • montoDisponible → suma al Saldo Inicial (plata a mano)
//   • montoAhorro     → suma al Ahorro Acumulado (plata apartada)
// Aplica desde el mes de corte en adelante.
// ============================================
const leerApertura = (usuarioId) => AperturaPersonal.findOne({ usuario: usuarioId }).lean();

// ¿La apertura ya está vigente en el mes consultado (o antes)?
const aperturaVigente = (apertura, anio, mes) =>
  !!apertura && ordinalMes(apertura.anioCorte, apertura.mesCorte) <= ordinalMes(anio, mes);

// ============================================
// Saldo Inicial y Ahorro Acumulado (NO se almacenan: se derivan al leer).
//
// Antes esto recorría TODOS los movimientos anteriores en cada carga. Ahora suma
// los SNAPSHOTS mensuales: como máximo 12 documentos chiquitos por año, en una
// sola agregación. Sigue siendo exacto y se recalcula solo si se edita un mes
// viejo (el snapshot de ese mes se regenera y la suma cambia sola), sin cascada.
//
//   SaldoInicial[m]    = Σ (ingresos − egresos + retiros) de los meses ANTERIORES
//                        a m + apertura.montoDisponible
//   AhorroAcumulado[m] = Σ (ahorro − retiros − gastoDesdeAhorro) de los meses
//                        HASTA m (inclusive) + apertura.montoAhorro
//
// El ahorro está dentro de los egresos, así que RESTA del saldo disponible: es
// plata apartada que ya no está a mano (por eso se muestra como total aparte). Un
// retiro hace lo contrario: suma al saldo y resta del acumulado, así que el
// ahorro acumulado que sale de acá siempre es NETO.
//
// Un gasto pagado DIRECTO con el ahorro baja el acumulado igual que un retiro,
// pero NO toca el saldo: esa plata nunca pasó por el bolsillo del mes. Por eso
// no aparece en SaldoInicial y sí en AhorroAcumulado.
// Devuelve { saldoInicial, ahorroAcumulado, ahorroPrevio, apertura }.
// ============================================
const calcularAcumulados = async (usuarioId, mes, anio) => {
  const [filas, apertura] = await Promise.all([
    ResumenPersonalMes.aggregate([
      {
        // Todo lo que pasó HASTA el mes consultado (inclusive).
        $match: {
          usuario: new mongoose.Types.ObjectId(usuarioId),
          $or: [{ anio: { $lt: anio } }, { anio, mes: { $lte: mes } }],
        },
      },
      {
        // Marca los meses ESTRICTAMENTE anteriores (los que forman el saldo inicial).
        $addFields: {
          esPrevio: {
            $or: [
              { $lt: ['$anio', anio] },
              { $and: [{ $eq: ['$anio', anio] }, { $lt: ['$mes', mes] }] },
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          ingresosPrevios: { $sum: { $cond: ['$esPrevio', '$totalIngresos', 0] } },
          egresosPrevios: { $sum: { $cond: ['$esPrevio', '$totalEgresos', 0] } },
          retirosPrevios: { $sum: { $cond: ['$esPrevio', '$totalRetiroAhorro', 0] } },
          ahorroPrevio: { $sum: { $cond: ['$esPrevio', '$totalAhorro', 0] } },
          gastoAhorroPrevio: { $sum: { $cond: ['$esPrevio', '$totalGastoDesdeAhorro', 0] } },
          ahorroHastaElMes: { $sum: '$totalAhorro' },
          retirosHastaElMes: { $sum: '$totalRetiroAhorro' },
          gastoAhorroHastaElMes: { $sum: '$totalGastoDesdeAhorro' },
        },
      },
    ]),
    leerApertura(usuarioId),
  ]);

  const agg = filas[0] || {
    ingresosPrevios: 0,
    egresosPrevios: 0,
    retirosPrevios: 0,
    ahorroPrevio: 0,
    gastoAhorroPrevio: 0,
    ahorroHastaElMes: 0,
    retirosHastaElMes: 0,
    gastoAhorroHastaElMes: 0,
  };
  // La apertura es dinero que YA existía al empezar el mes de corte, así que
  // cuenta igual para el saldo inicial y para el ahorro previo de ese mismo mes.
  const vigente = aperturaVigente(apertura, anio, mes);
  const aportaDisponible = vigente ? apertura.montoDisponible || 0 : 0;
  const aportaAhorro = vigente ? apertura.montoAhorro || 0 : 0;

  return {
    // Puede ser negativo si se arrastra un déficit. Los retiros de meses previos
    // ya devolvieron esa plata al bolsillo, así que suman.
    saldoInicial: agg.ingresosPrevios - agg.egresosPrevios + agg.retirosPrevios + aportaDisponible,
    // Ahorro NETO (lo apartado menos lo retirado y lo gastado desde el ahorro):
    ahorroAcumulado:
      agg.ahorroHastaElMes - agg.retirosHastaElMes - agg.gastoAhorroHastaElMes + aportaAhorro, // al CIERRE del mes
    ahorroPrevio:
      agg.ahorroPrevio - agg.retirosPrevios - agg.gastoAhorroPrevio + aportaAhorro,            // al INICIO del mes
    apertura: apertura || null,
  };
};

// ════════════════════════════════════════════════════════════════════
// INVARIANTE: el ahorro acumulado NUNCA puede quedar negativo
// ════════════════════════════════════════════════════════════════════

// Cuánto aporta un movimiento al ahorro acumulado, y en qué mes.
//   • egreso con categoría de ahorro → aparta plata (+ ahorro)
//   • retiro_ahorro                  → saca plata (+ salida)
//   • egreso con fondo='ahorro'      → saca plata y la consume (+ salida)
//   • cualquier otro                 → no toca el ahorro
// `salida` junta retiros y gastos pagados con el ahorro: para el invariante "el
// acumulado nunca queda negativo" las dos cosas drenan igual.
const contribucionAhorro = (mov) => {
  const { anio, mes } = anioMesCR(mov.fecha);
  const esEgreso = mov.tipo === 'egreso';
  return {
    anio,
    mes,
    ahorro: esEgreso && esAhorro(mov.categoria) ? mov.monto : 0,
    salida:
      esRetiroAhorro(mov.tipo) || (esEgreso && mov.fondo === 'ahorro') ? mov.monto : 0,
  };
};

// ============================================
// Verifica que, aplicando los cambios pedidos, el ahorro acumulado NETO no quede
// negativo en NINGÚN mes. No alcanza con mirar el mes del movimiento: si se
// retiró de más en agosto, bajar el ahorro de julio también rompe agosto.
//
// `deltas`: [{ anio, mes, ahorro, salida }] con los cambios (pueden ser negativos:
// así se modela borrar o editar). `salida` = retiros + gastos pagados con el
// ahorro, que drenan el acumulado igual. `aperturaOverride`: `undefined` usa la apertura
// guardada; `null` simula que no hay; un objeto { montoAhorro, mesCorte, anioCorte }
// simula el valor nuevo (para validar que se pueda bajar, mover o borrar).
//
// Devuelve null si todo bien, o { mensaje, disponible, mes, anio } con el primer
// mes que se pasaría y cuánto había realmente disponible ahí.
// ============================================
const validarAhorroNoNegativo = async (usuarioId, deltas = [], aperturaOverride = undefined) => {
  const [snapshots, apertura] = await Promise.all([
    ResumenPersonalMes.find(
      { usuario: usuarioId },
      'anio mes totalAhorro totalRetiroAhorro totalGastoDesdeAhorro'
    ).lean(),
    leerApertura(usuarioId),
  ]);

  // Estado actual mes por mes, indexado por ordinal para poder ordenarlo.
  const porOrdinal = new Map();
  const tomar = (anio, mes) => {
    const o = ordinalMes(anio, mes);
    if (!porOrdinal.has(o)) porOrdinal.set(o, { anio, mes, ahorro: 0, salida: 0 });
    return porOrdinal.get(o);
  };

  for (const s of snapshots) {
    const fila = tomar(s.anio, s.mes);
    fila.ahorro += s.totalAhorro || 0;
    fila.salida += (s.totalRetiroAhorro || 0) + (s.totalGastoDesdeAhorro || 0);
  }
  for (const d of deltas) {
    if (!d) continue;
    const fila = tomar(d.anio, d.mes);
    fila.ahorro += d.ahorro || 0;
    fila.salida += d.salida || 0;
  }

  // Aporte de la apertura (lo que ya estaba apartado antes de usar el módulo).
  const efectiva = aperturaOverride !== undefined ? aperturaOverride : apertura;
  const montoApertura = efectiva?.montoAhorro || 0;
  const ordinalApertura = efectiva ? ordinalMes(efectiva.anioCorte, efectiva.mesCorte) : null;

  let acumulado = 0;
  let aperturaSumada = false;

  for (const o of [...porOrdinal.keys()].sort((a, b) => a - b)) {
    const fila = porOrdinal.get(o);

    // La apertura entra al cruzar su mes de corte (antes de los movimientos de ese mes).
    if (!aperturaSumada && ordinalApertura !== null && o >= ordinalApertura) {
      acumulado += montoApertura;
      aperturaSumada = true;
    }

    // Lo que realmente había disponible para sacar en este mes.
    const disponible = acumulado + fila.ahorro;
    if (fila.salida > disponible) {
      return {
        // Ahorro acumulado a ese mes (antes de las salidas del mes).
        disponible,
        // Por cuánto se pasa el TOTAL de salidas de ese mes. Con esto el que
        // llama calcula el tope exacto del movimiento que se está guardando:
        // si ya había otras salidas ese mes, el tope NO es `disponible`.
        exceso: fila.salida - disponible,
        mes: fila.mes,
        anio: fila.anio,
        mensaje: `Solo tenés ${fmtCRC(disponible)} acumulados en ahorro a ${NOMBRES_MES[fila.mes - 1]} ${fila.anio}`,
      };
    }

    acumulado = disponible - fila.salida;
  }

  return null;
};

// ============================================
// Gasto de consumo PROMEDIO por mes (sin ahorro) de los meses ANTERIORES al
// consultado. Con esto los mensajes pueden decir algo que no está en pantalla:
// cuántos meses aguantaría el dinero si se cayeran los ingresos.
// Se promedia solo entre los meses que SÍ tuvieron gastos (un mes vacío no
// diluye el promedio). Lee snapshots, no movimientos. null si no hay historial.
// ============================================
const calcularGastoPromedioMensual = async (usuarioId, mes, anio, meses = 3) => {
  // Los N meses anteriores al consultado, como pares {anio, mes} exactos (así la
  // consulta pide justo esos snapshots y no depende de cuántos años haya).
  const ventana = [];
  for (let i = 1; i <= meses; i++) {
    const o = ordinalMes(anio, mes) - i - 1; // -1: ordinal es 1-based en el mes
    ventana.push({ anio: Math.floor(o / 12), mes: (o % 12) + 1 });
  }

  // Cuenta TODO el consumo: lo pagado con plata del mes y lo pagado con el
  // ahorro. Para saber cuánto aguanta el colchón importa cuánto se consume al
  // mes, no de cuál bolsillo salió.
  const filas = await ResumenPersonalMes.find(
    { usuario: usuarioId, $or: ventana },
    'totalGastos totalGastoDesdeAhorro'
  ).lean();

  const consumos = filas
    .map((f) => (f.totalGastos || 0) + (f.totalGastoDesdeAhorro || 0))
    .filter((c) => c > 0); // un mes sin consumo no diluye el promedio

  if (consumos.length === 0) return null;
  return Math.round(consumos.reduce((s, c) => s + c, 0) / consumos.length);
};

// A partir del resumen del mes (el snapshot, vía comoResumen) y sus acumulados,
// arma el bloque financiero que consume el frontend. El saldo inicial se suma a
// TODOS los cálculos del mes (es dinero disponible del mes anterior), pero NO
// se cuenta como ingreso: `totalIngresos` y `desglose.ingreso` quedan intactos.
//   Disponible  = SaldoInicial + Ingresos + RetirosDelAhorro
//   SaldoFinal  = Disponible - Gastos - Ahorro
//   Balance     = SaldoFinal (nombre viejo que se mantiene por compatibilidad)
//   BalanceMes  = Ingresos - Egresos: lo que el mes generó por sí solo, SIN retiros
//   VariacionSaldo = BalanceMes + Retiros = SaldoFinal - SaldoInicial
//   LibreParaGastar = BalanceMes: cuánto se puede gastar todavía sin meterle mano
//     al dinero que se traía ni al ahorro. El ahorro ya viene restado, así que es
//     plata realmente libre. Negativo = ya se tocó el saldo inicial o el ahorro
//     (y el monto es cuánto se le sacó).
//
// `ahorroAcumulado` es el TOTAL apartado hasta el cierre de este mes (incluye el
// saldo de apertura): no entra en el saldo disponible —es plata que ya salió del
// bolsillo del día a día— pero se devuelve para mostrarlo en su propia tarjeta y
// para el colchón: `patrimonio` = lo que hay a mano + lo apartado.
// Un RETIRO del ahorro (`totalRetiroAhorro`) devuelve plata al bolsillo del día a
// día: suma a `disponible` y a `saldoFinal`, pero NO a `totalIngresos` (no es
// plata nueva; si contara como ingreso, los porcentajes del mes y la comparación
// contra el mes anterior se romperían — el mes siguiente diría "tus ingresos
// bajaron 80%"). Tampoco toca `libreParaGastar`: eso mide lo que el mes generó
// por sí solo, y sacar del ahorro no es generar.
//
// Un GASTO PAGADO CON EL AHORRO (`totalGastoDesdeAhorro`) no aparece en NINGUNA
// de las fórmulas de arriba, a propósito: esa plata salió del ahorro y se
// consumió sin pasar nunca por el bolsillo del mes. Solo baja `ahorroAcumulado`
// (y con él el `patrimonio`, que es lo correcto: la plata ya no existe).
// Antes esto había que anotarlo como retiro + egreso, y ninguna de las dos
// mitades sola daba bien: con el retiro solo, el saldo final quedaba inflado; con
// las dos, "Puedo gastar hasta" bajaba aunque el mes no hubiera puesto un colón.
const componerFinanzasMes = (resumen, saldoInicial, ahorroAcumulado = 0) => {
  const {
    totalIngresos,
    totalEgresos,
    totalRetiroAhorro = 0,
    totalGastoDesdeAhorro = 0,
    desglose,
  } = resumen;
  const totalAhorro = calcularAhorro(desglose);
  const totalGastos = totalEgresos - totalAhorro; // egresos SIN ahorro (gasto de consumo)
  const disponible = saldoInicial + totalIngresos + totalRetiroAhorro;
  const saldoFinal = disponible - totalGastos - totalAhorro;
  const balanceMes = totalIngresos - totalEgresos; // flujo propio del mes, sin retiros
  // El ahorro neto del mes baja por las DOS salidas: lo retirado al bolsillo y
  // lo que se pagó directo con el ahorro.
  const ahorroNetoMes = totalAhorro - totalRetiroAhorro - totalGastoDesdeAhorro;
  const pct = (parte) => (totalIngresos > 0 ? redondear1((parte / totalIngresos) * 100) : 0);

  return {
    saldoInicial,   // dinero traído del mes anterior (NO es ingreso)
    totalIngresos,  // ingresos propios del mes (sin saldo inicial, sin retiros)
    totalRetiroAhorro, // sacado del ahorro este mes
    totalGastoDesdeAhorro, // gastado pagando DIRECTO con el ahorro
    disponible,     // saldoInicial + ingresos + retiros
    totalGastos,    // egresos sin ahorro, solo lo pagado con plata del mes
    // Todo el consumo del mes, venga de donde venga. Es el número para "¿en qué
    // se me fue la plata este mes?"; `totalGastos` es el que mueve el saldo.
    gastoTotalConAhorro: totalGastos + totalGastoDesdeAhorro,
    totalAhorro,    // ahorro apartado ESTE mes (BRUTO)
    ahorroNetoMes,  // totalAhorro − retiros − gastos pagados con ahorro
    totalEgresos,   // gastos + ahorro (compat con lo anterior)
    saldoFinal,     // saldo con el que se cierra el mes (plata a mano)
    balance: saldoFinal, // el "Balance del mes" ahora usa el saldo inicial
    balanceMes,     // ingresos − egresos: lo que el mes generó por sí solo
    variacionSaldo: balanceMes + totalRetiroAhorro, // saldoFinal − saldoInicial
    // "Puedo gastar hasta": techo sin tocar lo que se traía NI el ahorro.
    libreParaGastar: balanceMes,
    ahorroAcumulado, // TOTAL apartado hasta hoy, ya NETO (con el saldo de apertura)
    patrimonio: saldoFinal + ahorroAcumulado, // a mano + apartado
    tasaAhorro: pct(ahorroNetoMes),      // sobre el ahorro NETO (la que vale)
    tasaAhorroBruta: pct(totalAhorro),   // sobre lo apartado, para el hábito
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

    // Snapshots al día (solo la 1ª vez por proceso; después no hace nada).
    await asegurarSnapshots(req.user.id);

    const [snap, acum] = await Promise.all([
      leerResumenMes(req.user.id, mes, anio),
      calcularAcumulados(req.user.id, mes, anio),
    ]);

    res.status(200).json({
      mes,
      anio,
      ...componerFinanzasMes(comoResumen(snap), acum.saldoInicial, acum.ahorroAcumulado),
      // Cuánto había ahorrado al EMPEZAR el mes. Con esto el frontend puede
      // dibujar el ahorro como una escalera que cierra sola:
      //   ahorroInicial + totalAhorro − totalRetiroAhorro − totalGastoDesdeAhorro
      //   = ahorroAcumulado
      // (el equivalente de saldoInicial, pero para el bolsillo del ahorro).
      ahorroInicial: acum.ahorroPrevio,
      apertura: acum.apertura
        ? {
            montoDisponible: acum.apertura.montoDisponible || 0,
            montoAhorro: acum.apertura.montoAhorro || 0,
            mesCorte: acum.apertura.mesCorte,
            anioCorte: acum.apertura.anioCorte,
            vigente: aperturaVigente(acum.apertura, anio, mes),
          }
        : null,
    });
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

// "Supermercado ₡41.775, Transporte ₡12.000" (de mayor a menor)
const listarFilas = (filas) =>
  filas
    .slice()
    .sort((a, b) => b.total - a.total)
    .map((f) => `${f.categoria} ${fmtCRC(f.total)}`)
    .join(', ');

// Orden en que se muestran los mensajes: primero lo que hay que atender.
const PRIORIDAD_NIVEL = { critico: 0, advertencia: 1, consejo: 2, bien: 3, info: 4 };

// Pocos mensajes y que valgan: solo los 5 más importantes del mes. Se generan
// todos los avisos posibles, se ordenan por urgencia y se muestran los primeros.
// Eran 4, pero con eso el aviso del colchón de emergencia (🛟) —de los más
// útiles— se caía casi siempre detrás de las comparaciones contra el mes anterior.
const MAX_RECOMENDACIONES = 5;

// El reporte anual se abre a propósito (no es la pantalla de todos los días), así
// que aguanta un par de mensajes más que la vista del mes.
const MAX_RECOMENDACIONES_ANUALES = 6;

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
const construirRecomendaciones = ({ actual, previo, saldoInicial = 0, ahorroAcumulado = 0, gastoPromedio = null, mes, anio }) => {
  const recs = [];
  const add = (nivel, icono, mensaje) => recs.push({ nivel, icono, mensaje });

  // --- Números del mes actual (el ahorro se separa: es dinero apartado, no gasto)
  const fin = componerFinanzasMes(actual, saldoInicial, ahorroAcumulado);
  const { totalIngresos, totalGastos, totalAhorro, totalEgresos, saldoFinal } = fin;
  const totalRetiroAhorro = fin.totalRetiroAhorro;
  const totalGastoDesdeAhorro = fin.totalGastoDesdeAhorro;
  const ahorroNetoMes = fin.ahorroNetoMes; // apartado − retirado − pagado con ahorro
  const filasAhorro = actual.desglose.egreso.filter((e) => esAhorro(e.categoria));
  const filasGasto = actual.desglose.egreso.filter((e) => !esAhorro(e.categoria));
  const filasGastoAhorro = actual.desglose.gastoAhorro || [];

  // --- Números del mes anterior (para comparar)
  const filasGastoPrevio = (previo.desglose?.egreso || []).filter((e) => !esAhorro(e.categoria));
  const ahorroBrutoPrevio = calcularAhorro(previo.desglose || { egreso: [] });
  const ahorroPrevio =
    ahorroBrutoPrevio - (previo.totalRetiroAhorro || 0) - (previo.totalGastoDesdeAhorro || 0); // neto, para comparar peras con peras
  const gastoPrevio = previo.totalEgresos - ahorroBrutoPrevio;
  const ingresoPrevio = previo.totalIngresos;
  const hayMesPrevio = ingresoPrevio > 0 || previo.totalEgresos > 0;
  const nombrePrevio = NOMBRES_MES[(mes === 1 ? 12 : mes - 1) - 1];

  // Sin movimientos: no hay nada que analizar todavía.
  if (
    totalIngresos === 0 &&
    totalEgresos === 0 &&
    totalRetiroAhorro === 0 &&
    totalGastoDesdeAhorro === 0
  ) {
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

  // --- 1) ¿El mes se pagó solo o se financió con plata de antes?
  // `flujo` es lo que entró menos TODO lo que salió (gastos + ahorro), sin contar
  // el saldo inicial ni los retiros del ahorro: mide si el mes se sostuvo por sí
  // mismo. Es el mismo número que la tarjeta "Puedo gastar hasta"
  // (fin.libreParaGastar), así que se toma de ahí para que el aviso y la tarjeta
  // nunca se contradigan.
  const flujo = fin.libreParaGastar;
  if (totalIngresos === 0 && totalGastos > 0) {
    add('advertencia', '❓', `Registraste ${fmtCRC(totalGastos)} en gastos y ningún ingreso este mes. Si te falta anotar el salario, todos los porcentajes de abajo van a salir mal.`);
  } else if (totalGastos > totalIngresos) {
    // Lo que sale del saldo viejo es |flujo| (gastos Y ahorro), no solo el
    // sobregiro de gasto: si se apartó ahorro hay que sumarlo o el monto no
    // cuadra con la tarjeta "Puedo gastar hasta".
    const sobregiro = totalGastos - totalIngresos;
    if (totalRetiroAhorro > 0) {
      // El hueco NO se tapó con el saldo viejo: se tapó sacando del ahorro (del
      // todo o en parte). Decir otra cosa sería falso.
      const resto = sobregiro - totalRetiroAhorro;
      add('critico', '🚨', resto > 0
        ? `Alerta: los gastos del mes pasaron lo que entró por ${fmtCRC(sobregiro)}. Sacaste ${fmtCRC(totalRetiroAhorro)} del ahorro para cubrirlo y los otros ${fmtCRC(resto)} salieron del saldo que traías.`
        : `Alerta: los gastos del mes pasaron lo que entró por ${fmtCRC(sobregiro)}, y lo tapaste sacando ${fmtCRC(totalRetiroAhorro)} del ahorro. Tu acumulado bajó a ${fmtCRC(ahorroAcumulado)}: el mes se financió con plata vieja, no con dinero nuevo.`);
    } else {
      add('critico', '🚨', totalAhorro > 0
        ? `Alerta: los gastos del mes pasaron lo que entró por ${fmtCRC(sobregiro)}, y encima apartaste ${fmtCRC(totalAhorro)} de ahorro. En total le sacaste ${fmtCRC(Math.abs(flujo))} al saldo de meses anteriores, no lo tapaste con dinero nuevo.`
        : `Alerta: los gastos del mes pasaron lo que entró por ${fmtCRC(sobregiro)}. Ese hueco lo estás tapando con el saldo de meses anteriores, no con dinero nuevo.`);
    }
  } else if (flujo < 0) {
    add('advertencia', '🏦', `Para apartar ${fmtCRC(totalAhorro)} de ahorro tuviste que sacar ${fmtCRC(Math.abs(flujo))} del saldo acumulado. Así el ahorro solo cambia de bolsillo: lo sano es que salga de lo que entra en el mes.`);
  } else if (totalIngresos > 0 && flujo < totalIngresos * 0.05) {
    add('advertencia', '😬', `${mesAMedias ? 'Vas al filo' : 'Cerraste al filo'}: de los ${fmtCRC(totalIngresos)} que entraron ${mesAMedias ? 'solo quedan' : 'solo sobraron'} ${fmtCRC(flujo)} libres después de gastos y ahorro. Un imprevisto te deja en rojo.`);
  } else if (flujo > 0) {
    add('bien', '✅', `${mesAMedias ? 'Por ahora el mes va sano' : 'Mes sano'}: lo que entró alcanzó para los gastos y el ahorro, y ${mesAMedias ? 'quedan' : 'todavía sobraron'} ${fmtCRC(flujo)} libres. Tu saldo pasó de ${fmtCRC(saldoInicial)} a ${fmtCRC(saldoFinal)}.`);
  }

  // --- 1b) Retiro del ahorro sin que el mes lo necesitara para cubrirse.
  // (Si hubo sobregiro, el aviso 🚨 de arriba ya contó esa historia.)
  if (totalRetiroAhorro > 0 && totalGastos <= totalIngresos) {
    if (totalIngresos === 0 && totalGastos === 0) {
      // El retiro es lo único que hay en el mes: no se puede opinar del flujo.
      add('info', '🏧', `Sacaste ${fmtCRC(totalRetiroAhorro)} del ahorro; el acumulado quedó en ${fmtCRC(ahorroAcumulado)}. Todavía no registraste los ingresos ni los gastos de este mes.`);
    } else if (ahorroNetoMes < 0) {
      add('advertencia', '🏧', `Sacaste ${fmtCRC(totalRetiroAhorro)} del ahorro y apartaste ${fmtCRC(totalAhorro)}: en neto tu ahorro bajó ${fmtCRC(Math.abs(ahorroNetoMes))} este mes y quedó en ${fmtCRC(ahorroAcumulado)}. El mes daba para cubrirse solo, así que vale revisar si ese retiro era necesario.`);
    } else if (ahorroNetoMes > 0) {
      add('info', '🏧', `Sacaste ${fmtCRC(totalRetiroAhorro)} del ahorro, pero apartaste ${fmtCRC(totalAhorro)}: igual quedó ${fmtCRC(ahorroNetoMes)} arriba y el acumulado cerró en ${fmtCRC(ahorroAcumulado)}.`);
    } else {
      add('info', '🏧', `Sacaste ${fmtCRC(totalRetiroAhorro)} del ahorro este mes; el acumulado quedó en ${fmtCRC(ahorroAcumulado)}. Como el mes cerró en positivo, podés reponerlo sin apretarte.`);
    }
  }

  // --- 1c) Gasto pagado DIRECTO con el ahorro. No movió nada del mes (por eso
  // ninguna tarjeta cambió), pero sí achicó el colchón: hay que decirlo, porque
  // es la única forma de que se note que esa plata ya no está.
  if (totalGastoDesdeAhorro > 0) {
    const detalle = filasGastoAhorro.length > 0 ? ` (${listarFilas(filasGastoAhorro)})` : '';
    const pesoSobreAhorro = totalAhorro > 0
      ? ` Este mes apartaste ${fmtCRC(totalAhorro)}, así que en neto tu ahorro ${
          ahorroNetoMes >= 0 ? `subió ${fmtCRC(ahorroNetoMes)}` : `bajó ${fmtCRC(Math.abs(ahorroNetoMes))}`
        }.`
      : '';
    // Nivel 'consejo' como mínimo (no 'info'): es lo que explica por qué las
    // tarjetas del mes no se movieron, así que no puede quedar cortado por el
    // tope de mensajes detrás de avisos menos importantes.
    add(ahorroNetoMes < 0 ? 'advertencia' : 'consejo', '🏦',
      `Pagaste ${fmtCRC(totalGastoDesdeAhorro)} directo con el ahorro${detalle}. No toca el saldo del mes —esa plata nunca pasó por tu bolsillo— pero tu acumulado quedó en ${fmtCRC(ahorroAcumulado)}.${pesoSobreAhorro}`);
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

  // --- 10) Ahorro: lo que interesa es la TASA y cómo se mueve, no el monto.
  // La tasa va sobre el ahorro NETO (apartado − retirado − pagado con ahorro):
  // apartar ₡100.000 y sacar ₡300.000 el mismo mes no es "ahorré 12%". Si hubo
  // retiro o gasto pagado con el ahorro, los avisos 🏧/🏦 ya contaron esa
  // historia con los dos números, así que este no se repite.
  if (totalIngresos > 0 && totalRetiroAhorro === 0 && totalGastoDesdeAhorro === 0) {
    const tasa = Math.round((ahorroNetoMes / totalIngresos) * 100);
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

  // --- 11) ¿Cuánto aguanta el dinero sin ingresos? (fondo de emergencia)
  // El colchón real son las DOS cosas: la plata a mano (saldoFinal) MÁS el
  // ahorro acumulado de todos los meses y del saldo de apertura. Se nombran por
  // separado para que se entienda qué parte hay que tocar si algo pasa: usar el
  // ahorro no es lo mismo que gastar lo que quedó del mes.
  // Referencia de gasto: el promedio de los meses anteriores; si no hay
  // historial, el de este mes.
  const gastoReferencia = gastoPromedio || fin.gastoTotalConAhorro;
  if (gastoReferencia > 0) {
    const colchon = saldoFinal + ahorroAcumulado; // = fin.patrimonio
    const mesesCubiertos = colchon / gastoReferencia;
    const metaColchon = gastoReferencia * 3;
    // "₡120.000 a mano + ₡945.000 ahorrados" (el desglose solo si hay ahorro).
    const detalle = ahorroAcumulado > 0
      ? `${fmtCRC(saldoFinal)} a mano + ${fmtCRC(ahorroAcumulado)} ahorrados`
      : `${fmtCRC(saldoFinal)} a mano`;

    if (colchon <= 0) {
      add('critico', '🛟', `No tenés colchón: entre lo que quedó a mano y lo ahorrado no hay nada (${fmtCRC(colchon)}). Cualquier imprevisto entra directo como deuda; la primera meta es juntar un mes de gastos (${fmtCRC(gastoReferencia)}).`);
    } else if (saldoFinal <= 0) {
      add('advertencia', '🛟', `Te quedás sin plata a mano (${fmtCRC(saldoFinal)}): tu colchón son los ${fmtCRC(ahorroAcumulado)} que tenés ahorrados, y alcanzan para ${mesesCubiertos.toFixed(1).replace('.', ',')} meses de gastos. Cualquier imprevisto ahora se paga rompiendo el ahorro.`);
    } else if (mesesCubiertos < 1) {
      add('advertencia', '🛟', `Tu colchón (${detalle}) cubre ${Math.round(mesesCubiertos * 30)} días de gastos. La meta son 3 meses: ${fmtCRC(metaColchon)}.`);
    } else if (mesesCubiertos < 3) {
      add('consejo', '🛟', `Con ${detalle} aguantarías ${mesesCubiertos.toFixed(1).replace('.', ',')} meses sin ingresos (gastás ~${fmtCRC(gastoReferencia)} al mes). Te faltan ${fmtCRC(metaColchon - colchon)} para el colchón de 3 meses.`);
    } else {
      add('bien', '🛟', `Tu colchón (${detalle}) cubre ${Math.floor(mesesCubiertos)} meses de gastos. Eso ya es un fondo de emergencia de verdad.`);
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

    await asegurarSnapshots(req.user.id);

    // Todo sale de snapshots ya sumados: no se recorren los movimientos.
    const [snapActual, snapPrevio, acum, gastoPromedio] = await Promise.all([
      leerResumenMes(req.user.id, mes, anio),
      leerResumenMes(req.user.id, mesPrevio, anioPrevio),
      calcularAcumulados(req.user.id, mes, anio),
      calcularGastoPromedioMensual(req.user.id, mes, anio),
    ]);

    const actual = comoResumen(snapActual);
    const previo = comoResumen(snapPrevio);
    const { saldoInicial, ahorroAcumulado } = acum;

    res.status(200).json({
      mes,
      anio,
      resumen: componerFinanzasMes(actual, saldoInicial, ahorroAcumulado),
      recomendaciones: construirRecomendaciones({
        actual,
        previo,
        saldoInicial,
        ahorroAcumulado,
        gastoPromedio,
        mes,
        anio,
      }),
    });
  } catch (error) {
    console.error('❌ Error al generar recomendaciones:', error);
    res.status(500).json({ message: 'Error al generar las recomendaciones', error: error.message });
  }
};

// ============================================
// GET /api/finanzas-personales/anios-disponibles
// Años con datos (para el selector del frontend y el botón del reporte anual).
// Sale de los snapshots mensuales (no de los movimientos) y siempre incluye el
// año actual, aunque todavía no se haya registrado nada.
// ============================================
export const getAniosDisponibles = async (req, res) => {
  try {
    await asegurarSnapshots(req.user.id);

    const [conSnapshot, apertura] = await Promise.all([
      ResumenPersonalMes.distinct('anio', { usuario: req.user.id }),
      leerApertura(req.user.id),
    ]);

    const anios = new Set(conSnapshot);
    anios.add(anioActualCR());
    // El año del que arranca la apertura también se puede consultar.
    if (apertura) anios.add(apertura.anioCorte);

    res.status(200).json({ anios: [...anios].sort((a, b) => b - a) });
  } catch (error) {
    console.error('❌ Error al obtener años disponibles:', error);
    res.status(500).json({ message: 'Error al obtener los años', error: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════
// SALDO DE APERTURA — lo que se traía de antes de usar el módulo
// ════════════════════════════════════════════════════════════════════

// ============================================
// GET /api/finanzas-personales/apertura
// Devuelve el saldo de apertura del usuario (o null si nunca lo registró).
// ============================================
export const getApertura = async (req, res) => {
  try {
    const apertura = await leerApertura(req.user.id);
    if (!apertura) {
      return res.status(200).json({ data: null });
    }
    res.status(200).json({
      data: {
        ...apertura,
        montoTotal: (apertura.montoDisponible || 0) + (apertura.montoAhorro || 0),
        nombreMesCorte: NOMBRES_MES_PERSONAL[apertura.mesCorte],
      },
    });
  } catch (error) {
    console.error('❌ Error al obtener el saldo de apertura:', error);
    res.status(500).json({ message: 'Error al obtener el saldo de apertura', error: error.message });
  }
};

// ============================================
// PUT /api/finanzas-personales/apertura
// Crea o actualiza el saldo de apertura (uno solo por usuario: se edita, no se
// acumula). Body: { montoDisponible?, montoAhorro?, mes, anio, descripcion? }
//
//   • montoAhorro     → plata YA APARTADA de meses anteriores. Va al Ahorro
//                       Acumulado y NO al saldo disponible (es dinero apartado,
//                       igual que la categoría Ahorro de cualquier mes).
//   • montoDisponible → plata A MANO al empezar. Suma al Saldo Inicial.
//   • mes/anio        → desde qué mes aplica (el primer mes que se lleva acá).
//
// Al menos uno de los dos montos debe ser > 0. NO crea ningún movimiento: no
// toca los ingresos ni los gastos de ningún mes, así que los mensajes
// inteligentes y las comparaciones mes contra mes quedan intactos.
// ============================================
export const guardarApertura = async (req, res) => {
  try {
    const mes = parseInt(req.body.mes);
    const anio = parseInt(req.body.anio);
    if (!mes || !anio || mes < 1 || mes > 12 || anio < 2000 || anio > 2100) {
      return res.status(400).json({
        message: 'mes (1-12) y anio son obligatorios: es el mes desde el que aplica el saldo de apertura',
      });
    }

    // No tiene sentido declarar un saldo de apertura a futuro.
    const cr = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }));
    if (ordinalMes(anio, mes) > ordinalMes(cr.getFullYear(), cr.getMonth() + 1)) {
      return res.status(400).json({ message: 'El mes de corte no puede ser futuro' });
    }

    const leerMonto = (valor, nombre) => {
      if (valor === undefined || valor === null || valor === '') return { monto: 0 };
      const n = Number(valor);
      if (isNaN(n) || n < 0) return { error: `${nombre} debe ser un número de 0 o más` };
      return { monto: Math.round(n) };
    };

    const disp = leerMonto(req.body.montoDisponible, 'montoDisponible');
    if (disp.error) return res.status(400).json({ message: disp.error });
    const ahor = leerMonto(req.body.montoAhorro, 'montoAhorro');
    if (ahor.error) return res.status(400).json({ message: ahor.error });

    if (disp.monto === 0 && ahor.monto === 0) {
      return res.status(400).json({
        message: 'Indicá al menos un monto: montoAhorro (lo que ya tenías apartado) o montoDisponible (lo que tenías a mano)',
      });
    }

    // Bajar el ahorro de la apertura (o mover el mes de corte hacia adelante)
    // puede dejar en negativo un retiro que ya usaba esa plata.
    await asegurarSnapshots(req.user.id);
    const problema = await validarAhorroNoNegativo(req.user.id, [], {
      montoAhorro: ahor.monto,
      mesCorte: mes,
      anioCorte: anio,
    });
    if (problema) {
      const donde = `${NOMBRES_MES[problema.mes - 1]} ${problema.anio}`;
      // El ahorro de la apertura solo cuenta desde el mes de corte, así que solo
      // se puede dar un mínimo exacto si el mes que falla es el de corte o posterior.
      const aplicaMinimo = ordinalMes(problema.anio, problema.mes) >= ordinalMes(anio, mes);
      const minimo = ahor.monto + problema.exceso;
      return res.status(400).json({
        message: aplicaMinimo
          ? `El ahorro de la apertura no puede bajar de ${fmtCRC(minimo)}: ya hay retiros que usaban esa plata y el acumulado quedaría en negativo en ${donde}.`
          : `Con ese mes de corte el ahorro acumulado quedaría en negativo en ${donde}: hay retiros anteriores al corte que no tendrían de dónde salir.`,
        ...(aplicaMinimo && { minimo }),
        acumulado: problema.disponible,
      });
    }

    // Último instante ANTES del mes de corte (día 1 a medianoche CR, menos 1 ms).
    const fechaCorte = new Date(Date.UTC(anio, mes - 1, 1, 6, 0, 0, 0) - 1);

    const apertura = await AperturaPersonal.findOneAndUpdate(
      { usuario: req.user.id },
      {
        $set: {
          usuario: req.user.id,
          montoDisponible: disp.monto,
          montoAhorro: ahor.monto,
          mesCorte: mes,
          anioCorte: anio,
          fechaCorte,
          descripcion: req.body.descripcion?.trim() || null,
        },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({
      message: `Saldo de apertura guardado (vigente desde ${NOMBRES_MES_PERSONAL[mes]} ${anio})`,
      data: apertura,
    });
  } catch (error) {
    console.error('❌ Error al guardar el saldo de apertura:', error);
    res.status(500).json({ message: 'Error al guardar el saldo de apertura', error: error.message });
  }
};

// ============================================
// DELETE /api/finanzas-personales/apertura — Borra el saldo de apertura.
// No borra ningún movimiento (la apertura nunca fue uno).
// ============================================
export const deleteApertura = async (req, res) => {
  try {
    const existe = await leerApertura(req.user.id);
    if (!existe) {
      return res.status(404).json({ message: 'No tenías un saldo de apertura registrado' });
    }

    // Si hay retiros que usaban el ahorro de la apertura, borrarla lo dejaría negativo.
    if (existe.montoAhorro > 0) {
      await asegurarSnapshots(req.user.id);
      const problema = await validarAhorroNoNegativo(req.user.id, [], null);
      if (problema) {
        return res.status(400).json({
          message: `No se puede borrar el saldo de apertura: ya retiraste parte de ese ahorro. ${problema.mensaje}`,
          disponible: problema.disponible,
        });
      }
    }

    const borrada = await AperturaPersonal.findOneAndDelete({ usuario: req.user.id });
    if (!borrada) {
      return res.status(404).json({ message: 'No tenías un saldo de apertura registrado' });
    }
    res.status(200).json({ message: 'Saldo de apertura eliminado' });
  } catch (error) {
    console.error('❌ Error al eliminar el saldo de apertura:', error);
    res.status(500).json({ message: 'Error al eliminar el saldo de apertura', error: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════
// REPORTE ANUAL
// ════════════════════════════════════════════════════════════════════

// Une los desgloses por categoría de varios meses en uno solo del año.
// Devuelve filas { categoria, total, cantidad, porcentaje } de mayor a menor.
const unirDesglose = (filasPorMes) => {
  const mapa = new Map();
  for (const fila of filasPorMes) {
    const acc = mapa.get(fila.categoria) || { categoria: fila.categoria, total: 0, cantidad: 0 };
    acc.total += fila.total || 0;
    acc.cantidad += fila.cantidad || 0;
    mapa.set(fila.categoria, acc);
  }
  const filas = [...mapa.values()].sort((a, b) => b.total - a.total);
  const total = filas.reduce((s, f) => s + f.total, 0);
  return filas.map((f) => ({
    ...f,
    porcentaje: total > 0 ? Math.round((f.total / total) * 1000) / 10 : 0,
  }));
};

// ============================================
// Mensajes inteligentes del AÑO. Misma idea que los del mes, pero mirando el año
// completo: si el saldo creció o se achicó, cuántos meses cerraron en rojo, qué
// categoría se llevó la plata, cómo viene contra el año pasado y si el colchón
// alcanza. No repiten los números que ya se ven en las tarjetas.
// ============================================
const construirRecomendacionesAnuales = ({
  anio,
  totales,
  saldoInicialAnio,
  saldoFinalAnio,
  ahorroFinalAnio,
  meses,
  desgloseGasto,
  comparativo,
  enCurso,
  mesesConMovimiento,
}) => {
  const recs = [];
  const add = (nivel, icono, mensaje) => recs.push({ nivel, icono, mensaje });

  if (mesesConMovimiento === 0) {
    add('info', '📝', `No hay movimientos registrados en ${anio}. Registrá tus ingresos y gastos para ver el reporte del año.`);
    return recs;
  }

  const { totalIngresos, totalGastos, totalAhorro } = totales;
  const totalRetiroAhorro = totales.totalRetiroAhorro || 0;
  const totalGastoDesdeAhorro = totales.totalGastoDesdeAhorro || 0;
  // Las dos formas de sacarle plata al ahorro: retirarla al bolsillo o pagar
  // directo con ella. Para el ahorro del año pesan igual.
  const salidasAhorro = totalRetiroAhorro + totalGastoDesdeAhorro;
  const ahorroNeto = totales.ahorroNeto ?? totalAhorro;
  const conMov = meses.filter((m) => m.movimientos > 0);
  const promedioGasto = Math.round(totalGastos / mesesConMovimiento);

  // --- 1) Resultado del año: ¿el saldo creció o se achicó?
  const difSaldo = saldoFinalAnio - saldoInicialAnio;
  const enRojo = conMov.filter((m) => m.balanceMes < 0);
  // Con retiros de por medio, hablar del ahorro apartado (bruto) engañaría: lo
  // que importa es cuánto subió o bajó el ahorro en el año.
  const frasAhorro = salidasAhorro > 0
    ? `tu ahorro ${ahorroNeto >= 0 ? `subió ${fmtCRC(ahorroNeto)}` : `bajó ${fmtCRC(Math.abs(ahorroNeto))}`} en neto (apartaste ${fmtCRC(totalAhorro)} y le sacaste ${fmtCRC(salidasAhorro)})`
    : `apartaste ${fmtCRC(totalAhorro)} de ahorro`;

  if (difSaldo > 0) {
    add('bien', '📅', `${enCurso ? `${anio} va bien` : `Cerraste ${anio} mejor de lo que lo arrancaste`}: tu saldo pasó de ${fmtCRC(saldoInicialAnio)} a ${fmtCRC(saldoFinalAnio)} (${fmtCRC(difSaldo)} más), y ${frasAhorro}.`);
  } else if (difSaldo < 0) {
    add('advertencia', '📅', `En ${anio} tu saldo bajó ${fmtCRC(Math.abs(difSaldo))} (de ${fmtCRC(saldoInicialAnio)} a ${fmtCRC(saldoFinalAnio)}): en el año salió más de lo que entró. Si el ahorro (${fmtCRC(totalAhorro)}) explica la baja, es plata que cambió de bolsillo; si no, se consumió el colchón.`);
  }

  // --- 1b) Plata que salió del ahorro en el año (retirada o gastada directo)
  if (salidasAhorro > 0) {
    const mesesConSalida = conMov.filter(
      (m) => (m.totalRetiroAhorro || 0) + (m.totalGastoDesdeAhorro || 0) > 0
    );
    const cuales = mesesConSalida.map((m) => m.nombreMes).join(', ');
    // Se detalla el desglose solo si hubo de las dos clases: si no, repetir el
    // mismo número dos veces confunde más de lo que aclara.
    const comoSalio = totalRetiroAhorro > 0 && totalGastoDesdeAhorro > 0
      ? ` (${fmtCRC(totalRetiroAhorro)} retirados y ${fmtCRC(totalGastoDesdeAhorro)} pagados directo con el ahorro)`
      : '';
    add(ahorroNeto < 0 ? 'advertencia' : 'info', '🏧', ahorroNeto < 0
      ? `En ${anio} le sacaste ${fmtCRC(salidasAhorro)} al ahorro${comoSalio} en ${cuales}, y apartaste ${fmtCRC(totalAhorro)}: en el año tu ahorro bajó ${fmtCRC(Math.abs(ahorroNeto))}. Cerrás con ${fmtCRC(ahorroFinalAnio)} acumulados.`
      : `En ${anio} le sacaste ${fmtCRC(salidasAhorro)} al ahorro${comoSalio} en ${cuales}, pero apartaste ${fmtCRC(totalAhorro)}: igual terminás ${fmtCRC(ahorroNeto)} arriba, con ${fmtCRC(ahorroFinalAnio)} acumulados.`);
  }

  // --- 2) Meses en rojo: el patrón que no se ve en el total del año
  if (enRojo.length > 0) {
    const cuales = enRojo.map((m) => m.nombreMes).join(', ');
    const peor = enRojo.reduce((a, b) => (a.balanceMes <= b.balanceMes ? a : b));
    add(enRojo.length >= 3 ? 'critico' : 'advertencia', '🚨', `${enRojo.length} de ${mesesConMovimiento} ${enRojo.length === 1 ? 'mes cerró' : 'meses cerraron'} gastando más de lo que entró (${cuales}). El peor fue ${peor.nombreMes} con ${fmtCRC(peor.balanceMes)}. Esos son los meses que hay que mirar para que no se repitan.`);
  }

  // --- 3) Tasa de ahorro del año, sobre el ahorro NETO (apartado − retirado):
  // si se sacó casi todo lo que se apartó, la tasa bruta contaría un cuento.
  if (totalIngresos > 0) {
    const tasa = Math.round((ahorroNeto / totalIngresos) * 100);
    const meta = Math.round(totalIngresos * 0.1);
    if (ahorroNeto <= 0) {
      add('consejo', '💰', totalAhorro > 0
        ? `En ${anio} el ahorro no creció: apartaste ${fmtCRC(totalAhorro)} pero le sacaste ${fmtCRC(salidasAhorro)}. Con el 10% de lo que entró habrías juntado ${fmtCRC(meta)}.`
        : `En ${anio} no apartaste nada de ahorro sobre ${fmtCRC(totalIngresos)} de ingresos. Con el 10% habrías juntado ${fmtCRC(meta)}.`);
    } else if (tasa < 10) {
      add('consejo', '💰', `Tu ahorro creció ${fmtCRC(ahorroNeto)} en el año: el ${tasa}% de lo que entró. Para llegar al 10% te faltaron ${fmtCRC(meta - ahorroNeto)}. Sale más fácil apartando ${fmtCRC(Math.round(meta / 12))} por mes que de golpe.`);
    } else {
      add('bien', '💰', `Tu ahorro creció ${fmtCRC(ahorroNeto)} en ${anio}, el ${tasa}% de tus ingresos${enCurso ? ' hasta ahora' : ''}. Con ese ritmo son ${fmtCRC(Math.round((ahorroNeto / mesesConMovimiento) * 12))} por año.`);
    }
  }

  // --- 4) La categoría que se llevó el año
  if (desgloseGasto.length > 0 && totalGastos > 0) {
    const top = desgloseGasto[0];
    const porMes = Math.round(top.total / mesesConMovimiento);
    add(top.porcentaje >= 30 ? 'advertencia' : 'info', '🎯', `Lo que más te costó en ${anio}: ${top.categoria}, ${fmtCRC(top.total)} (${top.porcentaje}% de todos tus gastos, ~${fmtCRC(porMes)} por mes). Recortar un 10% ahí son ${fmtCRC(Math.round(top.total * 0.1))} al año.`);
  }

  // --- 5) Gastos fijos del año (la parte que no se puede mover)
  const totalFijos = desgloseGasto
    .filter((f) => CATEGORIAS_FIJAS.includes(f.categoria))
    .reduce((s, f) => s + f.total, 0);
  if (totalFijos > 0 && totalIngresos > 0) {
    const pct = Math.round((totalFijos / totalIngresos) * 100);
    if (pct >= 35) {
      add(pct >= 50 ? 'advertencia' : 'info', '🧱', `Los gastos fijos del año (alquiler, servicios, internet, seguros, cuota del banco, suscripciones) fueron ${fmtCRC(totalFijos)}: el ${pct}% de todo lo que entró. Es la parte que sigue llegando aunque los ingresos bajen.`);
    }
  }

  // --- 6) Deudas del año
  const totalDeuda = desgloseGasto
    .filter((f) => CATEGORIAS_DEUDA.includes(f.categoria))
    .reduce((s, f) => s + f.total, 0);
  if (totalDeuda > 0 && totalIngresos > 0) {
    const pct = Math.round((totalDeuda / totalIngresos) * 100);
    if (pct >= 15) {
      add(pct >= 30 ? 'critico' : 'advertencia', '💳', `En ${anio} pagaste ${fmtCRC(totalDeuda)} en deudas: el ${pct}% de tus ingresos del año (~${fmtCRC(Math.round(totalDeuda / mesesConMovimiento))} por mes). Arriba del 30% del ingreso es zona de riesgo.`);
    }
  }

  // --- 7) Comparación con el año anterior
  if (comparativo) {
    const partes = [];
    const linea = (etiqueta, ahora, antes) => {
      if (antes <= 0) return;
      const dif = ahora - antes;
      const pct = Math.round((Math.abs(dif) / antes) * 100);
      if (pct < 5) return;
      partes.push(`${etiqueta} ${dif > 0 ? 'subieron' : 'bajaron'} ${pct}%`);
    };
    linea('los ingresos', totalIngresos, comparativo.totalIngresos);
    linea('los gastos', totalGastos, comparativo.totalGastos);
    linea('el ahorro', totalAhorro, comparativo.totalAhorro);
    if (partes.length > 0) {
      const aviso = enCurso
        ? ` Ojo: ${anio} va en ${mesesConMovimiento} ${mesesConMovimiento === 1 ? 'mes' : 'meses'} contra los ${comparativo.mesesConMovimiento} de ${anio - 1}, así que todavía no es comparable de igual a igual.`
        : '';
      add('info', '↔️', `Contra ${anio - 1}: ${partes.join(', ')}.${aviso}`);
    }
  }

  // --- 8) Mes más caro vs. el promedio del año
  if (conMov.length >= 3 && promedioGasto > 0) {
    const caro = conMov.reduce((a, b) => (a.totalGastos >= b.totalGastos ? a : b));
    const exceso = caro.totalGastos - promedioGasto;
    if (exceso > promedioGasto * 0.3) {
      const pct = Math.round((exceso / promedioGasto) * 100);
      add('info', '📌', `${caro.nombreMes} fue tu mes más caro: ${fmtCRC(caro.totalGastos)}, un ${pct}% arriba de tu promedio (${fmtCRC(promedioGasto)}). Vale revisar qué pasó ese mes para no repetirlo.`);
    }
  }

  // --- 9) Colchón al cierre del año (a mano + apartado)
  if (promedioGasto > 0) {
    const colchon = saldoFinalAnio + ahorroFinalAnio;
    const mesesCubiertos = colchon / promedioGasto;
    const detalle = ahorroFinalAnio > 0
      ? `${fmtCRC(saldoFinalAnio)} a mano + ${fmtCRC(ahorroFinalAnio)} ahorrados`
      : `${fmtCRC(saldoFinalAnio)} a mano`;
    if (mesesCubiertos >= 3) {
      add('bien', '🛟', `${enCurso ? 'Hoy' : `Al cerrar ${anio}`} tenés ${detalle}: ${Math.floor(mesesCubiertos)} meses de gastos cubiertos (gastás ~${fmtCRC(promedioGasto)} al mes). Ese es un fondo de emergencia de verdad.`);
    } else if (colchon > 0) {
      add('consejo', '🛟', `${enCurso ? 'Hoy' : `Al cerrar ${anio}`} tu colchón es ${detalle}: ${mesesCubiertos.toFixed(1).replace('.', ',')} meses de gastos. Para llegar a los 3 meses recomendados te faltan ${fmtCRC(promedioGasto * 3 - colchon)}.`);
    }
  }

  return recs
    .sort((a, b) => PRIORIDAD_NIVEL[a.nivel] - PRIORIDAD_NIVEL[b.nivel])
    .slice(0, MAX_RECOMENDACIONES_ANUALES);
};

// ============================================
// GET /api/finanzas-personales/resumen-anual?anio=2026
// Reporte del AÑO completo. Barato: una sola consulta trae los snapshots del año
// y del anterior (máximo 24 documentos chiquitos) y todo lo demás se calcula en
// memoria. No recorre los movimientos ni una vez.
//
// Devuelve:
//   totales        → ingresos, gastos, ahorro, egresos y balance del año
//   saldoInicialAnio / saldoFinalAnio / ahorroInicioAnio / ahorroFinalAnio
//   apertura       → si el saldo de apertura cae DENTRO de este año, se muestra
//                    como línea aparte para que los números cuadren:
//                    saldoFinal = saldoInicial + apertura + ingresos − egresos
//   meses[12]      → fila por mes (para la tabla y el gráfico), con el saldo
//                    arrastrado mes a mes
//   desglose       → por categoría del año: ingreso, gasto (sin ahorro) y ahorro
//   promedios, destacados, comparativo (año anterior) y mensajes del año
// ============================================
export const getResumenAnual = async (req, res) => {
  try {
    const anio = parseInt(req.query.anio);
    if (!anio || anio < 2000 || anio > 2100) {
      return res.status(400).json({ message: 'El parámetro anio es obligatorio. Ej: ?anio=2026' });
    }

    await asegurarSnapshots(req.user.id);

    // UNA consulta para el año y el anterior (≤24 docs) + los acumulados al 1 de enero.
    const [snapshots, acum] = await Promise.all([
      ResumenPersonalMes.find({ usuario: req.user.id, anio: { $in: [anio - 1, anio] } })
        .sort({ anio: 1, mes: 1 })
        .lean(),
      calcularAcumulados(req.user.id, 1, anio),
    ]);

    const delAnio = snapshots.filter((s) => s.anio === anio);
    const delPrevio = snapshots.filter((s) => s.anio === anio - 1);
    const porMes = new Map(delAnio.map((s) => [s.mes, s]));

    const saldoInicialAnio = acum.saldoInicial;   // saldo al 1 de enero
    const ahorroInicioAnio = acum.ahorroPrevio;   // ahorro apartado al 1 de enero
    const apertura = acum.apertura;
    // ¿El saldo de apertura arranca DENTRO de este año? Entonces entra como una
    // línea propia en el mes de corte (y no está en saldoInicialAnio).
    //
    // OJO con enero: `calcularAcumulados(1, anio)` ya considera vigente una
    // apertura con corte en enero de ESTE año (su ordinal no es mayor al de
    // enero), así que ya viene sumada en saldoInicialAnio/ahorroInicioAnio.
    // Volver a aplicarla en el recorrido mes a mes la contaba DOS veces e
    // inflaba el año entero.
    const aperturaEnElAnio =
      apertura && apertura.anioCorte === anio && apertura.mesCorte > 1 ? apertura : null;

    // ── Tabla mes por mes, arrastrando el saldo y el ahorro acumulado ──
    let saldo = saldoInicialAnio;
    let ahorroAcum = ahorroInicioAnio;
    const meses = [];

    for (let mes = 1; mes <= 12; mes++) {
      const snap = porMes.get(mes) || mesVacio(mes, anio);

      // El saldo de apertura entra ANTES de los movimientos de su mes de corte.
      const aplicaApertura = !!aperturaEnElAnio && aperturaEnElAnio.mesCorte === mes;
      if (aplicaApertura) {
        saldo += aperturaEnElAnio.montoDisponible || 0;
        ahorroAcum += aperturaEnElAnio.montoAhorro || 0;
      }

      const saldoInicialMes = saldo;
      const retiro = snap.totalRetiroAhorro || 0;
      const gastoAhorro = snap.totalGastoDesdeAhorro || 0;
      // Un retiro devuelve plata al bolsillo: sube el saldo y baja el acumulado.
      // Un gasto pagado con el ahorro solo baja el acumulado: nunca tocó el saldo.
      saldo += snap.balanceMes + retiro;
      ahorroAcum += snap.totalAhorro - retiro - gastoAhorro;

      meses.push({
        anio,
        mes,
        nombreMes: NOMBRES_MES_PERSONAL[mes],
        totalIngresos: snap.totalIngresos,
        totalGastos: snap.totalGastos,
        totalAhorro: snap.totalAhorro,       // apartado en el mes (BRUTO)
        totalRetiroAhorro: retiro,
        totalGastoDesdeAhorro: gastoAhorro,
        gastoTotalConAhorro: snap.totalGastos + gastoAhorro,
        ahorroNetoMes: snap.totalAhorro - retiro - gastoAhorro,
        totalEgresos: snap.totalEgresos,
        balanceMes: snap.balanceMes,          // ingresos − egresos (sin retiros)
        variacionSaldo: snap.balanceMes + retiro, // saldoFinal − saldoInicial
        saldoInicial: saldoInicialMes,
        saldoFinal: saldo,
        ahorroAcumulado: ahorroAcum,          // NETO al cierre del mes
        movimientos: snap.movimientos,
        aperturaAplicada: aplicaApertura,
        registrado: snap.movimientos > 0,
      });
    }

    const saldoFinalAnio = saldo;
    const ahorroFinalAnio = ahorroAcum;

    // ── Totales del año ──
    const sumar = (filas, campo) => filas.reduce((s, f) => s + (f[campo] || 0), 0);
    const totales = {
      totalIngresos: sumar(delAnio, 'totalIngresos'),
      totalGastos: sumar(delAnio, 'totalGastos'),
      totalAhorro: sumar(delAnio, 'totalAhorro'),        // apartado en el año (BRUTO)
      totalRetiroAhorro: sumar(delAnio, 'totalRetiroAhorro'),
      totalGastoDesdeAhorro: sumar(delAnio, 'totalGastoDesdeAhorro'),
      totalEgresos: sumar(delAnio, 'totalEgresos'),
      movimientos: sumar(delAnio, 'movimientos'),
    };
    // Todo el consumo del año, venga del mes o del ahorro.
    totales.gastoTotalConAhorro = totales.totalGastos + totales.totalGastoDesdeAhorro;
    totales.ahorroNeto =
      totales.totalAhorro - totales.totalRetiroAhorro - totales.totalGastoDesdeAhorro;
    totales.balance = totales.totalIngresos - totales.totalEgresos; // flujo propio, SIN retiros
    // Cuánto se movió la plata a mano en el año (esto es lo que cierra la
    // identidad del recorrido del saldo, ver más abajo).
    totales.variacionSaldo = totales.balance + totales.totalRetiroAhorro;
    const pctAnio = (parte) =>
      totales.totalIngresos > 0 ? redondear1((parte / totales.totalIngresos) * 100) : 0;
    totales.tasaAhorro = pctAnio(totales.ahorroNeto);      // NETA (la que vale)
    totales.tasaAhorroBruta = pctAnio(totales.totalAhorro); // sobre lo apartado

    // ── Desglose por categoría del año ──
    const filasEgreso = delAnio.flatMap((s) => s.desgloseEgreso || []);
    const desglose = {
      ingreso: unirDesglose(delAnio.flatMap((s) => s.desgloseIngreso || [])),
      gasto: unirDesglose(filasEgreso.filter((f) => !esAhorro(f.categoria))),
      ahorro: unirDesglose(filasEgreso.filter((f) => esAhorro(f.categoria))),
      // Retiros aparte: si fueran gasto, la dona de consumo contaría como plata
      // gastada algo que solo cambió de bolsillo.
      retiro: unirDesglose(delAnio.flatMap((s) => s.desgloseRetiro || [])),
      // Lo pagado directo con el ahorro: en qué se fue y de cuál bolsa salió.
      // Aparte de `gasto` porque no salió de la plata del año.
      gastoAhorro: unirDesglose(delAnio.flatMap((s) => s.desgloseGastoAhorro || [])),
      gastoAhorroPorBolsa: unirDesglose(
        delAnio.flatMap((s) => s.desgloseGastoAhorroPorBolsa || [])
      ),
    };

    // ── Promedios (solo sobre los meses con movimientos: un mes vacío no diluye) ──
    const conMov = meses.filter((m) => m.movimientos > 0);
    const mesesConMovimiento = conMov.length;
    const prom = (total) => (mesesConMovimiento > 0 ? Math.round(total / mesesConMovimiento) : 0);
    const promedios = {
      mesesConMovimiento,
      ingresos: prom(totales.totalIngresos),
      gastos: prom(totales.totalGastos),
      ahorro: prom(totales.totalAhorro),
    };

    // ── Destacados ──
    const mejor = (campo, mayor = true) => {
      if (conMov.length === 0) return null;
      const m = conMov.reduce((a, b) => ((mayor ? a[campo] >= b[campo] : a[campo] <= b[campo]) ? a : b));
      return { mes: m.mes, nombreMes: m.nombreMes, monto: m[campo] };
    };
    const destacados = {
      mejorMes: mejor('balanceMes', true),
      peorMes: mejor('balanceMes', false),
      mesMasCaro: mejor('totalGastos', true),
      mesMasIngresos: mejor('totalIngresos', true),
      mesMasAhorro: mejor('totalAhorro', true),
      mesMasRetiro: totales.totalRetiroAhorro > 0 ? mejor('totalRetiroAhorro', true) : null,
      mesMasGastoDesdeAhorro:
        totales.totalGastoDesdeAhorro > 0 ? mejor('totalGastoDesdeAhorro', true) : null,
      categoriaTopGasto: desglose.gasto[0] || null,
      mesesEnRojo: conMov.filter((m) => m.balanceMes < 0).map((m) => ({
        mes: m.mes,
        nombreMes: m.nombreMes,
        balanceMes: m.balanceMes,
      })),
    };

    // ── Comparativo con el año anterior (del mismo find, sin consulta extra) ──
    let comparativo = null;
    if (delPrevio.length > 0) {
      const prevIngresos = sumar(delPrevio, 'totalIngresos');
      const prevGastos = sumar(delPrevio, 'totalGastos');
      const prevAhorro = sumar(delPrevio, 'totalAhorro');
      const prevRetiro = sumar(delPrevio, 'totalRetiroAhorro');
      const prevGastoAhorro = sumar(delPrevio, 'totalGastoDesdeAhorro');
      const prevAhorroNeto = prevAhorro - prevRetiro - prevGastoAhorro;
      const prevEgresos = sumar(delPrevio, 'totalEgresos');
      const variacion = (ahora, antes) =>
        antes > 0 ? redondear1(((ahora - antes) / antes) * 100) : null;

      comparativo = {
        anio: anio - 1,
        totalIngresos: prevIngresos,
        totalGastos: prevGastos,
        totalAhorro: prevAhorro,
        totalRetiroAhorro: prevRetiro,
        totalGastoDesdeAhorro: prevGastoAhorro,
        gastoTotalConAhorro: prevGastos + prevGastoAhorro,
        ahorroNeto: prevAhorroNeto,
        totalEgresos: prevEgresos,
        balance: prevIngresos - prevEgresos,
        mesesConMovimiento: delPrevio.filter((s) => s.movimientos > 0).length,
        variacion: {
          ingresos: variacion(totales.totalIngresos, prevIngresos),
          gastos: variacion(totales.totalGastos, prevGastos),
          // Contra el ahorro NETO del año anterior (peras con peras).
          ahorro: variacion(totales.ahorroNeto, prevAhorroNeto),
        },
      };
    }

    const enCurso = anio === anioActualCR();

    res.status(200).json({
      anio,
      enCurso,
      totales,
      saldoInicialAnio,
      saldoFinalAnio,
      ahorroInicioAnio,
      ahorroFinalAnio,
      patrimonioFinal: saldoFinalAnio + ahorroFinalAnio, // a mano + apartado

      // "Recorrido del saldo": los cuatro términos que llevan del saldo inicial
      // al final, ya listos para pintar en fila. La identidad exacta es
      //   saldoInicialAnio + aperturaDisponible + balance + retiroAhorro = saldoFinalAnio
      // (`balance` es ingresos − egresos y NO incluye los retiros: se suman aparte
      // a propósito, para que "lo que el año generó" no se confunda con plata
      // que solo cambió de bolsillo).
      recorridoSaldo: {
        saldoInicialAnio,
        aperturaDisponible: aperturaEnElAnio?.montoDisponible || 0,
        balance: totales.balance,
        retiroAhorro: totales.totalRetiroAhorro,
        saldoFinalAnio,
      },
      apertura: aperturaEnElAnio
        ? {
            montoDisponible: aperturaEnElAnio.montoDisponible || 0,
            montoAhorro: aperturaEnElAnio.montoAhorro || 0,
            mesCorte: aperturaEnElAnio.mesCorte,
            nombreMesCorte: NOMBRES_MES_PERSONAL[aperturaEnElAnio.mesCorte],
          }
        : null,
      meses,
      desglose,
      promedios,
      destacados,
      comparativo,
      mensajes: construirRecomendacionesAnuales({
        anio,
        totales,
        saldoInicialAnio,
        saldoFinalAnio,
        ahorroFinalAnio,
        meses,
        desgloseGasto: desglose.gasto,
        comparativo,
        enCurso,
        mesesConMovimiento,
      }),
    });
  } catch (error) {
    console.error('❌ Error al generar el reporte anual personal:', error);
    res.status(500).json({ message: 'Error al generar el reporte anual', error: error.message });
  }
};

// ============================================
// POST /api/finanzas-personales/regenerar[?anio=]
// Botón "Regenerar" (como en los reportes del negocio): recalcula los snapshots
// mensuales desde los movimientos. Normalmente NO hace falta —se mantienen solos
// en cada guardado— pero sirve si se tocó la base a mano o para forzar un
// refresco. Con ?anio= regenera solo ese año; sin parámetro, todos.
// ============================================
export const regenerarSnapshots = async (req, res) => {
  try {
    const anioFiltro = req.query.anio ? parseInt(req.query.anio) : null;
    if (req.query.anio && (!anioFiltro || anioFiltro < 2000 || anioFiltro > 2100)) {
      return res.status(400).json({ message: 'anio inválido' });
    }

    // Meses con movimientos + meses que ya tienen snapshot (para dejar en cero /
    // borrar los que quedaron huérfanos si se borraron datos por fuera).
    const [conDatos, guardados] = await Promise.all([
      MovimientoPersonal.aggregate([
        { $match: { usuario: new mongoose.Types.ObjectId(req.user.id) } },
        {
          $group: {
            _id: {
              y: { $year: { date: '$fecha', timezone: 'America/Costa_Rica' } },
              m: { $month: { date: '$fecha', timezone: 'America/Costa_Rica' } },
            },
          },
        },
      ]),
      ResumenPersonalMes.find({ usuario: req.user.id }, 'anio mes').lean(),
    ]);

    const candidatos = new Set();
    for (const c of conDatos) candidatos.add(`${c._id.y}-${c._id.m}`);
    for (const g of guardados) candidatos.add(`${g.anio}-${g.mes}`);

    let regenerados = 0;
    for (const clave of candidatos) {
      const [a, m] = clave.split('-').map(Number);
      if (anioFiltro && a !== anioFiltro) continue;
      await regenerarResumenMes(req.user.id, m, a);
      regenerados++;
    }

    res.status(200).json({
      message: `${regenerados} mes(es) regenerados${anioFiltro ? ` de ${anioFiltro}` : ''}.`,
      regenerados,
    });
  } catch (error) {
    console.error('❌ Error al regenerar los snapshots personales:', error);
    res.status(500).json({ message: 'Error al regenerar los reportes', error: error.message });
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

    // Fondo (de qué bolsillo salió) + bolsa de ahorro. Se revalida también
    // cuando cambia el tipo o la categoría, porque un egreso marcado "pagado con
    // el ahorro" deja de ser válido si pasa a ingreso, a retiro o a categoría de
    // ahorro; en esos casos hay que enviar fondo:'mes' explícitamente.
    if (
      req.body.fondo !== undefined ||
      req.body.bolsaAhorro !== undefined ||
      $set.tipo !== undefined ||
      $set.categoria !== undefined
    ) {
      const tipoFinal = $set.tipo ?? actual.tipo;
      const categoriaFinal = $set.categoria ?? actual.categoria;
      const fondoFinal = req.body.fondo !== undefined ? req.body.fondo : actual.fondo || 'mes';
      const bolsaFinal =
        req.body.bolsaAhorro !== undefined ? req.body.bolsaAhorro : actual.bolsaAhorro;
      const bolsillo = validarFondo(fondoFinal, bolsaFinal, tipoFinal, categoriaFinal);
      if (bolsillo.error) return res.status(400).json({ message: bolsillo.error });
      $set.fondo = bolsillo.fondo;
      $set.bolsaAhorro = bolsillo.bolsaAhorro;
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

    // ¿La edición toca el ahorro acumulado? Puede romperlo de varias formas:
    // subir un retiro o un gasto pagado con el ahorro, bajar/borrar un ahorro que
    // una salida posterior ya usó, mover cualquiera de esos de mes, o cambiarle
    // el tipo, la categoría o el fondo.
    const antes = contribucionAhorro(actual);
    const despues = contribucionAhorro({
      tipo: $set.tipo ?? actual.tipo,
      categoria: $set.categoria ?? actual.categoria,
      fondo: $set.fondo ?? actual.fondo,
      monto: $set.monto ?? actual.monto,
      fecha: $set.fecha ?? actual.fecha,
    });

    if (antes.ahorro || antes.salida || despues.ahorro || despues.salida) {
      await asegurarSnapshots(req.user.id);
      const problema = await validarAhorroNoNegativo(req.user.id, [
        { anio: antes.anio, mes: antes.mes, ahorro: -antes.ahorro, salida: -antes.salida },
        { anio: despues.anio, mes: despues.mes, ahorro: despues.ahorro, salida: despues.salida },
      ]);
      if (problema) {
        const donde = `${NOMBRES_MES[problema.mes - 1]} ${problema.anio}`;
        if (despues.salida > 0) {
          // Se está subiendo (o moviendo) una salida del ahorro: el tope es
          // cuánto puede valer.
          const tope = Math.max(0, despues.salida - problema.exceso);
          const queEs = esRetiroAhorro($set.tipo ?? actual.tipo)
            ? 'Ese retiro'
            : 'Ese gasto pagado con el ahorro';
          return res.status(400).json({
            message: tope === 0
              ? `No podés dejarlo así: no hay ahorro que lo cubra en ${donde}.`
              : `${queEs} no puede pasar de ${fmtCRC(tope)}: más que eso deja el ahorro en negativo en ${donde}.`,
            disponible: tope,
            acumulado: problema.disponible,
          });
        }
        // Se está bajando o reclasificando un ahorro que una salida ya usó.
        const minimo = despues.ahorro + problema.exceso;
        return res.status(400).json({
          message: `Ese ahorro no puede bajar de ${fmtCRC(minimo)}: ya usaste esa plata y el acumulado quedaría en negativo en ${donde}.`,
          minimo,
          acumulado: problema.disponible,
        });
      }
    }

    const fechaVieja = actual.fecha; // por si el movimiento cambia de mes

    const movimiento = await MovimientoPersonal.findByIdAndUpdate(
      req.params.id,
      { $set },
      { new: true, runValidators: true }
    );

    // Si cambió de mes hay DOS meses afectados: el viejo (queda sin ese monto) y
    // el nuevo. Se regeneran los dos snapshots.
    await regenerarResumenDeFecha(req.user.id, fechaVieja, movimiento.fecha);

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

    // Se busca ANTES de borrar: si era un ahorro que un retiro posterior ya usó,
    // borrarlo dejaría el acumulado en negativo y hay que rechazarlo.
    const movimiento = await MovimientoPersonal.findOne({
      _id: req.params.id,
      usuario: req.user.id,
    });

    if (!movimiento) {
      return res.status(404).json({ message: 'Movimiento no encontrado' });
    }

    const aporte = contribucionAhorro(movimiento);
    if (aporte.ahorro > 0) {
      await asegurarSnapshots(req.user.id);
      const problema = await validarAhorroNoNegativo(req.user.id, [
        { anio: aporte.anio, mes: aporte.mes, ahorro: -aporte.ahorro, salida: 0 },
      ]);
      if (problema) {
        const donde = `${NOMBRES_MES[problema.mes - 1]} ${problema.anio}`;
        return res.status(400).json({
          message: `No se puede borrar: ${fmtCRC(problema.exceso)} de ese ahorro ya los usaste, y el acumulado quedaría en negativo en ${donde}. Borrá o bajá primero el retiro o el gasto pagado con el ahorro.`,
          // Si en vez de borrarlo lo querés bajar, este es el mínimo que puede quedar.
          minimo: problema.exceso,
          acumulado: problema.disponible,
        });
      }
    }

    await MovimientoPersonal.deleteOne({ _id: movimiento._id });

    // Snapshot del mes al día. Si el mes se quedó sin movimientos, el snapshot
    // se borra (regenerarResumenMes lo hace) y los acumulados se ajustan solos.
    await regenerarResumenDeFecha(req.user.id, movimiento.fecha);

    res.status(200).json({ message: 'Movimiento eliminado', id: req.params.id });
  } catch (error) {
    console.error('❌ Error al eliminar movimiento personal:', error);
    res.status(500).json({ message: 'Error al eliminar el movimiento', error: error.message });
  }
};
