/*Monthlyreportplaysroutes.js*/
import express from 'express';
import authMiddleware from '../middlewares/auth.js';
import {
  generarReporteMensual,
  generarReporteAnual,
  getReportesPorAño,
  getReporteMensual,
  getAnosDisponibles,
  compararAños,
  getRankingClientes,
} from '../controllers/MonthlyReportPlaysController.js';
 
const router = express.Router();

// Todo este módulo requiere haber iniciado sesión. Antes quedaba abierto: sin
// token se podían leer los reportes del negocio, y ahora además el ranking
// lleva nombres de clientes. El guard global de roles (restringirVendedor, en
// server.js) ya deja fuera a los vendedores; esto cierra el caso de "sin token".
router.use(authMiddleware);

// ── Generación ────────────────────────────────────────────────────────────────
router.post('/generate',      generarReporteMensual);
router.post('/generate-year', generarReporteAnual);
 
// ── Consultas ─────────────────────────────────────────────────────────────────
// ⚠️ Rutas fijas SIEMPRE antes de /:año para que Express no las confunda
router.get('/anos-disponibles', getAnosDisponibles); // sin tilde
router.get('/comparar',         compararAños);
 
// Ranking de clientes del mes, con selector de periodo (semana/quincena/mes/
// rango libre). Va ANTES de /:año/:mes por claridad; no hay ambigüedad real
// porque tiene un segmento más.
router.get('/:año/:mes/clientes', getRankingClientes);

router.get('/:año',      getReportesPorAño);
router.get('/:año/:mes', getReporteMensual);
 
export default router;
 