// ============================================
// SERVER.JS MEJORADO CON MANEJO DE IMÁGENES
// ============================================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import productsRoutes from "./routes/products.js";
import authRoutes from "./routes/auth.js";
import salesRoutes from "./routes/sales.js";
import pedidosRoutes from "./routes/pedidos.js";
import reportsRoutes from "./routes/reports.js";
import playsRoutes from "./routes/plays.js";
import monthlyReportRoutes from './routes/Monthlyreportplaysroutes.js';
import { handleMulterError } from './middlewares/upload.js';
import ahorroRoutes from './routes/ahorroRoutes.js';
import dns from 'dns';

// ⏱️ Marca de inicio real del proceso (cold start)
const PROCESS_START_TIME = Date.now();
const SERVER_START_TIME = Date.now();

// ============================================
// ✅ CONFIGURACIÓN DNS (IMPORTANTE - NO QUITAR)
// ============================================
dns.setDefaultResultOrder('ipv4first');

dotenv.config();

console.log("🚀 ========================================");
console.log("🚀 SERVIDOR INICIANDO...");
console.log("🚀 Timestamp:", new Date().toISOString());
console.log("🚀 ========================================");
console.log("✅ FRONTEND_URL:", process.env.FRONTEND_URL);

const app = express();
let firstRequest = true;
const PORT = process.env.PORT || 5000;

// Permitir localhost SIEMPRE (desarrollo y producción)
const allowedOrigins = [
  process.env.FRONTEND_URL, // Netlify
  "http://localhost:3000", // Para npm run prod
  "http://localhost:3001",
  "http://localhost:5173", // 🔥 Vite
].filter(Boolean);

console.log("🌍 Entorno:", process.env.NODE_ENV);
console.log("✅ CORS permitido desde:", allowedOrigins);

// ============================================
// ✅ CONFIGURACIÓN DE CORS
// ============================================
app.use(
  cors({
    origin: function (origin, callback) {
      // Permitir peticiones sin origin (Postman, Thunder Client)
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        console.log("❌ Origen bloqueado por CORS:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);

// ============================================
// ✅ AUMENTAR LÍMITES DE EXPRESS
// ============================================
app.use(express.json({ 
  limit: "10mb",
  timeout: 120000 // 2 minutos
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: "10mb",
  timeout: 120000
}));

console.log("✅ Límites de Express configurados: 10mb");

// ============================================
// CONEXIÓN A MONGODB
// ============================================
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      // Timeouts configurados para mejor manejo
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("✅ Conectado a MongoDB Atlas correctamente");
  } catch (err) {
    console.error("❌ Error al conectar a MongoDB:", err);
    process.exit(1);
  }
};

await connectDB();

// ============================================
// HEALTH CHECK (debe ir ANTES de las otras rutas)
// ============================================
app.get("/api/health", (req, res) => {
  if (firstRequest) {
    const coldStartTime = Date.now() - PROCESS_START_TIME;
    console.log("❄️ COLD START DETECTADO");
    console.log(`⏱️ Tiempo hasta primer request: ${coldStartTime} ms`);
    firstRequest = false;
  }

  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    limits: {
      json: "10mb",
      urlencoded: "10mb"
    }
  });
});

// ============================================
// RUTAS
// ============================================
// Rutas públicas
app.use("/api/auth", authRoutes);

// Rutas protegidas (requieren autenticación)
app.use("/api/products", productsRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/pedidos", pedidosRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/plays", playsRoutes);
app.use('/api/ahorro', ahorroRoutes);
app.use('/api/monthly-reports', monthlyReportRoutes);

// ============================================
// ✅ MIDDLEWARE DE ERRORES DE MULTER (IMPORTANTE)
// ============================================
// DEBE ir DESPUÉS de las rutas pero ANTES del middleware global de errores
app.use(handleMulterError);

// ============================================
// ✅ MIDDLEWARE GLOBAL DE ERRORES
// ============================================
app.use((err, req, res, next) => {
  console.error("❌ ERROR GLOBAL:", {
    message: err.message,
    name: err.name,
    code: err.code,
    stack: err.stack
  });

  // Error de tamaño de payload (cuando se supera el límite de Express)
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ 
      error: 'La petición es demasiado grande. Reduce el tamaño de los datos o la imagen.',
      code: 'PAYLOAD_TOO_LARGE',
      limit: '10mb'
    });
  }

  // Error de Cloudinary
  if (err.message && err.message.includes('cloudinary')) {
    return res.status(500).json({ 
      error: 'Error al subir imagen a Cloudinary. Por favor, intenta nuevamente.',
      code: 'CLOUDINARY_ERROR',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }

  // Error de MongoDB
  if (err.name === 'MongoError' || err.name === 'MongoServerError') {
    return res.status(500).json({ 
      error: 'Error de base de datos. Por favor, contacta al administrador.',
      code: 'DATABASE_ERROR',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }

  // Error de validación de Mongoose
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Error de validación en los datos',
      code: 'VALIDATION_ERROR',
      details: Object.values(err.errors).map(e => e.message)
    });
  }

  // Error de CORS
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      error: 'Origen no permitido por CORS',
      code: 'CORS_ERROR'
    });
  }

  // Error genérico
  res.status(500).json({ 
    error: err.message || 'Error interno del servidor',
    code: err.code || 'INTERNAL_ERROR',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, "0.0.0.0", () => {
  const startupTime = Date.now() - SERVER_START_TIME;
  console.log(`\n✅ Servidor corriendo en puerto ${PORT}`);
  console.log(`⏱️ Tiempo de inicio: ${startupTime}ms`);
  console.log("🌍 Entorno:", process.env.NODE_ENV);
  console.log("🚀 ========================================\n");
});

export { mongoose };