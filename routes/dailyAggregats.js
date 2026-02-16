// ============================================
// routes/reports.js
// Rutas para reportes generales
// ============================================
import express from 'express';
import { 
  getResumenGeneral, 
  getStockBajo, 
  getPedidosStats 
} from '../controllers/DailyaggregateController.js';
import authMiddleware from '../middlewares/auth.js';

const router = express.Router();

// Resumen general (ventas hoy, mes, inventario, pedidos)
router.get('/resumen', authMiddleware, getResumenGeneral);

// Productos con stock bajo y agotados
router.get('/stock-bajo', authMiddleware, getStockBajo);

// Estadísticas de pedidos
router.get('/pedidos-stats', authMiddleware, getPedidosStats);

export default router;