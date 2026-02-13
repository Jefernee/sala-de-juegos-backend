// ============================================
// routes/sales.js - CON AUTENTICACIÓN
// ============================================
import express from 'express';
import {
  addSale,
  getSales,
  getSaleById,
  getSalesStats,
  updateSale,
  deleteSale
} from '../controllers/salesController.js';
import authMiddleware from '../middlewares/auth.js';

const router = express.Router();

// Obtener estadísticas (ANTES de /:id para evitar conflictos)
router.get('/stats/summary', authMiddleware, getSalesStats);

// CRUD completo de ventas - TODAS PROTEGIDAS
router.get('/', authMiddleware, getSales);
router.post('/', authMiddleware, addSale);
router.get('/:id', authMiddleware, getSaleById);
router.put('/:id', authMiddleware, updateSale);
router.delete('/:id', authMiddleware, deleteSale);

export default router;