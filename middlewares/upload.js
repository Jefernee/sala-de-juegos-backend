// middlewares/upload.js - VERSIÓN CORREGIDA (SIN multer-storage-cloudinary)
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ✅ Storage en memoria
const storage = multer.memoryStorage();

// ✅ Filtro de archivos
const fileFilter = (req, file, cb) => {
  const allowedMimes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  
  if (!allowedMimes.includes(file.mimetype)) {
    return cb(new Error("Formato de imagen no válido. Solo se permiten JPG, PNG o WebP."), false);
  }
  cb(null, true);
};

// ✅ Configuración de Multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

// ✅ Middleware para subir a Cloudinary manualmente
export const uploadToCloudinary = async (req, res, next) => {
  if (!req.file) {
    return next();
  }

  try {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "productos",
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
        transformation: [{ width: 1000, height: 1000, crop: "limit" }],
      },
      (error, result) => {
        if (error) {
          console.error("❌ Error subiendo a Cloudinary:", error);
          return res.status(500).json({ 
            error: "Error al subir la imagen a Cloudinary",
            details: error.message 
          });
        }
        
        // ✅ Guardar la URL en req.file
        req.file.path = result.secure_url;
        req.file.cloudinary_id = result.public_id;
        next();
      }
    );

    streamifier.createReadStream(req.file.buffer).pipe(stream);
  } catch (error) {
    console.error("❌ Error en uploadToCloudinary:", error);
    next(error);
  }
};

// ✅ Middleware para manejar errores de Multer
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


