import { Router } from 'express';
import {
  generateMonthReport,
  generateYearReports,
  getMonthReport,
  getYearReport,
  getAnosDisponibles,
} from '../controllers/Salereportcontroller.js';

// Importa tu middleware de autenticación si lo usas
// import { verifyToken } from '../middleware/auth.js';

const router = Router();

// ── Consultas ──────────────────────────────────────────────────────
// GET /api/ventas-reports/anos-disponibles
router.get('/anos-disponibles', getAnosDisponibles);

// GET /api/ventas-reports/:año
router.get('/:año', getYearReport);

// GET /api/ventas-reports/:año/:mes
router.get('/:año/:mes', getMonthReport);

// ── Generación on-demand ───────────────────────────────────────────
// POST /api/ventas-reports/generate        { año, mes }
router.post('/generate', generateMonthReport);

// POST /api/ventas-reports/generate-year   { año }
router.post('/generate-year', generateYearReports);

export default router;