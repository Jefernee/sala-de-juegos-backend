// controllers/torneosController.js
// Hecho por Claude Code — Módulo de Administración: Torneos y competiciones.
//
// - El administrador/colaborador crea, edita y elimina torneos (nombre, fecha,
//   descripción, afiche, cupo, costo, estado). Rutas protegidas.
// - La página pública lista los torneos (GET /public) y recibe las inscripciones
//   (POST /:id/inscripciones) SIN login. Eso reemplaza el correo: las
//   inscripciones quedan guardadas y se ven en el módulo de administración.
// - Cada torneo expone una `urlPublica` para compartir, armada con FRONTEND_URL.
import mongoose from 'mongoose';
import Torneo, { ESTADOS_TORNEO } from '../models/Torneo.js';
import Inscripcion from '../models/Inscripcion.js';
import { eliminarImagenCloudinary } from '../utils/cloudinaryUtils.js';
import cloudinary from '../config/cloudinary.js';

// Ruta pública de un torneo en el frontend (configurable). El panel de admin la
// muestra para copiar/compartir. Se calcula al vuelo por si cambia el dominio.
const BASE_PUBLICA = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
const TORNEOS_PATH = (process.env.TORNEOS_PUBLIC_PATH || '/torneos').replace(/\/+$/, '');
const urlPublicaTorneo = (id) => (BASE_PUBLICA ? `${BASE_PUBLICA}${TORNEOS_PATH}/${id}` : null);

// Helper: "YYYY-MM-DD" → Date en medianoche de Costa Rica (06:00 UTC), igual que
// el resto de la app. Retorna: Date | null (vacío) | undefined (inválida).
const parseFecha = (valor) => {
  if (valor === null || valor === '') return null;
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return undefined;
  const [anio, mes, dia] = valor.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia, 6, 0, 0, 0));
  if (isNaN(fecha.getTime()) || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return undefined;
  return fecha;
};

// Limpia una imagen recién subida si falla el guardado (rollback).
const limpiarImagenSubida = async (req) => {
  if (!req.cloudinaryPublicId) return;
  try {
    await cloudinary.uploader.destroy(req.cloudinaryPublicId);
  } catch (e) {
    console.error('❌ No se pudo limpiar Cloudinary:', e.message);
  }
};

// Cuenta los inscritos de un conjunto de torneos → Map(torneoId → count).
const contarInscritos = async (torneoIds) => {
  if (!torneoIds.length) return new Map();
  const agg = await Inscripcion.aggregate([
    { $match: { torneoId: { $in: torneoIds } } },
    { $group: { _id: '$torneoId', count: { $sum: 1 } } },
  ]);
  return new Map(agg.map((a) => [a._id.toString(), a.count]));
};

// Agrega inscritosCount / cupoDisponible / urlPublica a un torneo (objeto lean).
const decorarTorneo = (torneo, inscritos) => ({
  ...torneo,
  inscritosCount: inscritos,
  cupoDisponible: torneo.cupoMaximo != null ? Math.max(0, torneo.cupoMaximo - inscritos) : null,
  urlPublica: urlPublicaTorneo(torneo._id),
});

// Valida y arma los campos editables de un torneo desde el body.
// Retorna { error } o { campos }.
const construirCamposTorneo = (body, { requeridos }) => {
  const campos = {};

  if (body.nombre !== undefined || requeridos) {
    if (!body.nombre || !String(body.nombre).trim()) return { error: 'El nombre del torneo es obligatorio' };
    campos.nombre = String(body.nombre).trim();
  }

  if (body.fecha !== undefined || requeridos) {
    const fecha = parseFecha(body.fecha ?? null);
    if (fecha === undefined) return { error: 'fecha debe tener formato YYYY-MM-DD' };
    if (fecha === null) return { error: 'La fecha del torneo es obligatoria' };
    campos.fecha = fecha;
  }

  if (body.descripcion !== undefined) campos.descripcion = body.descripcion?.trim() || null;

  if (body.cupoMaximo !== undefined) {
    if (body.cupoMaximo === null || body.cupoMaximo === '') {
      campos.cupoMaximo = null;
    } else {
      const n = Number(body.cupoMaximo);
      if (isNaN(n) || n < 1) return { error: 'El cupo máximo debe ser un número mayor a 0 (o vacío para sin límite)' };
      campos.cupoMaximo = Math.floor(n);
    }
  }

  if (body.costoInscripcion !== undefined) {
    const n = Number(body.costoInscripcion);
    if (isNaN(n) || n < 0) return { error: 'El costo de inscripción debe ser un número mayor o igual a 0' };
    campos.costoInscripcion = n;
  }

  if (body.estado !== undefined) {
    if (!ESTADOS_TORNEO.includes(body.estado)) {
      return { error: `estado inválido. Valores válidos: ${ESTADOS_TORNEO.join(', ')}` };
    }
    campos.estado = body.estado;
  }

  return { campos };
};

