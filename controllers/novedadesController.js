// controllers/novedadesController.js
// Módulo de Administración: Novedades de la página pública.
//
// - Público (sin login): GET /publicas → las publicadas y no vencidas, máximo 3.
// - Admin/colaborador (Bearer token; el guard global ya deja fuera al vendedor):
//   listar, crear, editar, borrar y reordenar.
import mongoose from 'mongoose';
import Novedad, { ETIQUETAS_NOVEDAD } from '../models/Novedad.js';
import { eliminarImagenCloudinary } from '../utils/cloudinaryUtils.js';
import cloudinary from '../config/cloudinary.js';

// Cuántas novedades salen en la página.
export const MAX_EN_PAGINA = 3;
const DIA_MS = 24 * 60 * 60 * 1000;

// "YYYY-MM-DD" → Date en medianoche de Costa Rica (06:00 UTC), igual que torneos.
// Retorna: Date | null (vacío) | undefined (inválida).
const parseFecha = (valor) => {
  if (valor === null || valor === '') return null;
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return undefined;
  const [anio, mes, dia] = valor.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia, 6, 0, 0, 0));
  if (isNaN(fecha.getTime()) || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return undefined;
  return fecha;
};

// ¿Ya pasó el fin del día (hora CR) de mostrarHasta? mostrarHasta es la
// medianoche CR de ese día, así que el día termina 24 h después.
export const estaVencida = (novedad, ahora = new Date()) => {
  if (!novedad.mostrarHasta) return false;
  return ahora.getTime() >= new Date(novedad.mostrarHasta).getTime() + DIA_MS;
};

const ordenarNovedades = (lista) =>
  [...lista].sort(
    (a, b) =>
      (a.orden ?? 0) - (b.orden ?? 0) ||
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );

// Agrega `lugar` (1..3 si sale en la página, null si no) y `vencida`.
// Recibe la lista COMPLETA ya ordenada.
export const decorarLista = (lista, ahora = new Date()) => {
  let lugar = 0;
  return lista.map((n) => {
    const vencida = estaVencida(n, ahora);
    const sale = n.publicada !== false && !vencida && lugar < MAX_EN_PAGINA;
    if (sale) lugar += 1;
    return { ...n, vencida, lugar: sale ? lugar : null };
  });
};

const limpiarImagenSubida = async (req) => {
  if (!req.cloudinaryPublicId) return;
  try {
    await cloudinary.uploader.destroy(req.cloudinaryPublicId);
  } catch (e) {
    console.error('❌ No se pudo limpiar Cloudinary:', e.message);
  }
};

// Solo se borra un afiche que se SUBIÓ desde la novedad (aficheSubido). Una
// URL de Cloudinary puede ser la carátula de un juego del catálogo: borrarla
// dejaría al juego sin portada en toda la página.
export const debeBorrarAfiche = ({ afiche, aficheSubido } = {}) =>
  Boolean(aficheSubido && afiche && /res\.cloudinary\.com/.test(afiche));

const borrarAficheSiEsPropio = async (datos) => {
  if (debeBorrarAfiche(datos)) await eliminarImagenCloudinary(datos.afiche);
};

const aficheValido = (v) => typeof v === 'string' && /^(\/|https?:\/\/)\S+$/.test(v.trim());

// Valida y arma los campos editables. Retorna { error } o { campos }.
export const construirCampos = (body, { requeridos }) => {
  const campos = {};

  if (body.titulo !== undefined || requeridos) {
    const titulo = String(body.titulo ?? '').trim();
    if (!titulo) return { error: 'El título de la novedad es obligatorio' };
    if (titulo.length > 80) return { error: 'El título no puede pasar de 80 caracteres' };
    campos.titulo = titulo;
  }

  if (body.texto !== undefined) {
    const texto = String(body.texto ?? '').trim();
    if (texto.length > 400) return { error: 'El texto no puede pasar de 400 caracteres' };
    campos.texto = texto;
  }

  if (body.etiqueta !== undefined) {
    if (!ETIQUETAS_NOVEDAD.includes(body.etiqueta)) {
      return { error: `etiqueta inválida. Valores válidos: ${ETIQUETAS_NOVEDAD.join(', ')}` };
    }
    campos.etiqueta = body.etiqueta;
  }

  if (body.juego !== undefined) campos.juego = body.juego ? String(body.juego).trim() || null : null;

  if (body.publicada !== undefined) {
    if (typeof body.publicada !== 'boolean') return { error: 'publicada debe ser true o false' };
    campos.publicada = body.publicada;
  }

  if (body.orden !== undefined && body.orden !== null && body.orden !== '') {
    const n = Number(body.orden);
    if (!Number.isFinite(n)) return { error: 'orden debe ser un número' };
    campos.orden = n;
  }

  if (body.mostrarHasta !== undefined) {
    const f = parseFecha(body.mostrarHasta);
    if (f === undefined) return { error: 'mostrarHasta debe tener formato YYYY-MM-DD' };
    campos.mostrarHasta = f;
  }

  return { campos };
};

