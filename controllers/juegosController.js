// controllers/juegosController.js
// Módulo de Juegos: el catálogo de lo que se puede jugar en la sala.
//
// LA REGLA QUE SOSTIENE TODO ESTO
// La plata NO vive acá. Un juego comprado se guarda como un ActivoSala normal
// —con su placa, su factura y su fecha— y la ficha solo lo apunta con
// `juegoId`. Por eso:
//   • un juego de PS Plus no puede colarse en ningún reporte: no tiene activo;
//   • un juego comprado cuenta exactamente igual que si se hubiera registrado
//     desde Activos, porque se crea por la MISMA función (registrarActivo);
//   • los montos que se muestran acá se leen de los activos, no se guardan.
//
// Un juego con compras no se puede borrar: eso le sacaría plata a un mes que ya
// se cerró. Para esos está `noSeOfrece`, que lo saca del selector y de la
// página pero deja la compra donde está.
import mongoose from 'mongoose';
import Juego, { normalizarNombre } from '../models/Juego.js';
import ActivoSala from '../models/ActivoSala.js';
import Play from '../models/plays.js';
import { registrarActivo } from './activosSalaController.js';
import { regenerarEstadoDeFecha } from './estadoResultadosController.js';
import { regenerarReporteActivos } from './activosReportController.js';
import { eliminarImagenCloudinary } from '../utils/cloudinaryUtils.js';

// Categoría que se le pone al activo según lo que se esté comprando.
const CATEGORIA_POR_TIPO = {
  digital: 'Juegos digitales',
  fisico: 'Juegos físicos',
  complemento: 'Complementos',
};

// Ventana del ranking, igual que la del selector de plays.
const DIAS_RANKING = 90;

// "YYYY-MM-DD" → Date a medianoche de Costa Rica (06:00 UTC), igual que el
// resto de la app. Devuelve undefined si el formato no sirve.
const parseFecha = (valor) => {
  if (valor === null || valor === '' || valor === undefined) return null;
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return undefined;
  const [anio, mes, dia] = valor.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia, 6, 0, 0, 0));
  if (isNaN(fecha.getTime()) || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return undefined;
  return fecha;
};

// Cuántas veces se jugó cada juego últimamente, por nombre normalizado.
const rankingPorClave = async () => {
  const desde = new Date(Date.now() - DIAS_RANKING * 24 * 60 * 60 * 1000);
  const filas = await Play.aggregate([
    { $match: { fecha: { $gte: desde } } },
    { $unwind: '$juegosJugados' },
    { $group: { _id: '$juegosJugados', veces: { $sum: 1 } } },
  ]);
  const mapa = new Map();
  for (const f of filas) {
    const clave = normalizarNombre(f._id);
    if (!clave) continue;
    mapa.set(clave, (mapa.get(clave) || 0) + f.veces);
  }
  return mapa;
};

// Valida una compra y la deja lista para registrarActivo. Devuelve { error }
// si algo no sirve, o { datos } si está todo bien. Lo comparten los tres
// caminos por los que puede nacer una compra, para que las reglas sean una.
const validarCompra = (compra, { nombre, esComplemento }) => {
  const costo = Number(compra?.costo);
  if (!Number.isFinite(costo) || costo <= 0) {
    return { error: 'El costo de la compra debe ser mayor a 0' };
  }
  const fechaCompra = parseFecha(compra?.fechaCompra);
  if (fechaCompra === undefined) {
    return { error: 'La fecha de compra debe tener formato YYYY-MM-DD' };
  }
  if (!fechaCompra) {
    // Sin fecha, el gasto no cae en ningún mes del estado de resultados:
    // quedaría invisible en el reporte que más se mira.
    return { error: 'La fecha de compra es obligatoria' };
  }
  const categoria =
    CATEGORIA_POR_TIPO[compra.tipo] || (esComplemento ? 'Complementos' : 'Juegos digitales');
  return {
    datos: {
      nombre: String(compra.nombreInventario || nombre).trim(),
      categoria,
      costo,
      fechaCompra,
      numeroFactura: compra.numeroFactura?.trim() || null,
    },
  };
};

