// controllers/finanzasPersonalesController.js
// Finanzas Personales (SOLO administrador). Módulo APARTE de la sala de juegos:
// no lee ni escribe nada del negocio. Solo maneja los ingresos y gastos
// personales que el administrador registra a mano, filtrados por su usuario.
import mongoose from 'mongoose';
import MovimientoPersonal, {
  TIPOS_MOVIMIENTO,
  CATEGORIAS_INGRESO,
  CATEGORIAS_EGRESO,
  MONEDAS,
  categoriasPorTipo,
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
export const getResumenMensual = async (req, res) => {
  try {
    const mes = parseInt(req.query.mes);
    const anio = parseInt(req.query.anio);

    if (!mes || !anio || mes < 1 || mes > 12 || anio < 2000 || anio > 2100) {
      return res.status(400).json({
        message: 'Los parámetros mes (1-12) y anio son obligatorios. Ej: ?mes=7&anio=2026',
      });
    }

    const match = {
      usuario: new mongoose.Types.ObjectId(req.user.id),
      fecha: crearFiltroMes(mes, anio),
    };

    // Agrupa por tipo + categoría: total y cantidad de movimientos por grupo.
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

    res.status(200).json({
      mes,
      anio,
      totalIngresos,
      totalEgresos,
      balance: totalIngresos - totalEgresos,
      desglose, // { ingreso: [{categoria,total,cantidad}], egreso: [...] }
    });
  } catch (error) {
    console.error('❌ Error al generar el resumen personal:', error);
    res.status(500).json({ message: 'Error al generar el resumen', error: error.message });
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
