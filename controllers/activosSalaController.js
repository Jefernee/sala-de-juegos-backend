// controllers/activosSalaController.js
// Hecho por Claude Code — Módulo de Administración: Activos de la Sala
// Compras y reparaciones del equipo físico. CRUD completo con imágenes
// en Cloudinary (artículo + factura), igual que el módulo de inventario:
//   - Crear: sube imágenes (middleware) y hace rollback si falla MongoDB
//   - Editar: si llega imagen nueva, reemplaza y elimina la anterior
//   - Eliminar: borra el documento y sus imágenes de Cloudinary
import mongoose from 'mongoose';
import ActivoSala, { TIPOS_REGISTRO, ESTADOS_ACTIVO, CATEGORIAS_ACTIVO } from '../models/ActivoSala.js';
import { siguienteSecuencia, fijarSecuenciaMinima, verSecuencia } from '../models/Counter.js';
import { eliminarImagenCloudinary } from '../utils/cloudinaryUtils.js';
import cloudinary from '../config/cloudinary.js';

// Nombre del contador usado para el número de placa consecutivo de los activos.
const CONTADOR_PLACA = 'numeroPlacaActivo';

// Helper: convierte "YYYY-MM-DD" a Date en medianoche de COSTA RICA (06:00 UTC),
// igual que el resto de la app (crearFiltroFechas, inventario). Si se guardara en
// medianoche UTC, al mostrarla en hora CR (UTC-6) se vería el día anterior.
// Retorna: Date válida | null (si viene vacío/null) | undefined (si es inválida)
const parseFechaCompra = (valor) => {
  if (valor === null || valor === '') return null;
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return undefined;
  const [anio, mes, dia] = valor.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia, 6, 0, 0, 0)); // medianoche CR
  // Validar que el día exista realmente (ej. rechazar 2026-02-31)
  if (isNaN(fecha.getTime()) || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return undefined;
  return fecha;
};

