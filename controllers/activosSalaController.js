// controllers/activosSalaController.js
// Hecho por Claude Code — Módulo de Administración: Activos de la Sala
// CRUD del activo (producto) + historial de reparaciones. Imágenes en
// Cloudinary (foto del artículo + factura de compra a nivel activo; factura
// por reparación dentro de cada item). El `estado` es CALCULADO por el backend
// (ver derivarEstado): el front solo lo lee y setea/limpia `estadoOverride`.
import mongoose from 'mongoose';
import ActivoSala, {
  ESTADOS_OVERRIDE,
  CATEGORIAS_ACTIVO,
  derivarEstado,
} from '../models/ActivoSala.js';
import { siguienteSecuencia, fijarSecuenciaMinima, verSecuencia } from '../models/Counter.js';
import { eliminarImagenCloudinary } from '../utils/cloudinaryUtils.js';
import cloudinary from '../config/cloudinary.js';

// Nombre del contador usado para el número de placa consecutivo de los activos.
const CONTADOR_PLACA = 'numeroPlacaActivo';

// Helper: convierte "YYYY-MM-DD" a Date en medianoche de COSTA RICA (06:00 UTC),
// igual que el resto de la app (crearFiltroFechas, inventario). Si se guardara en
// medianoche UTC, al mostrarla en hora CR (UTC-6) se vería el día anterior.
// Retorna: Date válida | null (si viene vacío/null) | undefined (si es inválida)
const parseFecha = (valor) => {
  if (valor === null || valor === '') return null;
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return undefined;
  const [anio, mes, dia] = valor.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia, 6, 0, 0, 0)); // medianoche CR
  // Validar que el día exista realmente (ej. rechazar 2026-02-31)
  if (isNaN(fecha.getTime()) || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return undefined;
  return fecha;
};

// Fecha de hoy a medianoche CR (para default de la fecha de reparación).
const hoyCostaRica = () => {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate(), 6, 0, 0, 0));
};

// Helper: limpia imágenes recién subidas si falla el guardado (rollback).
// Cubre tanto los public_id del middleware de activo como el de reparación.
const limpiarImagenesSubidas = async (req) => {
  const ids = [
    req.cloudinaryPublicId,
    req.cloudinaryFacturaPublicId,
    req.cloudinaryReparacionFacturaPublicId,
  ];
  for (const publicId of ids) {
    if (!publicId) continue;
    try {
      console.log('🧹 Limpiando imagen de Cloudinary:', publicId);
      await cloudinary.uploader.destroy(publicId);
    } catch (cleanupError) {
      console.error('❌ No se pudo limpiar Cloudinary:', cleanupError.message);
    }
  }
};