// El ORDEN en que se muestran los juegos, y es el mismo en los tres lugares
// donde aparecen: el selector del play, el módulo y la página pública. Manda
// lo que más se juega —que es lo que la gente busca y lo que luce— y solo
// cuando empatan deciden la estrella y el abecedario.
//
// Con esto, lo que se ve en el módulo es lo que ve el cliente en la página.
const porMasJugado = (ranking) => (a, b) => {
  const jugadasA = ranking.get(a.clave) || 0;
  const jugadasB = ranking.get(b.clave) || 0;
  if (jugadasA !== jugadasB) return jugadasB - jugadasA;
  if (!!a.enVitrina !== !!b.enVitrina) return a.enVitrina ? -1 : 1;
  return (a.nombre || '').localeCompare(b.nombre || '', 'es');
};

// ============================================
// GET /api/juegos — Todo lo que el módulo necesita para pintarse.
//
// Cada juego viene con sus complementos, sus compras (leídas de los activos),
// cuánto se gastó en total y cuántas veces se jugó.
// ============================================
export const getJuegos = async (req, res) => {
  try {
    const [fichas, activos, ranking] = await Promise.all([
      Juego.find().sort({ nombre: 1 }).lean(),
      ActivoSala.find({ juegoId: { $ne: null } })
        .select('numeroPlaca nombre categoria costo fechaCompra estado juegoId')
        .lean(),
      rankingPorClave(),
    ]);

    // Las compras, agrupadas por la ficha a la que pertenecen.
    const comprasPorFicha = new Map();
    for (const a of activos) {
      const k = String(a.juegoId);
      if (!comprasPorFicha.has(k)) comprasPorFicha.set(k, []);
      comprasPorFicha.get(k).push(a);
    }

    const armar = (f) => {
      const compras = comprasPorFicha.get(String(f._id)) || [];
      return {
        ...f,
        compras,
        gastado: compras.reduce((t, a) => t + (a.costo || 0), 0),
      };
    };

    const complementos = fichas.filter((f) => f.padre).map(armar);
    const juegos = fichas
      .filter((f) => !f.padre)
      .map((f) => {
        const hijos = complementos.filter((h) => String(h.padre) === String(f._id));
        const propio = armar(f);
        return {
          ...propio,
          complementos: hijos,
          // Lo gastado incluye los complementos: es lo que llevás puesto en
          // ese juego, que es el número que no existía en ningún lado.
          gastado: propio.gastado + hijos.reduce((t, h) => t + h.gastado, 0),
          plays: ranking.get(f.clave) || 0,
        };
      })
      .sort(porMasJugado(ranking));

    return res.status(200).json({ data: juegos, diasRanking: DIAS_RANKING });
  } catch (error) {
    console.error('❌ Error al listar los juegos:', error.message);
    return res.status(500).json({ message: 'No se pudo leer el catálogo de juegos', data: [] });
  }
};

// ============================================
// GET /api/juegos/vitrina — PÚBLICO (sin token).
//
// Lo que muestra la página principal. Van TODOS los juegos que se ofrecen y
// tienen portada: como el carrusel se desplaza, no hay razón para esconder
// ninguno.
//
// Abren los MÁS JUGADOS: es lo que el cliente reconoce y lo que mejor cuenta
// de qué se trata la sala. La ⭐ solo desempata entre los que se jugaron lo
// mismo. Es el mismo orden del módulo y del selector.
//
// Sin portada no sale nunca: una tarjeta vacía frente a un cliente es peor que
// no mostrar el juego.
// ============================================
export const getVitrina = async (req, res) => {
  try {
    const [juegos, ranking] = await Promise.all([
      Juego.find({ padre: null, noSeOfrece: false, imagenUrl: { $ne: null } })
        .select('nombre imagenUrl imagenAncho imagenAlto link enVitrina clave')
        .lean(),
      rankingPorClave(),
    ]);

    return res.status(200).json({ data: juegos.sort(porMasJugado(ranking)) });
  } catch (error) {
    console.error('❌ Error al leer la vitrina:', error.message);
    // La página tiene su lista de respaldo: nunca se queda vacía por esto.
    return res.status(500).json({ message: 'No se pudo leer la vitrina', data: [] });
  }
};