// ============================================
// GET /api/novedades/publicas — Para la página (SIN login)
// ============================================
export const getNovedadesPublicas = async (req, res) => {
  try {
    const lista = await Novedad.find({ publicada: true })
      .select('titulo texto etiqueta afiche juego orden createdAt mostrarHasta')
      .sort({ orden: 1, createdAt: -1 })
      .lean();
    const ahora = new Date();
    const data = ordenarNovedades(lista)
      .filter((n) => !estaVencida(n, ahora))
      .slice(0, MAX_EN_PAGINA)
      .map((n) => ({
        _id: n._id,
        titulo: n.titulo,
        texto: n.texto || '',
        etiqueta: n.etiqueta,
        afiche: n.afiche,
        juego: n.juego || null,
      }));
    return res.status(200).json({ data });
  } catch (error) {
    console.error('❌ Error al listar novedades públicas:', error);
    return res.status(500).json({ message: 'Error al listar las novedades', error: error.message });
  }
};

// ============================================
// GET /api/novedades — Todas, con `lugar` y `vencida` (admin/colaborador)
// ============================================
export const getNovedades = async (req, res) => {
  try {
    const lista = await Novedad.find().sort({ orden: 1, createdAt: -1 }).lean();
    return res.status(200).json({ data: decorarLista(ordenarNovedades(lista)) });
  } catch (error) {
    console.error('❌ Error al listar novedades:', error);
    return res.status(500).json({ message: 'Error al listar las novedades', error: error.message });
  }
};

// ============================================
// POST /api/novedades — Crear (afiche vía uploadBase64ToCloudinary)
// Si no llega `orden`, va al final.
// ============================================
export const addNovedad = async (req, res) => {
  try {
    const { error, campos } = construirCampos(req.body, { requeridos: true });
    if (error) {
      await limpiarImagenSubida(req);
      return res.status(400).json({ message: error });
    }

    const afiche = req.cloudinaryUrl || (aficheValido(req.body.afiche) ? req.body.afiche.trim() : null);
    if (!afiche) {
      await limpiarImagenSubida(req);
      return res.status(400).json({ message: 'El afiche de la novedad es obligatorio' });
    }

    if (campos.orden === undefined) {
      const ultima = await Novedad.findOne().sort({ orden: -1 }).select('orden').lean();
      campos.orden = ultima ? (ultima.orden ?? 0) + 1 : 0;
    }

    const guardada = await new Novedad({ ...campos, afiche, aficheSubido: Boolean(req.cloudinaryUrl) }).save();
    console.log(`✅ Novedad "${guardada.titulo}" creada`);
    return res.status(201).json({ message: 'Novedad creada', data: guardada.toObject() });
  } catch (error) {
    console.error('❌ Error al crear novedad:', error);
    await limpiarImagenSubida(req);
    return res.status(500).json({ message: 'Error al crear la novedad', error: error.message });
  }
};