// ============================================
// POST /api/activos-sala — Registrar un activo (solo producto).
// NO recibe datos de reparación: arranca con reparaciones:[] y estado calculado.
// Las imágenes ya fueron procesadas por uploadActivoImagesToCloudinary:
//   req.cloudinaryUrl        → imagen del artículo
//   req.cloudinaryFacturaUrl → imagen de la factura de compra
// ============================================
export const addActivo = async (req, res) => {
  try {
    const { nombre, costo, descripcion, numeroFactura, notas, categoria } = req.body;

    if (!nombre || !nombre.trim()) {
      await limpiarImagenesSubidas(req);
      return res.status(400).json({ message: 'El nombre es obligatorio' });
    }

    const costoNum = Number(costo);
    if (costo === undefined || costo === null || isNaN(costoNum) || costoNum <= 0) {
      await limpiarImagenesSubidas(req);
      return res.status(400).json({ message: 'El costo es obligatorio y debe ser un número mayor a 0' });
    }

    if (categoria !== undefined && categoria !== null && !CATEGORIAS_ACTIVO.includes(categoria)) {
      await limpiarImagenesSubidas(req);
      return res.status(400).json({
        message: `Categoría inválida. Valores válidos: ${CATEGORIAS_ACTIVO.join(', ')}`,
      });
    }

    // estadoOverride opcional al crear: null, "Fuera de servicio" o "Almacenado".
    let estadoOverride = null;
    if (req.body.estadoOverride !== undefined && req.body.estadoOverride !== null) {
      if (!ESTADOS_OVERRIDE.includes(req.body.estadoOverride)) {
        await limpiarImagenesSubidas(req);
        return res.status(400).json({
          message: `estadoOverride inválido. Valores válidos: ${ESTADOS_OVERRIDE.join(', ')} o null`,
        });
      }
      estadoOverride = req.body.estadoOverride;
    }

    // fechaCompra: llega como "YYYY-MM-DD" o no viene
    const fechaCompra = parseFecha(req.body.fechaCompra ?? null);
    if (fechaCompra === undefined) {
      await limpiarImagenesSubidas(req);
      return res.status(400).json({ message: 'fechaCompra debe tener formato YYYY-MM-DD' });
    }

    // Número de placa consecutivo y único, asignado automáticamente.
    // Es inmutable: identifica el activo de forma estable de por vida.
    const numeroPlaca = await siguienteSecuencia(CONTADOR_PLACA);

    const activo = new ActivoSala({
      numeroPlaca,
      nombre: nombre.trim(),
      categoria: categoria || 'Otros',
      costo: costoNum,
      estadoOverride,
      // Sin reparaciones aún → estado derivado (respeta override si vino).
      estado: derivarEstado([], estadoOverride),
      descripcion: descripcion?.trim() || null,
      numeroFactura: numeroFactura?.trim() || null,
      notas: notas?.trim() || null,
      fechaCompra,
      reparaciones: [],
      imagenUrl: req.cloudinaryUrl || null,
      imagenFacturaUrl: req.cloudinaryFacturaUrl || null,
    });

    try {
      let savedActivo;
      try {
        savedActivo = await activo.save();
      } catch (err) {
        // Si por una carrera (o un contador desincronizado) la placa choca,
        // resincronizamos el contador al máximo existente y reintentamos una vez.
        if (err?.code === 11000 && err?.keyPattern?.numeroPlaca) {
          const ultimo = await ActivoSala.findOne({ numeroPlaca: { $ne: null } })
            .sort({ numeroPlaca: -1 })
            .select('numeroPlaca')
            .lean();
          await fijarSecuenciaMinima(CONTADOR_PLACA, ultimo?.numeroPlaca || 0);
          activo.numeroPlaca = await siguienteSecuencia(CONTADOR_PLACA);
          savedActivo = await activo.save();
        } else {
          throw err;
        }
      }
      console.log(`✅ Activo "${savedActivo.nombre}" registrado — placa #${savedActivo.numeroPlaca}`);
      return res.status(201).json({ message: 'Activo registrado', data: savedActivo });
    } catch (mongoError) {
      // Rollback: si falla MongoDB, no dejar imágenes huérfanas en Cloudinary
      console.error('❌ Fallo en MongoDB al guardar activo:', mongoError.message);
      await limpiarImagenesSubidas(req);
      return res.status(500).json({ message: 'No se pudo guardar el activo en la base de datos', error: mongoError.message });
    }
  } catch (error) {
    console.error('❌ Error inesperado al registrar activo:', error);
    await limpiarImagenesSubidas(req);
    res.status(500).json({ message: 'Error al registrar el activo', error: error.message });
  }
};