// ============================================
// POST /api/juegos — Agregar un juego o un complemento.
//
// body: { nombre, padre?, link?, enVitrina?, portadaBase64?,
//         compra?: { tipo, costo, fechaCompra, numeroFactura?, nombreInventario? } }
//
// Sin `compra` NO se crea ningún activo: es un juego de PS Plus, gratuito o
// una demo, y no aparece en ningún reporte. Con `compra`, se crea el activo
// por el mismo camino que usa el formulario de Activos.
// ============================================
export const crearJuego = async (req, res) => {
  try {
    const { nombre, padre = null, link = null, compra } = req.body;

    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ message: 'El nombre es obligatorio' });
    }
    const limpio = String(nombre).trim();

    // El padre tiene que existir y ser un juego, no otro complemento.
    let fichaPadre = null;
    if (padre) {
      if (!mongoose.Types.ObjectId.isValid(padre)) {
        return res.status(400).json({ message: 'El juego indicado no es válido' });
      }
      fichaPadre = await Juego.findById(padre);
      if (!fichaPadre) return res.status(404).json({ message: 'No encontré el juego al que pertenece' });
      if (fichaPadre.padre) {
        return res.status(400).json({ message: 'Un complemento no puede colgar de otro complemento' });
      }
    }

    // Repetido: se compara sin tildes ni mayúsculas, entre juegos o entre los
    // complementos del mismo juego.
    const yaEsta = await Juego.findOne({ padre: padre || null, clave: normalizarNombre(limpio) }).lean();
    if (yaEsta) {
      return res.status(409).json({ message: `"${yaEsta.nombre}" ya está en la lista` });
    }

    // La compra, si la hay: se valida ANTES de crear la ficha, para no dejar
    // una ficha suelta si el costo viene mal.
    let datosCompra = null;
    if (compra) {
      const { error, datos } = validarCompra(compra, { nombre: limpio, esComplemento: !!padre });
      if (error) return res.status(400).json({ message: error });
      datosCompra = datos;
    }

    const portadaUrl = req.cloudinaryPortadaUrl || null;
    const ficha = await Juego.create({
      nombre: limpio,
      padre: padre || null,
      imagenUrl: portadaUrl,
      imagenAncho: req.cloudinaryPortadaAncho || null,
      imagenAlto: req.cloudinaryPortadaAlto || null,
      // Sin portada no puede salir en la página (el modelo lo vuelve a revisar).
      enVitrina: portadaUrl ? req.body.enVitrina === true : false,
      link: link?.trim() || null,
      origen: 'manual',
    });

    let activo = null;
    if (datosCompra) {
      try {
        activo = await registrarActivo({ ...datosCompra, juegoId: ficha._id });
      } catch (err) {
        // Si la compra no se pudo guardar, la ficha no puede quedar diciendo
        // que se compró algo: se deshace.
        await Juego.deleteOne({ _id: ficha._id });
        throw err;
      }
    }

    return res.status(201).json({
      message: activo ? `Guardado · activo placa #${activo.numeroPlaca}` : 'Guardado',
      data: { ...ficha.toObject(), compras: activo ? [activo] : [] },
    });
  } catch (error) {
    console.error('❌ Error al crear el juego:', error.message);
    return res.status(500).json({ message: 'No se pudo guardar el juego', error: error.message });
  }
};

