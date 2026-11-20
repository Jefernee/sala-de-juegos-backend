// models/Novedad.js
// Módulo de Administración: Novedades de la página pública.
//
// Lo que se muestra en la portada como "lo nuevo" de la sala (un juego recién
// llegado, una promoción). Se manejan desde Administración: crear, editar,
// borrar, publicar/ocultar y ordenar. La página muestra como máximo 3 (la 1.ª
// grande). Los torneos NO son novedades: tienen su propio módulo.
import mongoose from 'mongoose';

export const ETIQUETAS_NOVEDAD = ['Recién llegado', 'Nuevo juego', 'Promoción'];

const novedadSchema = new mongoose.Schema(
  {
    titulo: {
      type: String,
      required: [true, 'El título de la novedad es obligatorio'],
      trim: true,
      maxlength: [80, 'El título no puede pasar de 80 caracteres'],
    },
    // Texto corto (2-3 oraciones).
    texto: {
      type: String,
      trim: true,
      maxlength: [400, 'El texto no puede pasar de 400 caracteres'],
      default: '',
    },
    etiqueta: {
      type: String,
      enum: { values: ETIQUETAS_NOVEDAD, message: 'Etiqueta inválida: {VALUE}' },
      default: 'Nuevo juego',
    },
    // URL de Cloudinary o ruta relativa del frontend (ej. '/afiche-fc27.jpg').
    afiche: {
      type: String,
      required: [true, 'El afiche de la novedad es obligatorio'],
    },
    // true SOLO si el afiche se subió desde esta novedad. Es lo único que se
    // puede borrar de Cloudinary: si el afiche es la carátula de un juego del
    // catálogo ("Usar la imagen del juego"), borrarlo dejaría al juego sin
    // portada en toda la página.
    aficheSubido: { type: Boolean, default: false },
    // Nombre de un juego del catálogo (models/Juego.js): su carátula encabeza
    // el collage de la portada.
    juego: { type: String, default: null, trim: true },
    publicada: { type: Boolean, default: true },
    // Menor = primero.
    orden: { type: Number, default: 0 },
    // Pasada esta fecha (fin del día en Costa Rica) deja de mostrarse aunque
    // siga publicada. Se guarda como medianoche CR del día indicado.
    mostrarHasta: { type: Date, default: null },
  },
  { timestamps: true }
);

novedadSchema.index({ orden: 1, createdAt: -1 });

export default mongoose.model('Novedad', novedadSchema);