// ============================================
// POST /api/torneos — Crear torneo (admin/colaborador)
// Imagen (afiche) opcional vía uploadBase64ToCloudinary → req.cloudinaryUrl
// ============================================
export const addTorneo = async (req, res) => {
  try {
    const { error, campos } = construirCamposTorneo(req.body, { requeridos: true });
    if (error) {
      await limpiarImagenSubida(req);
      return res.status(400).json({ message: error });
    }

    const torneo = new Torneo({
      ...campos,
      imagenUrl: req.cloudinaryUrl || null,
    });

    const guardado = await torneo.save();
    console.log(`✅ Torneo "${guardado.nombre}" creado`);
    return res.status(201).json({
      message: 'Torneo creado',
      data: decorarTorneo(guardado.toObject(), 0),
    });
  } catch (error) {
    console.error('❌ Error al crear torneo:', error);
    await limpiarImagenSubida(req);
    return res.status(500).json({ message: 'Error al crear el torneo', error: error.message });
  }
};

// ============================================
// GET /api/torneos — Listar torneos (admin/colaborador) con conteo de inscritos
// ============================================
export const getTorneos = async (req, res) => {
  try {
    const torneos = await Torneo.find().sort({ fecha: -1 }).lean();
    const inscritosMap = await contarInscritos(torneos.map((t) => t._id));
    const data = torneos.map((t) => decorarTorneo(t, inscritosMap.get(t._id.toString()) || 0));
    return res.status(200).json({ data });
  } catch (error) {
    console.error('❌ Error al listar torneos:', error);
    return res.status(500).json({ message: 'Error al listar los torneos', error: error.message });
  }
};

// ============================================
// GET /api/torneos/public — Listar torneos para la página pública (SIN login)
// ============================================
export const getTorneosPublicos = async (req, res) => {
  try {
    const torneos = await Torneo.find()
      .select('nombre fecha descripcion imagenUrl cupoMaximo costoInscripcion estado')
      .sort({ fecha: -1 })
      .lean();
    const inscritosMap = await contarInscritos(torneos.map((t) => t._id));
    const data = torneos.map((t) => decorarTorneo(t, inscritosMap.get(t._id.toString()) || 0));
    return res.status(200).json({ data });
  } catch (error) {
    console.error('❌ Error al listar torneos públicos:', error);
    return res.status(500).json({ message: 'Error al listar los torneos', error: error.message });
  }
};

// ============================================
// GET /api/torneos/public/:id — Ver UN torneo para la página pública (SIN login)
// Lo usa la página compartible (urlPublica) para mostrar el detalle + formulario.
// ============================================
export const getTorneoPublicoById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'ID de torneo inválido' });
    }
    const torneo = await Torneo.findById(req.params.id)
      .select('nombre fecha descripcion imagenUrl cupoMaximo costoInscripcion estado')
      .lean();
    if (!torneo) return res.status(404).json({ message: 'Torneo no encontrado' });

    const inscritos = await Inscripcion.countDocuments({ torneoId: torneo._id });
    return res.status(200).json({ data: decorarTorneo(torneo, inscritos) });
  } catch (error) {
    console.error('❌ Error al obtener torneo público:', error);
    return res.status(500).json({ message: 'Error al obtener el torneo', error: error.message });
  }
};

