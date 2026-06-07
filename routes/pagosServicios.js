// routes/pagosServicios.js
// Hecho por Claude Code — Módulo de Administración: Pagos de Servicios
// Todas las rutas requieren autenticación con Bearer token.
import express from 'express';
import authMiddleware from '../middlewares/auth.js';
import {
  addPagoServicio,
  getPagosServicios,
  getPagoServicioById,
  updatePagoServicio,
  deletePagoServicio,
} from '../controllers/pagosServiciosController.js';

const router = express.Router();

router.get('/', authMiddleware, getPagosServicios);         // ?mes=&anio=[&page=&limit=]
router.post('/', authMiddleware, addPagoServicio);
router.get('/:id', authMiddleware, getPagoServicioById);
router.put('/:id', authMiddleware, updatePagoServicio);
router.delete('/:id', authMiddleware, deletePagoServicio);

export default router;
