// ============================================
// routes/sales.js - ACTUALIZADO CON CONTROLADORES
// ============================================
import express from 'express';
import {
  addSale,
  getSales,
  getSaleById,
  getSalesStats
} from '../controllers/salesController.js';

const router = express.Router();

// Obtener estadísticas (ANTES de /:id para evitar conflictos)
router.get('/stats/summary', getSalesStats);

// CRUD de ventas
router.get('/', getSales);
router.post('/', addSale);
router.get('/:id', getSaleById);

export default router;