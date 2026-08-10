// utils/cloudinaryUtils.js
// Utilidades reutilizables para Cloudinary.
// Centraliza la extracción del public_id y la eliminación de imágenes,
// misma lógica que ya se usa en inventarioController.
import cloudinary from '../config/cloudinary.js';

/**
 * Extrae el public_id de una URL de Cloudinary.
 * Ej: https://res.cloudinary.com/xxx/image/upload/v123/activos-sala/abc.jpg
 *     → "activos-sala/abc"
 * @param {string|null} url - URL de la imagen en Cloudinary
 * @returns {string|null} public_id o null si no se pudo extraer
 */
export const extraerPublicId = (url) => {
  if (!url) return null;

  // Se ignora cualquier ?query al final antes de mirar la extensión.
  const limpia = String(url).split('?')[0];

  // Caso normal: Cloudinary siempre pone /v<versión>/ en la URL que devuelve al
  // subir. Todo lo que va después es el public_id (con su carpeta), y esto
  // funciona aunque haya transformaciones antes de la versión.
  const match = limpia.match(/\/v\d+\/(.+?)(?:\.\w+)?$/);
  if (match) return match[1];

  // Respaldo para URLs sin versión: se toma todo lo que sigue a "upload/".
  // Antes se cortaba por índice saltando DOS segmentos, dando por hecho que uno
  // era la versión; sin versión, ese salto se comía la carpeta y devolvía
  // "abc123" en vez de "productos/abc123". Cloudinary no encontraba ese
  // public_id, respondía "not found" y la imagen quedaba huérfana en silencio.
  const despuesDeUpload = limpia.split('/upload/')[1];
  if (!despuesDeUpload) return null;

  const sinVersion = despuesDeUpload.replace(/^v\d+\//, '');
  return sinVersion.replace(/\.[^/.]+$/, '') || null;
};

/**
 * Elimina una imagen de Cloudinary a partir de su URL.
 * Nunca lanza error (solo lo registra) para no romper el flujo principal.
 * @param {string|null} url - URL de la imagen a eliminar
 * @returns {Promise<boolean>} true si se eliminó correctamente
 */
export const eliminarImagenCloudinary = async (url) => {
  const publicId = extraerPublicId(url);
  if (!publicId) {
    if (url) console.warn('⚠️ No se pudo extraer el public_id de la URL:', url);
    return false;
  }

  try {
    console.log('🗑️ Eliminando imagen de Cloudinary:', publicId);
    const result = await cloudinary.uploader.destroy(publicId);
    console.log('   Resultado:', result);
    return result.result === 'ok';
  } catch (error) {
    console.error('❌ Error al eliminar imagen de Cloudinary:', error.message);
    return false;
  }
};
