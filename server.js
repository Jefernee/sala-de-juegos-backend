// ============================================
// 4. SERVER.JS ACTUALIZADO
// ============================================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import productsRoutes from "./routes/products.js";
import authRoutes from "./routes/auth.js";
import salesRoutes from "./routes/sales.js";
import pedidosRoutes from './routes/pedidos.js';
import reportsRoutes from './routes/reports.js';

dotenv.config();

console.log('✅ FRONTEND_URL:', process.env.FRONTEND_URL);

const app = express();
const PORT = process.env.PORT || 5000;


// Middlewares
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));
app.use(express.json());

// Conexión a MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Conectado a MongoDB Atlas correctamente");
  } catch (err) {
    console.error("Error al conectar a MongoDB:", err);
    process.exit(1);
  }
};

await connectDB();

// Rutas públicas
app.use("/api/auth", authRoutes);

// Rutas protegidas (requieren autenticación)
app.use("/api/products", productsRoutes);


// Usar la ruta (después de las otras rutas)
app.use('/api/sales', salesRoutes);

app.use('/api/pedidos', pedidosRoutes);

app.use('/api/reports', reportsRoutes);

// Al inicio del archivo, después de los imports
const SERVER_START_TIME = Date.now();
console.log('🚀 ========================================');
console.log('🚀 SERVIDOR INICIANDO...');
console.log('🚀 Timestamp:', new Date().toISOString());
console.log('🚀 ========================================');

// Servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});


app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime() // Tiempo que lleva corriendo
  });
});

// Middleware global de errores
app.use((err, req, res, next) => {
  console.error("ERROR GLOBAL:", err);
  res.status(500).json({ error: err.message });
});

export { mongoose };



