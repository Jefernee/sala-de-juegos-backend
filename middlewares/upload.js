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

// ─────────────────────────────────────────────────────────────────
// Hecho por Claude Code — Subida de imágenes para ACTIVOS DE LA SALA
// Procesa hasta TRES imágenes base64 del body con las mismas
// validaciones que uploadBase64ToCloudinary:
//   - imagenBase64                  → req.cloudinaryUrl                  (foto del artículo)
//   - imagenFacturaBase64           → req.cloudinaryFacturaUrl           (factura de compra)
//   - imagenFacturaReparacionBase64 → req.cloudinaryFacturaReparacionUrl (factura de reparación)
// Si una falla después de subir las otras, se hace rollback en Cloudinary.
// ─────────────────────────────────────────────────────────────────

const ALLOWED_MIMES = ["data:image/jpeg", "data:image/jpg", "data:image/png", "data:image/webp"];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Valida un data URL base64. Retorna null si es válido,
 * o un objeto { status, body } con el error a responder.
 */
const validarImagenBase64 = (imagenBase64, etiqueta) => {
  if (!imagenBase64.startsWith("data:image/")) {
    return {
      status: 400,
      body: {
        message: `La ${etiqueta} debe ser un data URL válido (data:image/...;base64,...)`,
        code: "INVALID_IMAGE_FORMAT",
      },
    };
  }

  const mimePrefix = imagenBase64.substring(0, imagenBase64.indexOf(";"));
  if (!ALLOWED_MIMES.some((m) => imagenBase64.startsWith(m))) {
    return {
      status: 415,
      body: {
        message: `Formato de ${etiqueta} no soportado. Usa JPG, PNG o WebP.`,
        code: "UNSUPPORTED_FORMAT",
        received: mimePrefix,
      },
    };
  }

  const base64Data = imagenBase64.split(",")[1];
  if (!base64Data) {
    return {
      status: 400,
      body: { message: `La ${etiqueta} base64 está malformada.`, code: "MALFORMED_BASE64" },
    };
  }

  const approximateSizeBytes = Math.ceil((base64Data.length * 3) / 4);
  if (approximateSizeBytes > MAX_IMAGE_SIZE) {
    const sizeMB = (approximateSizeBytes / (1024 * 1024)).toFixed(2);
    return {
      status: 413,
      body: {
        message: `La ${etiqueta} es demasiado grande (${sizeMB} MB). El límite es 5 MB.`,
        code: "FILE_TOO_LARGE",
        limit: "5MB",
      },
    };
  }

  return null; // válida
};

export const uploadActivoImagesToCloudinary = async (req, res, next) => {
  // Definición de los dos campos de imagen que puede traer el body
  const campos = [
    {
      bodyBase64: "imagenBase64",
      bodyNombre: "imagenNombre",
      bodyMime: "imagenMimeType",
      reqUrl: "cloudinaryUrl",
      reqPublicId: "cloudinaryPublicId",
      etiqueta: "imagen del artículo",
    },
    {
      bodyBase64: "imagenFacturaBase64",
      bodyNombre: "imagenFacturaNombre",
      bodyMime: "imagenFacturaMimeType",
      reqUrl: "cloudinaryFacturaUrl",
      reqPublicId: "cloudinaryFacturaPublicId",
      etiqueta: "imagen de la factura",
    },
    {
      bodyBase64: "imagenFacturaReparacionBase64",
      bodyNombre: "imagenFacturaReparacionNombre",
      bodyMime: "imagenFacturaReparacionMimeType",
      reqUrl: "cloudinaryFacturaReparacionUrl",
      reqPublicId: "cloudinaryFacturaReparacionPublicId",
      etiqueta: "imagen de la factura de reparación",
    },
  ];

  const publicIdsSubidos = []; // para rollback si algo falla a medio camino

  const rollback = async () => {
    for (const publicId of publicIdsSubidos) {
      try {
        console.log("🧹 Rollback: eliminando imagen de Cloudinary:", publicId);
        await cloudinary.uploader.destroy(publicId);
      } catch (cleanupError) {
        console.error("❌ No se pudo limpiar Cloudinary en rollback:", cleanupError.message);
      }
    }
  };

  try {
    for (const campo of campos) {
      const imagenBase64 = req.body[campo.bodyBase64];

      // Imagen opcional: si no viene, continuar con la siguiente
      if (!imagenBase64) continue;

      // Validar antes de subir
      const errorValidacion = validarImagenBase64(imagenBase64, campo.etiqueta);
      if (errorValidacion) {
        await rollback();
        return res.status(errorValidacion.status).json(errorValidacion.body);
      }

      const base64Data = imagenBase64.split(",")[1];
      const approximateSizeBytes = Math.ceil((base64Data.length * 3) / 4);

      console.log(`📤 Subiendo ${campo.etiqueta} a Cloudinary:`, {
        nombre: req.body[campo.bodyNombre] || "sin-nombre",
        tamañoAprox: `${(approximateSizeBytes / 1024).toFixed(2)} KB`,
      });

      const inicioUpload = Date.now();

      const result = await cloudinary.uploader.upload(imagenBase64, {
        folder: "activos-sala",
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
        transformation: [{ width: 1000, height: 1000, crop: "limit" }],
        resource_type: "image",
        timeout: 60000,
      });

      console.log(`✅ ${campo.etiqueta} subida en ${Date.now() - inicioUpload}ms → ${result.secure_url}`);

      req[campo.reqUrl] = result.secure_url;
      req[campo.reqPublicId] = result.public_id;
      publicIdsSubidos.push(result.public_id);

      // Limpiar campos base64 del body para no guardarlos en MongoDB
      delete req.body[campo.bodyBase64];
      delete req.body[campo.bodyNombre];
      delete req.body[campo.bodyMime];
    }

    next();
  } catch (error) {
    console.error("❌ Error al subir imagen de activo a Cloudinary:", {
      message: error.message,
      http_code: error.http_code,
      name: error.name,
    });

    await rollback();

    if (error.http_code === 499 || error.message?.includes("timeout")) {
      return res.status(504).json({
        message: "Timeout al subir la imagen. Intenta con una imagen más pequeña o verifica tu conexión.",
        code: "CLOUDINARY_TIMEOUT",
      });
    }

    if (error.http_code === 400) {
      return res.status(400).json({
        message: "Formato de imagen inválido o datos corruptos.",
        code: "INVALID_IMAGE",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }

    return res.status(500).json({
      message: "Error al subir la imagen a Cloudinary. Intenta nuevamente.",
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