// ============================================
// PUT /api/novedades/:id — Editar (el afiche es opcional)
// ============================================
export const updateNovedad = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      await limpiarImagenSubida(req);
      return res.status(400).json({ message: 'ID de novedad inválido' });
    }
    const novedad = await Novedad.findById(req.params.id);
    if (!novedad) {
      await limpiarImagenSubida(req);
      return res.status(404).json({ message: 'Novedad no encontrada' });
    }

    const { error, campos } = construirCampos(req.body, { requeridos: false });
    if (error) {
      await limpiarImagenSubida(req);
      return res.status(400).json({ message: error });
    }

    // El afiche viejo se borra DESPUÉS de guardar (igual que torneos).
    // Se guarda el afiche anterior con su marca para decidir después si se borra.
    const anterior = { afiche: novedad.afiche, aficheSubido: novedad.aficheSubido };
    let aficheAnteriorABorrar = null;
    if (req.cloudinaryUrl) {
      campos.afiche = req.cloudinaryUrl;
      campos.aficheSubido = true;
      aficheAnteriorABorrar = anterior;
    } else if (req.body.afiche !== undefined) {
      if (!aficheValido(req.body.afiche)) {
        return res.status(400).json({ message: 'El afiche debe ser una URL o una ruta válida' });
      }
      if (req.body.afiche.trim() !== novedad.afiche) {
        campos.afiche = req.body.afiche.trim();
        campos.aficheSubido = false;
        aficheAnteriorABorrar = anterior;
      }
    }

    if (Object.keys(campos).length === 0) {
      return res.status(400).json({ message: 'No se enviaron campos para actualizar' });
    }

    Object.assign(novedad, campos);
    const guardada = await novedad.save();
    if (aficheAnteriorABorrar) await borrarAficheSiEsPropio(aficheAnteriorABorrar);

    console.log(`✅ Novedad "${guardada.titulo}" actualizada`);
    return res.status(200).json({ message: 'Novedad actualizada', data: guardada.toObject() });
  } catch (error) {
    console.error('❌ Error al actualizar novedad:', error);
    await limpiarImagenSubida(req);
    return res.status(500).json({ message: 'Error al actualizar la novedad', error: error.message });
  }
};

// ============================================
// DELETE /api/novedades/:id
// ============================================
export const deleteNovedad = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'ID de novedad inválido' });
    }
    const novedad = await Novedad.findById(req.params.id);
    if (!novedad) return res.status(404).json({ message: 'Novedad no encontrada' });

    const aficheABorrar = { afiche: novedad.afiche, aficheSubido: novedad.aficheSubido };
    await Novedad.findByIdAndDelete(novedad._id);
    await borrarAficheSiEsPropio(aficheABorrar);

    console.log(`✅ Novedad "${novedad.titulo}" eliminada`);
    return res.status(200).json({ message: 'Novedad eliminada', id: req.params.id });
  } catch (error) {
    console.error('❌ Error al eliminar novedad:', error);
    return res.status(500).json({ message: 'Error al eliminar la novedad', error: error.message });
  }
};

// ============================================
// PUT /api/novedades/orden — body { ids: [...] } → orden 0..n según el arreglo.
// Las que no vengan en el arreglo quedan después, en su orden actual.
// ============================================
export const reordenarNovedades = async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'ids debe ser un arreglo con al menos una novedad' });
    }
    if (!ids.every((id) => mongoose.isValidObjectId(id))) {
      return res.status(400).json({ message: 'Hay IDs de novedad inválidos' });
    }
    const textos = ids.map(String);
    if (new Set(textos).size !== textos.length) {
      return res.status(400).json({ message: 'Hay IDs de novedad repetidos' });
    }

    const todas = await Novedad.find().sort({ orden: 1, createdAt: -1 }).select('_id').lean();
    const existentes = new Set(todas.map((n) => String(n._id)));
    if (!textos.every((id) => existentes.has(id))) {
      return res.status(404).json({ message: 'Alguna novedad no existe' });
    }

    const resto = todas.map((n) => String(n._id)).filter((id) => !textos.includes(id));
    const finalOrden = [...textos, ...resto];
    await Novedad.bulkWrite(
      finalOrden.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { orden: i } } } }))
    );

    const lista = await Novedad.find().sort({ orden: 1, createdAt: -1 }).lean();
    return res.status(200).json({ message: 'Orden actualizado', data: decorarLista(ordenarNovedades(lista)) });
  } catch (error) {
    console.error('❌ Error al reordenar novedades:', error);
    return res.status(500).json({ message: 'Error al reordenar las novedades', error: error.message });
  }
};
