// routes/reports.js
import express from 'express';
import {
  getResumenGeneral,
  getProductosMasVendidos,
  getProductosMenosVendidos,
  getProductosStockBajo,
  getVentasPorPeriodo,
  getEstadisticasPedidos
} from '../controllers/reportsController.js';

const router = express.Router();

// ✅ RUTAS ACTUALIZADAS para coincidir con el frontend
router.get('/resumen', getResumenGeneral);
router.get('/mas-vendidos', getProductosMasVendidos); // ✅ Cambié la ruta
router.get('/menos-vendidos', getProductosMenosVendidos); // ✅ Cambié la ruta
router.get('/stock-bajo', getProductosStockBajo); // ✅ Cambié la ruta
router.get('/ventas-periodo', getVentasPorPeriodo); // ✅ Cambié la ruta
router.get('/pedidos-stats', getEstadisticasPedidos); // ✅ Cambié la ruta

export default router;