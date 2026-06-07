// routes/ganancias.js
// Hecho por Claude Code — Módulo de Administración: Ganancias
// Todas las rutas requieren autenticación con Bearer token.
import express from 'express';
import authMiddleware from '../middlewares/auth.js';
import {
  addGanancia,
  getGanancias,
  getGananciaById,
  updateGanancia,
  deleteGanancia,
} from '../controllers/gananciasController.js';

const router = express.Router();

router.get('/', authMiddleware, getGanancias);          // ?mes=&anio=[&page=&limit=]
router.post('/', authMiddleware, addGanancia);
router.get('/:id', authMiddleware, getGananciaById);
router.put('/:id', authMiddleware, updateGanancia);
router.delete('/:id', authMiddleware, deleteGanancia);

export default router;
