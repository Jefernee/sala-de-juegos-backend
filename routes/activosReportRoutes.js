// routes/activosReportRoutes.js
// Módulo de Reportes: Reporte de Activos.
// Requiere autenticación con Bearer token, igual que el resto de reportes.
import express from 'express';
import authMiddleware from '../middlewares/auth.js';
import { getReporteActivos } from '../controllers/activosReportController.js';

const router = express.Router();

// GET /api/activos-reports — reporte completo (snapshot) de los activos.
router.get('/', authMiddleware, getReporteActivos);

export default router;