// ============================================
// GET /api/torneos/:id — Ver un torneo (admin/colaborador)
// ============================================
export const getTorneoById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'ID de torneo inválido' });
    }
    const torneo = await Torneo.findById(req.params.id).lean();
    if (!torneo) return res.status(404).json({ message: 'Torneo no encontrado' });

    const inscritos = await Inscripcion.countDocuments({ torneoId: torneo._id });
    return res.status(200).json({ data: decorarTorneo(torneo, inscritos) });
  } catch (error) {
    console.error('❌ Error al obtener torneo:', error);
    return res.status(500).json({ message: 'Error al obtener el torneo', error: error.message });
  }
};

// ============================================
// PUT /api/torneos/:id — Editar torneo (admin/colaborador)
// Solo actualiza lo que llega. Imagen nueva reemplaza y borra la anterior;
// eliminarImagen:true la borra sin reemplazar.
// ============================================
export const updateTorneo = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      await limpiarImagenSubida(req);
      return res.status(400).json({ message: 'ID de torneo inválido' });
    }

    const torneo = await Torneo.findById(req.params.id);
    if (!torneo) {
      await limpiarImagenSubida(req);
      return res.status(404).json({ message: 'Torneo no encontrado' });
    }

    const { error, campos } = construirCamposTorneo(req.body, { requeridos: false });
    if (error) {
      await limpiarImagenSubida(req);
      return res.status(400).json({ message: error });
    }

    // Imagen: nueva reemplaza y borra la anterior.
    if (req.cloudinaryUrl) {
      const anterior = torneo.imagenUrl;
      campos.imagenUrl = req.cloudinaryUrl;
      if (anterior) await eliminarImagenCloudinary(anterior);
    } else if (req.body.eliminarImagen === true && torneo.imagenUrl) {
      campos.imagenUrl = null;
      await eliminarImagenCloudinary(torneo.imagenUrl);
    }

    if (Object.keys(campos).length === 0) {
      return res.status(400).json({ message: 'No se enviaron campos para actualizar' });
    }

    Object.assign(torneo, campos);
    const guardado = await torneo.save();

    const inscritos = await Inscripcion.countDocuments({ torneoId: guardado._id });
    console.log(`✅ Torneo "${guardado.nombre}" actualizado`);
    return res.status(200).json({
      message: 'Torneo actualizado',
      data: decorarTorneo(guardado.toObject(), inscritos),
    });
  } catch (error) {
    console.error('❌ Error al actualizar torneo:', error);
    await limpiarImagenSubida(req);
    return res.status(500).json({ message: 'Error al actualizar el torneo', error: error.message });
  }
};

// ============================================
// DELETE /api/torneos/:id — Eliminar torneo + su afiche + sus inscripciones
// ============================================
export const deleteTorneo = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'ID de torneo inválido' });
    }
    const torneo = await Torneo.findById(req.params.id);
    if (!torneo) return res.status(404).json({ message: 'Torneo no encontrado' });

    if (torneo.imagenUrl) await eliminarImagenCloudinary(torneo.imagenUrl);
    const { deletedCount } = await Inscripcion.deleteMany({ torneoId: torneo._id });
    await Torneo.findByIdAndDelete(torneo._id);

    console.log(`✅ Torneo "${torneo.nombre}" eliminado (+${deletedCount} inscripción(es))`);
    return res.status(200).json({
      message: 'Torneo e inscripciones eliminados',
      id: req.params.id,
      inscripcionesEliminadas: deletedCount,
    });
  } catch (error) {
    console.error('❌ Error al eliminar torneo:', error);
    return res.status(500).json({ message: 'Error al eliminar el torneo', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// INSCRIPCIONES
// ─────────────────────────────────────────────────────────────────

// ============================================
// POST /api/torneos/:id/inscripciones — Inscribirse (PÚBLICO, sin login)
// Reemplaza el envío por correo: la inscripción queda guardada.
// ============================================
export const addInscripcion = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'ID de torneo inválido' });
    }
    const torneo = await Torneo.findById(req.params.id);
    if (!torneo) return res.status(404).json({ message: 'Torneo no encontrado' });

    if (torneo.estado === 'cerrado') {
      return res.status(400).json({ message: 'Las inscripciones para este torneo están cerradas.' });
    }

    const nombre = req.body.nombre?.trim();
    if (!nombre) return res.status(400).json({ message: 'El nombre es obligatorio para inscribirse' });

    // Cupo: si está definido y ya se llenó, no se aceptan más.
    if (torneo.cupoMaximo != null) {
      const inscritos = await Inscripcion.countDocuments({ torneoId: torneo._id });
      if (inscritos >= torneo.cupoMaximo) {
        // Marcar cerrado por si acaso (idempotente).
        if (torneo.estado !== 'cerrado') {
          torneo.estado = 'cerrado';
          await torneo.save();
        }
        return res.status(400).json({ message: 'El torneo ya alcanzó su cupo máximo.' });
      }
    }

    const inscripcion = await Inscripcion.create({
      torneoId: torneo._id,
      torneoNombre: torneo.nombre,
      nombre,
      telefono: req.body.telefono?.trim() || null,
      correo: req.body.correo?.trim() || null,
      gamertag: req.body.gamertag?.trim() || null,
      nombreEquipo: req.body.nombreEquipo?.trim() || null,
    });

    // Si con esta inscripción se llenó el cupo, cerrar automáticamente.
    if (torneo.cupoMaximo != null) {
      const total = await Inscripcion.countDocuments({ torneoId: torneo._id });
      if (total >= torneo.cupoMaximo && torneo.estado !== 'cerrado') {
        torneo.estado = 'cerrado';
        await torneo.save();
      }
    }

    console.log(`✅ Inscripción de "${nombre}" al torneo "${torneo.nombre}"`);
    return res.status(201).json({ message: '¡Inscripción registrada!', data: inscripcion });
  } catch (error) {
    console.error('❌ Error al registrar inscripción:', error);
    return res.status(500).json({ message: 'Error al registrar la inscripción', error: error.message });
  }
};