// ============================================
// GET /api/activos-sala[?page=1&limit=12&search=futbolin&categoria=&conReparacion=true|false]
// Ordenados por createdAt descendente (más reciente primero).
// Paginación opcional: si viene "page" se pagina, si no, devuelve todos.
// Filtros opcionales: search (por nombre), categoria y conReparacion.
//   conReparacion=true  → activos con al menos 1 reparación
//   conReparacion=false → activos sin ninguna reparación
// ============================================
export const getActivos = async (req, res) => {
  try {
    const filtro = {};

    const search = req.query.search?.trim();
    if (search) {
      filtro.nombre = { $regex: search, $options: 'i' };
    }

    // Filtro por presencia de reparaciones (reemplaza el viejo tipoRegistro).
    const { conReparacion } = req.query;
    if (conReparacion !== undefined) {
      if (conReparacion === 'true') {
        filtro['reparaciones.0'] = { $exists: true }; // tiene al menos 1
      } else if (conReparacion === 'false') {
        filtro['reparaciones.0'] = { $exists: false }; // no tiene ninguna
      } else {
        return res.status(400).json({ message: 'conReparacion debe ser "true" o "false"' });
      }
    }

    // Los conteos por categoría (chips) se calculan con search + conReparacion
    // pero SIN el filtro de categoría, para que muestren cuántos hay en cada
    // una aunque haya una seleccionada. Por eso se toma este "filtroBase" antes
    // de aplicar la categoría.
    const filtroBase = { ...filtro };

    const { categoria } = req.query;
    if (categoria) {
      if (!CATEGORIAS_ACTIVO.includes(categoria)) {
        return res.status(400).json({
          message: `categoria inválida. Valores válidos: ${CATEGORIAS_ACTIVO.join(', ')}`,
        });
      }
      filtro.categoria = categoria;
    }

    // Paginación opcional
    const page = parseInt(req.query.page) || null;
    const limit = Math.min(parseInt(req.query.limit) || 12, 100);

    let consulta = ActivoSala.find(filtro).sort({ createdAt: -1 });
    if (page) {
      consulta = consulta.skip((page - 1) * limit).limit(limit);
    }

    const [data, totalItems, conteoAgg] = await Promise.all([
      consulta.lean(),
      ActivoSala.countDocuments(filtro),
      ActivoSala.aggregate([
        { $match: filtroBase },
        { $group: { _id: '$categoria', count: { $sum: 1 } } },
      ]),
    ]);

    // Conteo por categoría con TODAS las categorías presentes (0 si no hay).
    // Los docs viejos sin categoría (antes de la migración) se cuentan en "Otros".
    const conteoPorCategoria = Object.fromEntries(CATEGORIAS_ACTIVO.map((c) => [c, 0]));
    for (const { _id, count } of conteoAgg) {
      const key = _id || 'Otros';
      conteoPorCategoria[key] = (conteoPorCategoria[key] || 0) + count;
    }

    const respuesta = { data, conteoPorCategoria };

    if (page) {
      const totalPages = Math.ceil(totalItems / limit);
      respuesta.pagination = {
        currentPage: page,
        totalPages,
        totalItems,
        itemsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      };
    }

    res.status(200).json(respuesta);
  } catch (error) {
    console.error('❌ Error al obtener activos:', error);
    res.status(500).json({ message: 'Error al obtener los activos', error: error.message });
  }
};

// ============================================
// GET /api/activos-sala/proxima-placa — Previsualizar el próximo número de placa
// Devuelve el número que se le asignará al PRÓXIMO activo creado, sin consumirlo.
// Es solo una vista previa: el número real se asigna de forma atómica al guardar,
// así que si dos personas crean a la vez podría diferir (poco probable en uso real).
// ============================================
export const getProximaPlaca = async (req, res) => {
  try {
    const [seqActual, ultimo] = await Promise.all([
      verSecuencia(CONTADOR_PLACA),
      ActivoSala.findOne({ numeroPlaca: { $ne: null } })
        .sort({ numeroPlaca: -1 })
        .select('numeroPlaca')
        .lean(),
    ]);
    // Tomamos el mayor entre el contador y la placa más alta existente, por si
    // el contador aún no está sincronizado (ej. antes de la primera creación).
    const proximaPlaca = Math.max(seqActual, ultimo?.numeroPlaca || 0) + 1;
    return res.status(200).json({ proximaPlaca });
  } catch (error) {
    console.error('❌ Error al obtener la próxima placa:', error);
    return res.status(500).json({ message: 'Error al obtener la próxima placa', error: error.message });
  }
};

