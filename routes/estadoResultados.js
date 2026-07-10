// routes/estadoResultados.js
// Hecho por Claude Code — Módulo de Reportes: Estado de Resultados mensual.
// Todas las rutas requieren autenticación con Bearer token.
import express from 'express';
import authMiddleware from '../middlewares/auth.js';
import {
  generarEstadoMes,
  generarEstadoAnio,
  getAnosDisponibles,
  getEstadoMes,
  getEstadoAnio,
} from '../controllers/estadoResultadosController.js';

const router = express.Router();

// Generación (calcula desde datos crudos y guarda)
router.post('/generar', authMiddleware, generarEstadoMes);
router.post('/generar-anio', authMiddleware, generarEstadoAnio);

// IMPORTANTE: rutas específicas ANTES de las que llevan :año, para que no se
// interpreten como un año.
router.get('/anos-disponibles', authMiddleware, getAnosDisponibles);

// Lectura (solo leen lo guardado)
router.get('/:año/:mes', authMiddleware, getEstadoMes);
router.get('/:año', authMiddleware, getEstadoAnio);

export default router;
