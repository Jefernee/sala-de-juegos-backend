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
import reportsRoutes from "./routes/Salereportroutes.js";
import playsRoutes from "./routes/plays.js";
import saleReportRoutes from './routes/Salereportroutes.js';
import monthlyReportRoutes from './routes/Monthlyreportplaysroutes.js';
import { handleMulterError } from './middlewares/upload.js';
import ahorroRoutes from './routes/ahorroRoutes.js';
// Hecho por Claude Code — Módulo de Administración
import gananciasRoutes from './routes/ganancias.js';
import pagosServiciosRoutes from './routes/pagosServicios.js';
import activosSalaRoutes from './routes/activosSala.js';
import activosReportRoutes from './routes/activosReportRoutes.js';
import { migrarPlacasActivos } from './utils/migrarPlacas.js';
import { migrarTotalControles } from './utils/migrarTotalControles.js';
// Hecho por Claude Code — Notificaciones de fin de sesión por WhatsApp (vía WAHA)
import { iniciarSchedulerFinSesion } from './utils/finSesionScheduler.js';
import dns from 'dns';

// ============================================
// ⚠️ CAPTURA DE SIGTERM Y SIGINT
// ============================================
process.on('SIGTERM', () => {
    console.error('⚠️ SIGTERM recibido. Posible terminación de contenedor por Koyeb.');
    console.error('📌 Estado antes de morir:', {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        connections: mongoose.connection.readyState
    });
    process.exit(0);
});

process.on('SIGINT', () => {
    console.error('⚠️ SIGINT recibido. Cerrando servidor...');
    process.exit(0);
});

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
const PORT = process.env.PORT || 8000;

// Permitir localhost SIEMPRE (desarrollo y producción)
// Normaliza quitando la barra final para que la comparación de orígenes no
// dependa de si la URL fue escrita con "/" al final o no. El navegador manda
// el header Origin SIN barra final; si la variable de entorno la trae, sin
// esta normalización el frontend quedaría bloqueado por CORS.
const normalizarOrigen = (url) => (url || '').replace(/\/+$/, '');

const allowedOrigins = [
  process.env.FRONTEND_URL, // Netlify
  "http://localhost:3000", // Para npm run prod
  "http://localhost:3001",
  "http://localhost:5173", // 🔥 Vite
].filter(Boolean).map(normalizarOrigen);

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

      // Comparamos ambos lados normalizados (sin barra final) para no depender
      // de cómo esté escrita la URL.
      if (allowedOrigins.indexOf(normalizarOrigen(origin)) !== -1) {
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
// Vigilantes de la conexión: si Atlas cierra la conexión (inactividad, corte de
// red), mongoose reintenta reconectar solo. Estos eventos lo dejan registrado
// en los logs para poder diagnosticar. No detienen el servidor.
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB DESCONECTADO. Mongoose intentará reconectar automáticamente...');
});
mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB RECONECTADO correctamente.');
});
mongoose.connection.on('error', (err) => {
  console.error('❌ Error de conexión MongoDB:', err.message);
});

const connectDB = async () => {
  try {
    // Si la conexión está caída, una query espera como máximo 8s y falla con un
    // error claro, en vez de quedarse "buffereada" colgada indefinidamente.
    // En Mongoose es una opción global (no de connect()).
    mongoose.set('bufferTimeoutMS', 8000);

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
// 🔢 MIGRACIÓN: número de placa de activos
// Idempotente. Asegura que todos los activos existentes tengan placa.
// Si falla, NO se detiene el servidor (no es crítico para arrancar).
// ============================================
try {
  const { asignados, ultimaPlaca } = await migrarPlacasActivos();
  if (asignados > 0) {
    console.log(`🔢 Placas asignadas a ${asignados} activo(s) existentes (hasta #${ultimaPlaca}).`);
  } else {
    console.log('🔢 Activos: todos ya tienen número de placa.');
  }
} catch (e) {
  console.error('⚠️ No se pudo migrar placas de activos (no crítico):', e.message);
}

// ============================================
// 🎮 MIGRACIÓN: totalControles en plays
// Idempotente. Backfillea los plays viejos que no tengan el campo.
// Si falla, NO se detiene el servidor (no es crítico para arrancar).
// ============================================
try {
  const { modificados } = await migrarTotalControles();
  if (modificados > 0) {
    console.log(`🎮 totalControles asignado a ${modificados} play(s) antiguos.`);
  } else {
    console.log('🎮 Plays: todos ya tienen totalControles.');
  }
} catch (e) {
  console.error('⚠️ No se pudo migrar totalControles (no crítico):', e.message);
}

// ============================================
// 🔔 NOTIFICACIONES DE FIN DE SESIÓN POR WHATSAPP
// Chequeador de respaldo (el motor principal es el Scheduled Trigger de Atlas).
// Solo arranca si NOTIFICACIONES_WHATSAPP_ENABLED === 'true'.
// No es crítico: si algo falla acá, el servidor sigue arrancando.
// ============================================
try {
  iniciarSchedulerFinSesion();
} catch (e) {
  console.error('⚠️ No se pudo iniciar el scheduler de WhatsApp (no crítico):', e.message);
}

// ============================================
// 📊 MONITOREO DE MEMORIA
// ============================================
const mem = process.memoryUsage();
if (mem.heapUsed > 100 * 1024 * 1024) {
  console.warn('⚠️ Alto uso de memoria:', mem);
}

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
app.use('/api/ventas-reports', saleReportRoutes);

// Hecho por Claude Code — Módulo de Administración (todas con Bearer token)
app.use('/api/ganancias', gananciasRoutes);
app.use('/api/pagos-servicios', pagosServiciosRoutes);
app.use('/api/activos-sala', activosSalaRoutes);
app.use('/api/activos-reports', activosReportRoutes);

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