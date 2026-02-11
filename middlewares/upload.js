// middlewares/upload.js
import multer from 'multer';

console.log("✅ Middleware de upload cargado");

// ============================================
// CONFIGURACIÓN DE MULTER
// ============================================

// Usar memoria en lugar de disco (más rápido y compatible con Cloudinary)
const storage = multer.memoryStorage();

// Filtro de archivos permitidos
const fileFilter = (req, file, cb) => {
  console.log("🔍 Validando archivo:", {
    fieldname: file.fieldname,
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size
  });

  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  
  if (allowedTypes.includes(file.mimetype)) {
    console.log("✅ Tipo de archivo válido:", file.mimetype);
    cb(null, true);
  } else {
    console.error("❌ Tipo de archivo no válido:", file.mimetype);
    const error = new Error(
      `Formato no soportado: ${file.mimetype}. Solo se permiten: JPG, PNG, WebP`
    );
    error.code = 'INVALID_FILE_TYPE';
    cb(error, false);
  }
};

// Configuración de Multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB (debe ser mayor o igual al límite del frontend)
    files: 1, // Solo 1 archivo a la vez
  },
});

// ============================================
// MIDDLEWARE DE MANEJO DE ERRORES DE MULTER
// ============================================
export const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error("❌ Error de Multer:", err);
    
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ 
        error: 'El archivo es demasiado grande. Máximo permitido: 10 MB',
        code: 'FILE_TOO_LARGE',
        maxSize: '10 MB'
      });
    }
    
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ 
        error: 'Solo se permite subir 1 archivo a la vez',
        code: 'TOO_MANY_FILES'
      });
    }
    
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ 
        error: 'Campo de archivo inesperado. Usa el campo "imagen"',
        code: 'UNEXPECTED_FIELD',
        expectedField: 'imagen'
      });
    }
    
    return res.status(400).json({ 
      error: `Error al procesar el archivo: ${err.message}`,
      code: err.code
    });
  }

  if (err && err.code === 'INVALID_FILE_TYPE') {
    return res.status(415).json({ 
      error: err.message,
      code: 'INVALID_FILE_TYPE'
    });
  }

  // Si no es un error de Multer, pasar al siguiente middleware
  next(err);
};

export default upload;