// Helper: limpia imágenes recién subidas si falla el guardado (rollback)
const limpiarImagenesSubidas = async (req) => {
  for (const publicId of [req.cloudinaryPublicId, req.cloudinaryFacturaPublicId, req.cloudinaryFacturaReparacionPublicId]) {
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
// POST /api/activos-sala — Registrar compra o reparación
// Las imágenes ya fueron procesadas por uploadActivoImagesToCloudinary:
//   req.cloudinaryUrl        → imagen del artículo
//   req.cloudinaryFacturaUrl → imagen de la factura
// ============================================
export const addActivo = async (req, res) => {
  try {
    const { tipoRegistro, nombre, costo, estado, descripcion, numeroFactura, notas, categoria } = req.body;

    // Validaciones de campos obligatorios
    if (!tipoRegistro || !TIPOS_REGISTRO.includes(tipoRegistro)) {
      await limpiarImagenesSubidas(req);
      return res.status(400).json({
        message: `El tipo de registro es obligatorio. Valores válidos: ${TIPOS_REGISTRO.join(', ')}`,
      });
    }

    if (!nombre || !nombre.trim()) {
      await limpiarImagenesSubidas(req);
      return res.status(400).json({ message: 'El nombre es obligatorio' });
    }

    const costoNum = Number(costo);
    if (costo === undefined || costo === null || isNaN(costoNum) || costoNum <= 0) {
      await limpiarImagenesSubidas(req);
      return res.status(400).json({ message: 'El costo es obligatorio y debe ser un número mayor a 0' });
    }

    if (estado !== undefined && estado !== null && !ESTADOS_ACTIVO.includes(estado)) {
      await limpiarImagenesSubidas(req);
      return res.status(400).json({
        message: `Estado inválido. Valores válidos: ${ESTADOS_ACTIVO.join(', ')}`,
      });
    }

    if (categoria !== undefined && categoria !== null && !CATEGORIAS_ACTIVO.includes(categoria)) {
      await limpiarImagenesSubidas(req);
      return res.status(400).json({
        message: `Categoría inválida. Valores válidos: ${CATEGORIAS_ACTIVO.join(', ')}`,
      });
    }

    // fechaCompraReparacion: llega como "YYYY-MM-DD" o no viene
    const fechaCompraReparacion = parseFechaCompra(req.body.fechaCompraReparacion ?? null);
    if (fechaCompraReparacion === undefined) {
      await limpiarImagenesSubidas(req);
      return res.status(400).json({ message: 'fechaCompraReparacion debe tener formato YYYY-MM-DD' });
    }

    // problemaTecnico, reparadoPor y costoReparacion solo aplican a reparaciones
    const esReparacion = tipoRegistro === 'Reparación';

    // Costo de reparación: separado del costo del producto y obligatorio al reparar
    let costoReparacionNum = null;
    if (esReparacion) {
      costoReparacionNum = Number(req.body.costoReparacion);
      if (
        req.body.costoReparacion === undefined ||
        req.body.costoReparacion === null ||
        isNaN(costoReparacionNum) ||
        costoReparacionNum <= 0
      ) {
        await limpiarImagenesSubidas(req);
        return res.status(400).json({
          message: 'El costo de reparación es obligatorio y debe ser un número mayor a 0',
        });
      }
    }

    // Número de placa consecutivo y único, asignado automáticamente.
    // Es inmutable: identifica el activo de forma estable de por vida.
    const numeroPlaca = await siguienteSecuencia(CONTADOR_PLACA);

    const activo = new ActivoSala({
      numeroPlaca,
      tipoRegistro,
      nombre: nombre.trim(),
      categoria: categoria || 'Otros',
      costo: costoNum,
      costoReparacion: costoReparacionNum,
      estado: estado || 'En uso',
      descripcion: descripcion?.trim() || null,
      numeroFactura: numeroFactura?.trim() || null,
      notas: notas?.trim() || null,
      fechaCompraReparacion,
      problemaTecnico: esReparacion ? req.body.problemaTecnico?.trim() || null : null,
      reparadoPor: esReparacion ? req.body.reparadoPor?.trim() || null : null,
      imagenUrl: req.cloudinaryUrl || null,
      imagenFacturaUrl: req.cloudinaryFacturaUrl || null,
      // La factura de reparación solo tiene sentido en reparaciones
      imagenFacturaReparacionUrl: esReparacion ? req.cloudinaryFacturaReparacionUrl || null : null,
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
      console.log(`✅ Activo "${savedActivo.nombre}" registrado (${savedActivo.tipoRegistro}) — placa #${savedActivo.numeroPlaca}`);
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
// GET /api/activos-sala[?page=1&limit=12&search=futbolin&tipoRegistro=Reparación]
// Ordenados por createdAt descendente (más reciente primero).
// Paginación opcional: si viene "page" se pagina, si no, devuelve todos.
// Filtros opcionales: search (por nombre) y tipoRegistro.
// ============================================
export const getActivos = async (req, res) => {
  try {
    const filtro = {};

    const search = req.query.search?.trim();
    if (search) {
      filtro.nombre = { $regex: search, $options: 'i' };
    }

    const { tipoRegistro } = req.query;
    if (tipoRegistro) {
      if (!TIPOS_REGISTRO.includes(tipoRegistro)) {
        return res.status(400).json({
          message: `tipoRegistro inválido. Valores válidos: ${TIPOS_REGISTRO.join(', ')}`,
        });
      }
      filtro.tipoRegistro = tipoRegistro;
    }

    // Los conteos por categoría (chips) se calculan con search + tipoRegistro
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
// GET /api/activos-sala/:id — Ver un activo
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
// PUT /api/activos-sala/:id — Editar activo
// Si llegan imágenes nuevas (ya subidas por el middleware), se reemplazan
// las URLs y se eliminan las imágenes anteriores de Cloudinary.
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

    const { tipoRegistro, nombre, costo, estado, descripcion, numeroFactura, notas, categoria } = req.body;
    const $set = {};

    if (tipoRegistro !== undefined) {
      if (!TIPOS_REGISTRO.includes(tipoRegistro)) {
        await limpiarImagenesSubidas(req);
        return res.status(400).json({
          message: `Tipo de registro inválido. Valores válidos: ${TIPOS_REGISTRO.join(', ')}`,
        });
      }
      $set.tipoRegistro = tipoRegistro;
    }

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

    if (estado !== undefined) {
      if (!ESTADOS_ACTIVO.includes(estado)) {
        await limpiarImagenesSubidas(req);
        return res.status(400).json({
          message: `Estado inválido. Valores válidos: ${ESTADOS_ACTIVO.join(', ')}`,
        });
      }
      $set.estado = estado;
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

    if (descripcion !== undefined) $set.descripcion = descripcion?.trim() || null;
    if (numeroFactura !== undefined) $set.numeroFactura = numeroFactura?.trim() || null;
    if (notas !== undefined) $set.notas = notas?.trim() || null;

    if (req.body.fechaCompraReparacion !== undefined) {
      const fecha = parseFechaCompra(req.body.fechaCompraReparacion);
      if (fecha === undefined) {
        await limpiarImagenesSubidas(req);
        return res.status(400).json({ message: 'fechaCompraReparacion debe tener formato YYYY-MM-DD' });
      }
      $set.fechaCompraReparacion = fecha;
    }

    // problemaTecnico / reparadoPor / costoReparacion: solo tienen sentido en
    // reparaciones. Si el registro queda como "Nueva Compra", se fuerzan a null.
    // El costo de reparación va SEPARADO del costo del producto: registrar una
    // reparación nunca modifica el campo costo.
    const tipoFinal = $set.tipoRegistro || activoActual.tipoRegistro;
    if (tipoFinal === 'Reparación') {
      if (req.body.problemaTecnico !== undefined) $set.problemaTecnico = req.body.problemaTecnico?.trim() || null;
      if (req.body.reparadoPor !== undefined) $set.reparadoPor = req.body.reparadoPor?.trim() || null;
      if (req.body.costoReparacion !== undefined) {
        const costoReparacionNum = Number(req.body.costoReparacion);
        if (req.body.costoReparacion === null || isNaN(costoReparacionNum) || costoReparacionNum <= 0) {
          await limpiarImagenesSubidas(req);
          return res.status(400).json({ message: 'El costo de reparación debe ser un número mayor a 0' });
        }
        $set.costoReparacion = costoReparacionNum;
      }

      // Factura de reparación: si llegó una nueva, reemplazar y borrar la anterior.
      // NO toca imagenFacturaUrl (la factura de compra queda intacta).
      if (req.cloudinaryFacturaReparacionUrl) {
        console.log('🧾 Nueva imagen de factura de reparación:', req.cloudinaryFacturaReparacionUrl);
        $set.imagenFacturaReparacionUrl = req.cloudinaryFacturaReparacionUrl;
        if (activoActual.imagenFacturaReparacionUrl) {
          await eliminarImagenCloudinary(activoActual.imagenFacturaReparacionUrl);
        }
      }

      // Eliminar factura de reparación (solo si NO se subió una nueva en este request)
      if (req.body.eliminarImagenFacturaReparacion === true && !req.cloudinaryFacturaReparacionUrl) {
        $set.imagenFacturaReparacionUrl = null;
        if (activoActual.imagenFacturaReparacionUrl) await eliminarImagenCloudinary(activoActual.imagenFacturaReparacionUrl);
      }
    } else {
      $set.problemaTecnico = null;
      $set.reparadoPor = null;
      $set.costoReparacion = null;
      // Al dejar de ser reparación, la factura de reparación deja de aplicar:
      // limpiar la URL y borrar el archivo del storage si existía.
      $set.imagenFacturaReparacionUrl = null;
      if (activoActual.imagenFacturaReparacionUrl) {
        await eliminarImagenCloudinary(activoActual.imagenFacturaReparacionUrl);
      }
      // Si en esta misma petición se subió una factura de reparación, queda
      // huérfana al pasar a "Nueva Compra": borrarla del storage.
      if (req.cloudinaryFacturaReparacionUrl) {
        await eliminarImagenCloudinary(req.cloudinaryFacturaReparacionUrl);
      }
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

    // Factura de compra: igual. NO toca imagenFacturaReparacionUrl.
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
// DELETE /api/activos-sala/:id — Eliminar activo + sus imágenes de Cloudinary
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

    // Eliminar imágenes de Cloudinary (si las tiene), igual que en productos.
    // Si falla la limpieza no se bloquea la eliminación del registro.
    if (activo.imagenUrl) await eliminarImagenCloudinary(activo.imagenUrl);
    if (activo.imagenFacturaUrl) await eliminarImagenCloudinary(activo.imagenFacturaUrl);
    if (activo.imagenFacturaReparacionUrl) await eliminarImagenCloudinary(activo.imagenFacturaReparacionUrl);

    await ActivoSala.findByIdAndDelete(req.params.id);

    console.log(`✅ Activo "${activo.nombre}" eliminado junto a sus imágenes`);
    res.status(200).json({ message: 'Activo e imágenes eliminados correctamente', id: req.params.id });
  } catch (error) {
    console.error('❌ Error al eliminar activo:', error);
    res.status(500).json({ message: 'Error al eliminar el activo', error: error.message });
  }
};
