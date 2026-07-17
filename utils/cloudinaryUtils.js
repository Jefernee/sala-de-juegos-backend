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

  const regex = /\/v\d+\/(.+?)(?:\.\w+)?$/;
  const match = url.match(regex);
  if (match) return match[1];

  // Fallback: buscar después de "upload/"
  const urlParts = url.split('/');
  const uploadIndex = urlParts.findIndex((part) => part === 'upload');
  if (uploadIndex !== -1 && uploadIndex + 2 < urlParts.length) {
    const pathAfterUpload = urlParts.slice(uploadIndex + 2).join('/');
    return pathAfterUpload.replace(/\.[^/.]+$/, '');
  }

  return null;
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
