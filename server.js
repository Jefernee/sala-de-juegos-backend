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
// Módulo de Administración
import gananciasRoutes from './routes/ganancias.js';
import pagosServiciosRoutes from './routes/pagosServicios.js';
import activosSalaRoutes from './routes/activosSala.js';
import activosReportRoutes from './routes/activosReportRoutes.js';
import estadoResultadosRoutes from './routes/estadoResultados.js';
import torneosRoutes from './routes/torneos.js';
// Finanzas Personales del administrador (módulo APARTE de la sala de juegos)
import finanzasPersonalesRoutes from './routes/finanzasPersonales.js';
import { migrarPlacasActivos } from './utils/migrarPlacas.js';
import { migrarTotalControles } from './utils/migrarTotalControles.js';
import { migrarMontoPagado } from './utils/migrarMontoPagado.js';
import { migrarCategoriaActivos } from './utils/migrarCategoriaActivos.js';
import { migrarCategoriaCallOfDuty2 } from './utils/migrarCategoriaCallOfDuty2.js';
import { migrarRolesUsuarios } from './utils/migrarRolesUsuarios.js';
import { restringirVendedor } from './middlewares/roles.js';
import { migrarReparacionesActivos } from './utils/migrarReparacionesActivos.js';
import { backfillEstadoResultados } from './utils/backfillEstadoResultados.js';
import { regenerarReporteActivos } from './controllers/activosReportController.js';
import { migrarAhorroMovimientos } from './utils/migrarAhorroMovimientos.js';
// Notificaciones de fin de sesión por WhatsApp (vía WAHA)
import { iniciarSchedulerFinSesion } from './utils/finSesionScheduler.js';
// Alertas por correo cuando algo se rompe (ver utils/alertasEmail.js)
import { alertarErrorBackend, alertarRespuesta5xx } from './utils/alertasEmail.js';
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

// ============================================
// 💥 ERRORES QUE NO PASAN POR NINGUNA RUTA
// ============================================
// El middleware global de errores solo ve lo que revienta DENTRO de una
// petición. Un fallo en el scheduler, en una tarea de arranque o en cualquier
// promesa suelta no llega ahí y antes se perdía en los logs. Estos dos
// vigilantes mandan la alerta por correo.
process.on('unhandledRejection', (motivo) => {
    const err = motivo instanceof Error ? motivo : new Error(String(motivo));
    console.error('⚠️ Promesa rechazada sin manejar:', err.message);
    alertarErrorBackend(err, { origen: 'promesa sin manejar' });
});

process.on('uncaughtException', async (err) => {
    console.error('💥 Excepción no controlada:', err);
    // El proceso va a morir igual (es el comportamiento normal de node). Le
    // damos hasta 5s al correo para que salga antes, y ni un segundo más:
    // Koyeb tiene que poder reiniciar rápido.
    await Promise.race([
        alertarErrorBackend(err, { origen: 'excepción no controlada' }),
        new Promise((resolve) => setTimeout(resolve, 5000)),
    ]).catch(() => {});
    process.exit(1);
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

// Conexión a MongoDB. NO bloquea el arranque: se llama DESPUÉS de empezar a
// escuchar, así /api/health responde al instante en un cold start de Koyeb y
// la plataforma deja de quedarse "cargando". Mientras conecta, mongoose
// bufferea las queries hasta 8s. Si la conexión falla, REINTENTA solo (no mata
// el proceso) para no entrar en un loop de reinicios. Al conectar por primera
// vez dispara las tareas de arranque (que necesitan la base lista).
let arranqueDisparado = false;
const connectDB = async () => {
  try {
    // Si la conexión está caída, una query espera como máximo 8s y falla con un
    // error claro, en vez de quedarse "buffereada" colgada indefinidamente.
    mongoose.set('bufferTimeoutMS', 8000);

    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10, // instancia chica: pool acotado y reutilizable
    });
    console.log("✅ Conectado a MongoDB Atlas correctamente");

    if (!arranqueDisparado) {
      arranqueDisparado = true;
      if (process.env.EJECUTAR_MIGRACIONES === 'false') {
        console.log('⏭️  Tareas de arranque OMITIDAS (EJECUTAR_MIGRACIONES=false).');
      } else {
        tareasDeArranque();
      }
    }
  } catch (err) {
    console.error("❌ No se pudo conectar a MongoDB, reintento en 5s:", err.message);
    setTimeout(connectDB, 5000);
  }
};

