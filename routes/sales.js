// ============================================
// routes/sales.js - ACTUALIZADO CON TODAS LAS OPERACIONES CRUD
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

const router = express.Router();

// Obtener estadísticas (ANTES de /:id para evitar conflictos)
router.get('/stats/summary', getSalesStats);

// CRUD completo de ventas
router.get('/', getSales);           // Obtener todas (con paginación)
router.post('/', addSale);           // Crear nueva venta
router.get('/:id', getSaleById);     // Obtener una venta por ID
router.put('/:id', updateSale);      // Actualizar venta
router.delete('/:id', deleteSale);   // Eliminar venta

export default router;