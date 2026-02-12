// middlewares/upload.js — VERSIÓN OPTIMIZADA BASE64
import { v2 as cloudinary } from "cloudinary";

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Sube una imagen base64 a Cloudinary de forma directa y eficiente.
 * Espera que req.body contenga:
 *   - imagenBase64  : string  "data:image/jpeg;base64,..."
 *   - imagenNombre  : string  (opcional, para logs)
 *   - imagenMimeType: string  (opcional)
 */
export const uploadBase64ToCloudinary = async (req, res, next) => {
  const { imagenBase64, imagenNombre, imagenMimeType } = req.body;

  // Si no viene imagen, continuar sin error
  if (!imagenBase64) {
    return next();
  }

  try {
    // Validar que sea un data URL válido
    if (!imagenBase64.startsWith("data:image/")) {
      return res.status(400).json({
        error: "La imagen debe ser un data URL válido (data:image/...;base64,...)",
        code: "INVALID_IMAGE_FORMAT",
      });
    }

    // Validar formato permitido
    const allowedMimes = ["data:image/jpeg", "data:image/jpg", "data:image/png", "data:image/webp"];
    const mimePrefix = imagenBase64.substring(0, imagenBase64.indexOf(";"));
    if (!allowedMimes.some((m) => imagenBase64.startsWith(m))) {
      return res.status(415).json({
        error: "Formato de imagen no soportado. Usa JPG, PNG o WebP.",
        code: "UNSUPPORTED_FORMAT",
        received: mimePrefix,
      });
    }

    // Validar tamaño aproximado del base64
    const base64Data = imagenBase64.split(",")[1];
    if (!base64Data) {
      return res.status(400).json({
        error: "La imagen base64 está malformada.",
        code: "MALFORMED_BASE64",
      });
    }

    const approximateSizeBytes = Math.ceil((base64Data.length * 3) / 4);
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB

    if (approximateSizeBytes > MAX_SIZE) {
      const sizeMB = (approximateSizeBytes / (1024 * 1024)).toFixed(2);
      return res.status(413).json({
        error: `La imagen es demasiado grande (${sizeMB} MB). El límite es 5 MB.`,
        code: "FILE_TOO_LARGE",
        limit: "5MB",
      });
    }

    console.log("📤 Subiendo imagen a Cloudinary:", {
      nombre: imagenNombre || "sin-nombre",
      tipo: mimePrefix.replace("data:", ""),
      tamañoAprox: `${(approximateSizeBytes / 1024).toFixed(2)} KB`,
    });

    const inicioUpload = Date.now();

    // ✅ MÉTODO DIRECTO: Cloudinary acepta data URIs directamente
    const result = await cloudinary.uploader.upload(imagenBase64, {
      folder: "productos",
      allowed_formats: ["jpg", "jpeg", "png", "webp"],
      transformation: [{ width: 1000, height: 1000, crop: "limit" }],
      resource_type: "image",
      timeout: 60000, // 60 segundos
    });

    const tiempoUpload = Date.now() - inicioUpload;
    console.log(`✅ Imagen subida a Cloudinary en ${tiempoUpload}ms`);
    console.log(`   URL: ${result.secure_url}`);
    console.log(`   Public ID: ${result.public_id}`);

    // Adjuntar datos al request para el controlador
    req.cloudinaryUrl = result.secure_url;
    req.cloudinaryPublicId = result.public_id;

    // Limpiar campos base64 del body para no guardarlos en MongoDB
    delete req.body.imagenBase64;
    delete req.body.imagenNombre;
    delete req.body.imagenMimeType;

    next();
  } catch (error) {
    console.error("❌ Error al subir a Cloudinary:", {
      message: error.message,
      http_code: error.http_code,
      name: error.name,
    });

    // Mensajes más específicos según el tipo de error
    if (error.http_code === 499 || error.message?.includes("timeout")) {
      return res.status(504).json({
        error: "Timeout al subir la imagen. Intenta con una imagen más pequeña o verifica tu conexión.",
        code: "CLOUDINARY_TIMEOUT",
      });
    }

    if (error.http_code === 400) {
      return res.status(400).json({
        error: "Formato de imagen inválido o datos corruptos.",
        code: "INVALID_IMAGE",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }

    return res.status(500).json({
      error: "Error al subir la imagen a Cloudinary. Intenta nuevamente.",
      code: "CLOUDINARY_ERROR",
      details: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Maneja errores de payload demasiado grande
 */
export const handleMulterError = (err, req, res, next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      error: "La petición es demasiado grande. Reduce el tamaño de la imagen.",
      code: "PAYLOAD_TOO_LARGE",
    });
  }
  next(err);
};

export default {};