// ============================================
// 🔧 TAREAS DE ARRANQUE (se ejecutan EN SEGUNDO PLANO tras el listen)
// Migraciones idempotentes + backfills + scheduler. Antes se corrían ANTES
// del listen y BLOQUEABAN el arranque: en local, con Atlas remoto, cada una
// hace consultas de ida y vuelta y el server tardaba varios segundos en
// responder. Ahora corren DESPUÉS de escuchar, así el arranque es inmediato.
// Todas son no críticas: si una falla, el servidor sigue igual. Solo se
// registra en consola cuando REALMENTE cambian algo (no en cada arranque).
// ============================================
const tareasDeArranque = async () => {
  console.log('🔧 Tareas de arranque corriendo en segundo plano...');

  try {
    const { asignados, ultimaPlaca } = await migrarPlacasActivos();
    if (asignados > 0) console.log(`🔢 Placas asignadas a ${asignados} activo(s) (hasta #${ultimaPlaca}).`);
  } catch (e) {
    console.error('⚠️ Migración placas (no crítico):', e.message);
  }

  try {
    const { modificados } = await migrarTotalControles();
    if (modificados > 0) console.log(`🎮 totalControles asignado a ${modificados} play(s).`);
  } catch (e) {
    console.error('⚠️ Migración totalControles (no crítico):', e.message);
  }

  try {
    const { modificados } = await migrarMontoPagado();
    if (modificados > 0) console.log(`💰 montoPagado asignado/redesglosado en ${modificados} play(s).`);
  } catch (e) {
    console.error('⚠️ Migración montoPagado (no crítico):', e.message);
  }

  try {
    const { asignados } = await migrarCategoriaActivos();
    if (asignados > 0) console.log(`🏷️ Categoría asignada a ${asignados} activo(s).`);
  } catch (e) {
    console.error('⚠️ Migración categoría activos (no crítico):', e.message);
  }

  try {
    const { modificados } = await migrarCategoriaCallOfDuty2();
    if (modificados > 0) console.log(`🎮 "Call of Duty 2" reclasificado (${modificados}).`);
  } catch (e) {
    console.error('⚠️ Reclasificar Call of Duty 2 (no crítico):', e.message);
  }

  try {
    const { colaboradores, adminFijado } = await migrarRolesUsuarios();
    if (colaboradores > 0 || adminFijado) console.log(`👤 Roles: ${colaboradores} → colaborador${adminFijado ? ', admin fijado' : ''}.`);
  } catch (e) {
    console.error('⚠️ Migración roles (no crítico):', e.message);
  }

  try {
    const { migrados } = await migrarReparacionesActivos();
    if (migrados > 0) console.log(`🔧 ${migrados} activo(s) migrados a reparaciones[].`);
  } catch (e) {
    console.error('⚠️ Migración reparaciones (no crítico):', e.message);
  }

  try {
    const { creado, monto } = await migrarAhorroMovimientos();
    if (creado) console.log(`💵 Ahorro: movimiento inicial creado (₡${monto}).`);
  } catch (e) {
    console.error('⚠️ Migración ahorro (no crítico):', e.message);
  }

  try {
    const { generados, meses } = await backfillEstadoResultados();
    if (generados > 0) console.log(`📊 Estado de resultados: ${generados}/${meses} mes(es) generados.`);
  } catch (e) {
    console.error('⚠️ Backfill estado de resultados (no crítico):', e.message);
  }

  try {
    await regenerarReporteActivos();
  } catch (e) {
    console.error('⚠️ Snapshot de activos (no crítico):', e.message);
  }

  try {
    iniciarSchedulerFinSesion();
  } catch (e) {
    console.error('⚠️ Scheduler de WhatsApp (no crítico):', e.message);
  }

  console.log('✅ Tareas de arranque completadas.');
};

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
// 🔔 VIGILANTE DE RESPUESTAS 5xx (alerta por correo)
// ============================================
// Va ANTES de las rutas para poder envolver res.json de cada petición.
//
// POR QUÉ ACÁ Y NO SOLO EN EL MIDDLEWARE DE ERRORES: el middleware global de
// abajo solo ve los errores que se propagan. Los controladores de este proyecto
// atrapan los suyos y responden res.status(500).json(...) directamente, así que
// la mayoría de los 500 nunca pasan por ahí. Mirando la RESPUESTA los agarramos
// todos sin tocar los 92 lugares donde eso ocurre.
app.use((req, res, next) => {
  const jsonOriginal = res.json;
  res.json = function (cuerpo) {
    // res.locals.yaAlertado lo pone el middleware de errores, que manda una
    // alerta más completa (con stack). Así el mismo fallo no avisa dos veces.
    if (res.statusCode >= 500 && !res.locals.yaAlertado) {
      res.locals.yaAlertado = true;
      // Sin await: el usuario no espera al correo.
      alertarRespuesta5xx({
        ruta: `${req.method} ${req.originalUrl}`,
        status: res.statusCode,
        cuerpo,
      });
    }
    return jsonOriginal.call(this, cuerpo);
  };
  next();
});

