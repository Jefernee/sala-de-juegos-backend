import { Router } from 'express';
import authMiddleware from '../middlewares/auth.js';
import {
  generateMonthReport,
  generateYearReports,
  getMonthReport,
  getYearReport,
  getAnosDisponibles,
} from '../controllers/Salereportcontroller.js';

const router = Router();

// Todo este módulo requiere haber iniciado sesión. Quedó abierto por años: el
// import del middleware estaba comentado (y apuntaba a una carpeta que no
// existe), así que sin token se leían el recaudado, el costo, la ganancia y el
// margen del negocio a cualquiera con la URL. Mismo middleware que el resto de
// los módulos de reportes, para que el contrato de errores sea idéntico.
// El guard global de roles (restringirVendedor, en server.js) ya deja fuera a
// los vendedores con 403 ROL_NO_AUTORIZADO; esto cierra el caso de "sin token".
router.use(authMiddleware);

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