// ============================================
// GET /api/torneos/:id/inscripciones — Listar inscripciones de un torneo (admin)
// ============================================
export const getInscripciones = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'ID de torneo inválido' });
    }
    const torneo = await Torneo.findById(req.params.id).lean();
    if (!torneo) return res.status(404).json({ message: 'Torneo no encontrado' });

    const inscripciones = await Inscripcion.find({ torneoId: torneo._id })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      torneo: { _id: torneo._id, nombre: torneo.nombre, fecha: torneo.fecha, estado: torneo.estado },
      total: inscripciones.length,
      data: inscripciones,
    });
  } catch (error) {
    console.error('❌ Error al listar inscripciones:', error);
    return res.status(500).json({ message: 'Error al listar las inscripciones', error: error.message });
  }
};

// ============================================
// PATCH /api/torneos/:id/inscripciones/:insId — Marcar atendida/no atendida (admin)
// ============================================
export const updateInscripcion = async (req, res) => {
  try {
    const { id, insId } = req.params;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(insId)) {
      return res.status(400).json({ message: 'ID inválido' });
    }
    if (typeof req.body.atendida !== 'boolean') {
      return res.status(400).json({ message: 'atendida debe ser true o false' });
    }

    const inscripcion = await Inscripcion.findOneAndUpdate(
      { _id: insId, torneoId: id },
      { $set: { atendida: req.body.atendida } },
      { new: true }
    );
    if (!inscripcion) return res.status(404).json({ message: 'Inscripción no encontrada' });

    return res.status(200).json({ message: 'Inscripción actualizada', data: inscripcion });
  } catch (error) {
    console.error('❌ Error al actualizar inscripción:', error);
    return res.status(500).json({ message: 'Error al actualizar la inscripción', error: error.message });
  }
};

// ============================================
// DELETE /api/torneos/:id/inscripciones/:insId — Eliminar una inscripción (admin)
// ============================================
export const deleteInscripcion = async (req, res) => {
  try {
    const { id, insId } = req.params;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(insId)) {
      return res.status(400).json({ message: 'ID inválido' });
    }
    const eliminada = await Inscripcion.findOneAndDelete({ _id: insId, torneoId: id });
    if (!eliminada) return res.status(404).json({ message: 'Inscripción no encontrada' });

    return res.status(200).json({ message: 'Inscripción eliminada', id: insId });
  } catch (error) {
    console.error('❌ Error al eliminar inscripción:', error);
    return res.status(500).json({ message: 'Error al eliminar la inscripción', error: error.message });
  }
};