// ============================================
// GET /api/activos-sala/:id — Ver un activo (incluye reparaciones y estadoOverride)
// ============================================
export const getActivoById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'ID de activo inválido' });
    }

    const activo = await ActivoSala.findById(req.params.id).lean();
    if (!activo) {
      return res.status(404).json({ message: 'Activo no encontrado' });
    }

    res.status(200).json({ data: activo });
  } catch (error) {
    console.error('❌ Error al obtener activo:', error);
    res.status(500).json({ message: 'Error al obtener el activo', error: error.message });
  }
};

// ============================================
// PUT /api/activos-sala/:id — Editar activo (SOLO campos de producto + estadoOverride)
// NO toca `reparaciones` (para eso están los endpoints anidados).
// Recalcula y persiste `estado` (por si cambió estadoOverride).
// ============================================
export const updateActivo = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      await limpiarImagenesSubidas(req);
      return res.status(400).json({ message: 'ID de activo inválido' });
    }

    const activoActual = await ActivoSala.findById(req.params.id);
    if (!activoActual) {
      await limpiarImagenesSubidas(req);
      return res.status(404).json({ message: 'Activo no encontrado' });
    }

    const { nombre, costo, descripcion, numeroFactura, notas, categoria } = req.body;
    const $set = {};

    if (nombre !== undefined) {
      if (!nombre || !nombre.trim()) {
        await limpiarImagenesSubidas(req);
        return res.status(400).json({ message: 'El nombre no puede estar vacío' });
      }
      $set.nombre = nombre.trim();
    }

    if (costo !== undefined) {
      const costoNum = Number(costo);
      if (isNaN(costoNum) || costoNum <= 0) {
        await limpiarImagenesSubidas(req);
        return res.status(400).json({ message: 'El costo debe ser un número mayor a 0' });
      }
      $set.costo = costoNum;
    }

    if (categoria !== undefined) {
      if (!CATEGORIAS_ACTIVO.includes(categoria)) {
        await limpiarImagenesSubidas(req);
        return res.status(400).json({
          message: `Categoría inválida. Valores válidos: ${CATEGORIAS_ACTIVO.join(', ')}`,
        });
      }
      $set.categoria = categoria;
    }

    // estadoOverride: null vuelve a estado automático; si no, debe ser uno de los 2 manuales.
    // Recalculamos `estado` con las reparaciones ACTUALES + el override resultante.
    if (req.body.estadoOverride !== undefined) {
      const nuevoOverride = req.body.estadoOverride;
      if (nuevoOverride !== null && !ESTADOS_OVERRIDE.includes(nuevoOverride)) {
        await limpiarImagenesSubidas(req);
        return res.status(400).json({
          message: `estadoOverride inválido. Valores válidos: ${ESTADOS_OVERRIDE.join(', ')} o null`,
        });
      }
      $set.estadoOverride = nuevoOverride;
      $set.estado = derivarEstado(activoActual.reparaciones, nuevoOverride);
    }

    if (descripcion !== undefined) $set.descripcion = descripcion?.trim() || null;
    if (numeroFactura !== undefined) $set.numeroFactura = numeroFactura?.trim() || null;
    if (notas !== undefined) $set.notas = notas?.trim() || null;

    if (req.body.fechaCompra !== undefined) {
      const fecha = parseFecha(req.body.fechaCompra);
      if (fecha === undefined) {
        await limpiarImagenesSubidas(req);
        return res.status(400).json({ message: 'fechaCompra debe tener formato YYYY-MM-DD' });
      }
      $set.fechaCompra = fecha;
    }

    // Imagen del artículo: si llegó una nueva, reemplazar y borrar la anterior
    if (req.cloudinaryUrl) {
      console.log('🖼️ Nueva imagen de artículo:', req.cloudinaryUrl);
      $set.imagenUrl = req.cloudinaryUrl;
      if (activoActual.imagenUrl) {
        await eliminarImagenCloudinary(activoActual.imagenUrl);
      }
    }

    // Eliminar foto del artículo (solo si NO se subió una nueva en este request)
    if (req.body.eliminarImagen === true && !req.cloudinaryUrl) {
      $set.imagenUrl = null;
      if (activoActual.imagenUrl) await eliminarImagenCloudinary(activoActual.imagenUrl);
    }

    // Factura de compra: igual.
    if (req.cloudinaryFacturaUrl) {
      console.log('🧾 Nueva imagen de factura de compra:', req.cloudinaryFacturaUrl);
      $set.imagenFacturaUrl = req.cloudinaryFacturaUrl;
      if (activoActual.imagenFacturaUrl) {
        await eliminarImagenCloudinary(activoActual.imagenFacturaUrl);
      }
    }

    // Eliminar factura de compra (solo si NO se subió una nueva en este request)
    if (req.body.eliminarImagenFactura === true && !req.cloudinaryFacturaUrl) {
      $set.imagenFacturaUrl = null;
      if (activoActual.imagenFacturaUrl) await eliminarImagenCloudinary(activoActual.imagenFacturaUrl);
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ message: 'No se enviaron campos para actualizar' });
    }

    const activoActualizado = await ActivoSala.findByIdAndUpdate(
      req.params.id,
      { $set },
      { new: true, runValidators: true }
    );

    console.log(`✅ Activo "${activoActualizado.nombre}" actualizado`);
    res.status(200).json({ message: 'Activo actualizado', data: activoActualizado });
  } catch (error) {
    console.error('❌ Error al actualizar activo:', error);
    await limpiarImagenesSubidas(req);
    res.status(500).json({ message: 'Error al actualizar el activo', error: error.message });
  }
};