// ============================================
// RUTAS
// ============================================
// Rutas públicas
app.use("/api/auth", authRoutes);

// Guard de rol: un vendedor solo puede usar Ventas y Control de plays (más
// leer productos para el POS). admin/colaborador pasan sin restricción.
// Va antes de los módulos y después de /api/auth (login/verify siempre libres).
app.use(restringirVendedor);

// Rutas protegidas (requieren autenticación)
app.use("/api/products", productsRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/pedidos", pedidosRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/plays", playsRoutes);
app.use('/api/ahorro', ahorroRoutes);
app.use('/api/monthly-reports', monthlyReportRoutes);
app.use('/api/ventas-reports', saleReportRoutes);

// Módulo de Administración (todas con Bearer token)
app.use('/api/ganancias', gananciasRoutes);
app.use('/api/pagos-servicios', pagosServiciosRoutes);
app.use('/api/activos-sala', activosSalaRoutes);
app.use('/api/activos-reports', activosReportRoutes);
app.use('/api/estado-resultados', estadoResultadosRoutes);
app.use('/api/torneos', torneosRoutes);

// Finanzas Personales del administrador — APARTE de la sala de juegos.
// El propio router exige authMiddleware + soloAdmin en todas sus rutas.
app.use('/api/finanzas-personales', finanzasPersonalesRoutes);

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

  // Alerta por correo SOLO si la culpa es del servidor. Los errores de cliente
  // (payload muy grande, validación, CORS) son normales y llenarían el correo
  // de ruido: los manda el navegador, no son una falla del sistema.
  const esErrorDeCliente =
    err.type === 'entity.too.large' ||
    err.name === 'ValidationError' ||
    err.message === 'Not allowed by CORS';
  if (!esErrorDeCliente) {
    // Marcamos para que el vigilante de respuestas 5xx no mande un segundo
    // correo por el mismo fallo. Esta alerta es mejor: trae el stack.
    res.locals.yaAlertado = true;
    // Sin await: la respuesta al usuario no espera al correo.
    alertarErrorBackend(err, { ruta: `${req.method} ${req.originalUrl}`, origen: 'petición' });
  }

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
  console.log(`\n✅ Servidor escuchando en puerto ${PORT} (arranque: ${startupTime}ms)`);
  console.log("🌍 Entorno:", process.env.NODE_ENV);
  console.log("🚀 ========================================\n");

  // La conexión a Mongo arranca AHORA, en paralelo (no bloquea el listen). Al
  // conectar dispara —una sola vez— las tareas de arranque. Ver connectDB().
  connectDB();
});

export { mongoose };