// ============================================
// PUT /api/juegos/:id — Editar nombre, portada, link y vitrina.
// No toca la plata: para eso está el activo.
// ============================================
export const actualizarJuego = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Juego inválido' });
    }
    const ficha = await Juego.findById(req.params.id);
    if (!ficha) return res.status(404).json({ message: 'No encontré ese juego' });

    if (req.body.nombre !== undefined) {
      const limpio = String(req.body.nombre).trim();
      if (!limpio) return res.status(400).json({ message: 'El nombre no puede quedar vacío' });
      const repetido = await Juego.findOne({
        _id: { $ne: ficha._id },
        padre: ficha.padre || null,
        clave: normalizarNombre(limpio),
      }).lean();
      if (repetido) return res.status(409).json({ message: `"${repetido.nombre}" ya está en la lista` });
      ficha.nombre = limpio;
    }

    if (req.body.link !== undefined) ficha.link = req.body.link?.trim() || null;
    if (req.body.noSeOfrece !== undefined) ficha.noSeOfrece = req.body.noSeOfrece === true;

    // Portada nueva: se guarda la vieja para borrarla DESPUÉS de guardar, así
    // un fallo no deja la ficha apuntando a una imagen que ya no existe.
    let portadaVieja = null;
    if (req.cloudinaryPortadaUrl) {
      portadaVieja = ficha.imagenUrl;
      ficha.imagenUrl = req.cloudinaryPortadaUrl;
      ficha.imagenAncho = req.cloudinaryPortadaAncho || null;
      ficha.imagenAlto = req.cloudinaryPortadaAlto || null;
    } else if (req.body.quitarPortada === true) {
      portadaVieja = ficha.imagenUrl;
      ficha.imagenUrl = null;
      ficha.imagenAncho = null;
      ficha.imagenAlto = null;
    }

    if (req.body.enVitrina !== undefined) {
      const quiere = req.body.enVitrina === true;
      if (quiere && !ficha.imagenUrl) {
        return res.status(400).json({ message: 'Para mostrarlo en la página primero necesita una portada' });
      }
      ficha.enVitrina = quiere;
    }

    await ficha.save();
    if (portadaVieja) await eliminarImagenCloudinary(portadaVieja);

    return res.status(200).json({ message: 'Guardado', data: ficha });
  } catch (error) {
    console.error('❌ Error al actualizar el juego:', error.message);
    return res.status(500).json({ message: 'No se pudo guardar el juego', error: error.message });
  }
};

// ============================================
// DELETE /api/juegos/:id — Borrar del catálogo.
//
// Solo se puede si NI el juego NI sus complementos tienen una compra: borrar
// algo que costó plata cambiaría un mes ya cerrado. Cuando hay compras, la
// respuesta dice cuáles son y ofrece el camino: dejar de ofrecerlo.
//
// Borrar un juego se lleva sus complementos SIN compra, que no existen sin él.
// ============================================
export const borrarJuego = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Juego inválido' });
    }
    const ficha = await Juego.findById(req.params.id).lean();
    if (!ficha) return res.status(404).json({ message: 'No encontré ese juego' });

    const hijos = ficha.padre ? [] : await Juego.find({ padre: ficha._id }).select('_id nombre').lean();
    const ids = [ficha._id, ...hijos.map((h) => h._id)];

    const compras = await ActivoSala.find({ juegoId: { $in: ids } })
      .select('numeroPlaca nombre costo')
      .lean();

    if (compras.length) {
      const placas = compras.map((c) => `#${c.numeroPlaca}`).join(', ');
      const total = compras.reduce((t, c) => t + (c.costo || 0), 0);
      return res.status(409).json({
        code: 'TIENE_COMPRAS',
        message:
          `"${ficha.nombre}" tiene ₡${total.toLocaleString('es-CR')} en compras (placas ${placas}). ` +
          'Borrarlo le sacaría esa plata a reportes de meses ya cerrados. Podés dejar de ofrecerlo.',
        compras,
      });
    }

    await Juego.deleteMany({ _id: { $in: ids } });
    return res.status(200).json({
      message: hijos.length
        ? `"${ficha.nombre}" y sus ${hijos.length} complemento(s) fueron borrados`
        : `"${ficha.nombre}" fue borrado`,
      id: req.params.id,
    });
  } catch (error) {
    console.error('❌ Error al borrar el juego:', error.message);
    return res.status(500).json({ message: 'No se pudo borrar el juego', error: error.message });
  }
};

// ============================================
// POST /api/juegos/:id/compra — Registrar la compra de un juego que ya existe.
//
// Es el camino de "estaba como gratis y resulta que se compró". Crea el activo
// por el mismo lugar de siempre, así que desde ese momento cuenta en el
// reporte del mes de la compra.
//
// Un juego puede tener más de una: el mismo título comprado para dos consolas
// son dos compras, y las dos son plata.
// ============================================
export const agregarCompra = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Juego inválido' });
    }
    const ficha = await Juego.findById(req.params.id).lean();
    if (!ficha) return res.status(404).json({ message: 'No encontré ese juego' });

    const { error, datos } = validarCompra(req.body, {
      nombre: ficha.nombre,
      esComplemento: !!ficha.padre,
    });
    if (error) return res.status(400).json({ message: error });

    const activo = await registrarActivo({ ...datos, juegoId: ficha._id });
    const mes = activo.fechaCompra.toISOString().slice(0, 7);
    return res.status(201).json({
      message: `Compra registrada · placa #${activo.numeroPlaca} · cuenta en ${mes}`,
      data: activo,
    });
  } catch (err) {
    console.error('❌ Error al registrar la compra:', err.message);
    return res.status(500).json({ message: 'No se pudo registrar la compra', error: err.message });
  }
};