// ============================================
// DELETE /api/activos-sala/:id — Eliminar activo + TODAS sus imágenes de Cloudinary
// (foto del artículo, factura de compra y las facturas de cada reparación).
// ============================================
export const deleteActivo = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'ID de activo inválido' });
    }

    const activo = await ActivoSala.findById(req.params.id);
    if (!activo) {
      return res.status(404).json({ message: 'Activo no encontrado' });
    }

    // Eliminar imágenes de Cloudinary (si las tiene). Si falla la limpieza no se
    // bloquea la eliminación del registro.
    if (activo.imagenUrl) await eliminarImagenCloudinary(activo.imagenUrl);
    if (activo.imagenFacturaUrl) await eliminarImagenCloudinary(activo.imagenFacturaUrl);
    for (const rep of activo.reparaciones || []) {
      if (rep.facturaUrl) await eliminarImagenCloudinary(rep.facturaUrl);
    }

    await ActivoSala.findByIdAndDelete(req.params.id);

    console.log(`✅ Activo "${activo.nombre}" eliminado junto a sus imágenes`);
    res.status(200).json({ message: 'Activo e imágenes eliminados correctamente', id: req.params.id });
  } catch (error) {
    console.error('❌ Error al eliminar activo:', error);
    res.status(500).json({ message: 'Error al eliminar el activo', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// REPARACIONES (historial dentro de cada activo).
// Las 3 recalculan y persisten `estado` y devuelven el activo COMPLETO.
// La factura (facturaBase64) la sube uploadReparacionFacturaToCloudinary:
//   req.cloudinaryReparacionFacturaUrl / req.cloudinaryReparacionFacturaPublicId
// ─────────────────────────────────────────────────────────────────

// Valida y normaliza el `costo` de una reparación. Retorna { error } o { value }.
const parseCostoReparacion = (valor) => {
  const num = Number(valor);
  if (valor === undefined || valor === null || valor === '' || isNaN(num) || num <= 0) {
    return { error: 'El costo de la reparación es obligatorio y debe ser un número mayor a 0' };
  }
  return { value: num };
};

// ============================================
// POST /api/activos-sala/:id/reparaciones — Agregar una reparación (push)
// ============================================
export const addReparacion = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      await limpiarImagenesSubidas(req);
      return res.status(400).json({ message: 'ID de activo inválido' });
    }

    const activo = await ActivoSala.findById(req.params.id);
    if (!activo) {
      await limpiarImagenesSubidas(req);
      return res.status(404).json({ message: 'Activo no encontrado' });
    }

    const { value: costo, error: errorCosto } = parseCostoReparacion(req.body.costo);
    if (errorCosto) {
      await limpiarImagenesSubidas(req);
      return res.status(400).json({ message: errorCosto });
    }

    // fecha: "YYYY-MM-DD" opcional; si no viene, hoy (CR). No puede ser futura.
    let fecha;
    if (req.body.fecha === undefined || req.body.fecha === null || req.body.fecha === '') {
      fecha = hoyCostaRica();
    } else {
      fecha = parseFecha(req.body.fecha);
      if (fecha === undefined) {
        await limpiarImagenesSubidas(req);
        return res.status(400).json({ message: 'fecha debe tener formato YYYY-MM-DD' });
      }
    }
    if (fecha > hoyCostaRica()) {
      await limpiarImagenesSubidas(req);
      return res.status(400).json({ message: 'La fecha de la reparación no puede ser futura' });
    }

    activo.reparaciones.push({
      costo,
      problemaTecnico: req.body.problemaTecnico?.trim() || null,
      reparadoPor: req.body.reparadoPor?.trim() || null,
      fecha,
      finalizada: req.body.finalizada === true || req.body.finalizada === 'true',
      facturaUrl: req.cloudinaryReparacionFacturaUrl || null,
      facturaPublicId: req.cloudinaryReparacionFacturaPublicId || null,
    });

    // Recalcular estado con el historial actualizado (respeta override existente).
    activo.estado = derivarEstado(activo.reparaciones, activo.estadoOverride);

    try {
      const guardado = await activo.save();
      console.log(`✅ Reparación agregada al activo "${guardado.nombre}" (${guardado.reparaciones.length} en total)`);
      return res.status(201).json({ message: 'Reparación agregada', data: guardado });
    } catch (mongoError) {
      console.error('❌ Fallo en MongoDB al agregar reparación:', mongoError.message);
      await limpiarImagenesSubidas(req);
      return res.status(500).json({ message: 'No se pudo guardar la reparación', error: mongoError.message });
    }
  } catch (error) {
    console.error('❌ Error al agregar reparación:', error);
    await limpiarImagenesSubidas(req);
    res.status(500).json({ message: 'Error al agregar la reparación', error: error.message });
  }
};

