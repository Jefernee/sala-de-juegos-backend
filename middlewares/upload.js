// middlewares/upload.js
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configurar storage de Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "productos",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ width: 1000, height: 1000, crop: "limit" }],
  },
});

// ✅ FILTRO CORREGIDO - EXACTAMENTE 5MB
const fileFilter = (req, file, cb) => {
  // Validar tipo MIME
  const allowedMimes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  
  if (!allowedMimes.includes(file.mimetype)) {
    return cb(
      new Error(
        "Formato de imagen no válido. Solo se permiten JPG, PNG o WebP.",
      ),
      false,
    );
  }

  cb(null, true);
};

// ✅ MULTER CON LÍMITE EXACTO DE 5MB
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // ⚠️ 5MB EXACTOS - CORREGIDO
  },
});

// Middleware para manejar errores de Multer
export const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error("❌ Error de Multer:", err);
    
    if (err.code === "FILE_TOO_LARGE") {
      return res.status(413).json({
        error: "El archivo es demasiado grande. El límite es 5MB.",
        code: "FILE_TOO_LARGE",
        limit: "5MB",
      });
    }
    
    return res.status(400).json({
      error: `Error al subir archivo: ${err.message}`,
      code: err.code,
    });
  }
  
  next(err);
};

export default upload;