// ============================================
// PUT /api/juegos/:id/compra/:placa — Corregir el monto, la fecha o la factura.
//
// Toca reportes, así que regenera el mes viejo Y el nuevo: si la compra se
// mueve de mes, uno baja y el otro sube. Es el mismo cuidado que tiene el
// formulario de Activos al editar.
// ============================================
export const editarCompra = async (req, res) => {
  try {
    const placa = Number(req.params.placa);
    const activo = await ActivoSala.findOne({ numeroPlaca: placa });
    if (!activo) return res.status(404).json({ message: 'No encontré esa compra' });
    if (!activo.juegoId) {
      return res.status(400).json({ message: 'Esa placa no es de un juego: se edita desde Activos' });
    }

    const fechaVieja = activo.fechaCompra;

    if (req.body.costo !== undefined) {
      const costo = Number(req.body.costo);
      if (!Number.isFinite(costo) || costo <= 0) {
        return res.status(400).json({ message: 'El costo debe ser mayor a 0' });
      }
      activo.costo = costo;
    }
    if (req.body.fechaCompra !== undefined) {
      const fecha = parseFecha(req.body.fechaCompra);
      if (fecha === undefined) return res.status(400).json({ message: 'La fecha debe tener formato YYYY-MM-DD' });
      if (!fecha) return res.status(400).json({ message: 'La fecha de compra es obligatoria' });
      activo.fechaCompra = fecha;
    }
    if (req.body.numeroFactura !== undefined) {
      activo.numeroFactura = req.body.numeroFactura?.trim() || null;
    }
    if (req.body.nombreInventario !== undefined) {
      const n = String(req.body.nombreInventario).trim();
      if (n) activo.nombre = n;
    }

    await activo.save();

    // Los dos meses: del que sale y al que entra.
    regenerarReporteActivos();
    regenerarEstadoDeFecha(fechaVieja, activo.fechaCompra);

    return res.status(200).json({ message: 'Compra actualizada. Los reportes se rehicieron.', data: activo });
  } catch (err) {
    console.error('❌ Error al editar la compra:', err.message);
    return res.status(500).json({ message: 'No se pudo editar la compra', error: err.message });
  }
};

// ============================================
// DELETE /api/juegos/:id/compra/:placa — Dar de baja una compra.
//
// Esto SÍ toca los reportes: es la única forma de sacar plata, y por eso vive
// acá con su propio endpoint y regenera el mes afectado.
// ============================================
export const borrarCompra = async (req, res) => {
  try {
    const placa = Number(req.params.placa);
    const activo = await ActivoSala.findOne({ numeroPlaca: placa });
    if (!activo) return res.status(404).json({ message: 'No encontré esa compra' });
    if (!activo.juegoId) {
      return res.status(400).json({ message: 'Esa placa no es de un juego: se da de baja desde Activos' });
    }

    const fecha = activo.fechaCompra;
    const imagenes = [activo.imagenUrl, activo.imagenFacturaUrl].filter(Boolean);
    await ActivoSala.deleteOne({ _id: activo._id });
    for (const url of imagenes) await eliminarImagenCloudinary(url);

    // Los reportes del mes de esa compra se rehacen ya mismo.
    regenerarReporteActivos();
    regenerarEstadoDeFecha(fecha);

    return res.status(200).json({
      message: `Compra de la placa #${placa} dada de baja. El reporte del mes se actualizó.`,
    });
  } catch (error) {
    console.error('❌ Error al dar de baja la compra:', error.message);
    return res.status(500).json({ message: 'No se pudo dar de baja la compra', error: error.message });
  }
};