// ============================================
// PUT /api/activos-sala/:id/reparaciones/:repId — Editar una reparación
// Solo actualiza lo que llega. facturaBase64 nueva reemplaza la anterior;
// eliminarFactura:true la borra sin reemplazar.
// ============================================
export const updateReparacion = async (req, res) => {
  try {
    const { id, repId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(repId)) {
      await limpiarImagenesSubidas(req);
      return res.status(400).json({ message: 'ID inválido' });
    }

    const activo = await ActivoSala.findById(id);
    if (!activo) {
      await limpiarImagenesSubidas(req);
      return res.status(404).json({ message: 'Activo no encontrado' });
    }

    const rep = activo.reparaciones.id(repId);
    if (!rep) {
      await limpiarImagenesSubidas(req);
      return res.status(404).json({ message: 'Reparación no encontrada' });
    }

    if (req.body.costo !== undefined) {
      const { value, error } = parseCostoReparacion(req.body.costo);
      if (error) {
        await limpiarImagenesSubidas(req);
        return res.status(400).json({ message: error });
      }
      rep.costo = value;
    }

    if (req.body.problemaTecnico !== undefined) rep.problemaTecnico = req.body.problemaTecnico?.trim() || null;
    if (req.body.reparadoPor !== undefined) rep.reparadoPor = req.body.reparadoPor?.trim() || null;

    if (req.body.fecha !== undefined) {
      const fecha = parseFecha(req.body.fecha);
      if (fecha === undefined) {
        await limpiarImagenesSubidas(req);
        return res.status(400).json({ message: 'fecha debe tener formato YYYY-MM-DD' });
      }
      if (fecha && fecha > hoyCostaRica()) {
        await limpiarImagenesSubidas(req);
        return res.status(400).json({ message: 'La fecha de la reparación no puede ser futura' });
      }
      rep.fecha = fecha;
    }

    if (req.body.finalizada !== undefined) {
      rep.finalizada = req.body.finalizada === true || req.body.finalizada === 'true';
    }

    // Factura: nueva imagen reemplaza y borra la anterior.
    if (req.cloudinaryReparacionFacturaUrl) {
      const anterior = rep.facturaUrl;
      rep.facturaUrl = req.cloudinaryReparacionFacturaUrl;
      rep.facturaPublicId = req.cloudinaryReparacionFacturaPublicId || null;
      if (anterior) await eliminarImagenCloudinary(anterior);
    } else if (req.body.eliminarFactura === true && rep.facturaUrl) {
      // Borrar la factura sin reemplazarla.
      const anterior = rep.facturaUrl;
      rep.facturaUrl = null;
      rep.facturaPublicId = null;
      await eliminarImagenCloudinary(anterior);
    }

    // Recalcular estado por si cambió `finalizada`.
    activo.estado = derivarEstado(activo.reparaciones, activo.estadoOverride);

    try {
      const guardado = await activo.save();
      console.log(`✅ Reparación ${repId} del activo "${guardado.nombre}" actualizada`);
      return res.status(200).json({ message: 'Reparación actualizada', data: guardado });
    } catch (mongoError) {
      console.error('❌ Fallo en MongoDB al actualizar reparación:', mongoError.message);
      await limpiarImagenesSubidas(req);
      return res.status(500).json({ message: 'No se pudo actualizar la reparación', error: mongoError.message });
    }
  } catch (error) {
    console.error('❌ Error al actualizar reparación:', error);
    await limpiarImagenesSubidas(req);
    res.status(500).json({ message: 'Error al actualizar la reparación', error: error.message });
  }
};

// ============================================
// DELETE /api/activos-sala/:id/reparaciones/:repId — Eliminar una reparación
// Borra el item del arreglo + su factura de Cloudinary. Recalcula estado.
// ============================================
export const deleteReparacion = async (req, res) => {
  try {
    const { id, repId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(repId)) {
      return res.status(400).json({ message: 'ID inválido' });
    }

    const activo = await ActivoSala.findById(id);
    if (!activo) {
      return res.status(404).json({ message: 'Activo no encontrado' });
    }

    const rep = activo.reparaciones.id(repId);
    if (!rep) {
      return res.status(404).json({ message: 'Reparación no encontrada' });
    }

    const facturaABorrar = rep.facturaUrl;
    rep.deleteOne(); // quita el subdocumento del arreglo

    // Recalcular estado con el historial ya reducido.
    activo.estado = derivarEstado(activo.reparaciones, activo.estadoOverride);

    const guardado = await activo.save();

    // Borrar la factura del storage después de persistir (no crítico si falla).
    if (facturaABorrar) await eliminarImagenCloudinary(facturaABorrar);

    console.log(`✅ Reparación ${repId} eliminada del activo "${guardado.nombre}"`);
    return res.status(200).json({ message: 'Reparación eliminada', data: guardado });
  } catch (error) {
    console.error('❌ Error al eliminar reparación:', error);
    res.status(500).json({ message: 'Error al eliminar la reparación', error: error.message });
  }
};
