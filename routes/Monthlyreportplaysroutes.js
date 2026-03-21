/*Monthlyreportplaysroutes.js*/
import express from 'express';
import {
  generarReporteMensual,
  generarReporteAnual,
  getReportesPorAño,
  getReporteMensual,
  getAnosDisponibles,
  compararAños,
} from '../controllers/MonthlyReportPlaysController.js';
 
const router = express.Router();
 
// ── Generación ────────────────────────────────────────────────────────────────
router.post('/generate',      generarReporteMensual);
router.post('/generate-year', generarReporteAnual);
 
// ── Consultas ─────────────────────────────────────────────────────────────────
// ⚠️ Rutas fijas SIEMPRE antes de /:año para que Express no las confunda
router.get('/anos-disponibles', getAnosDisponibles); // sin tilde
router.get('/comparar',         compararAños);
 
router.get('/:año',      getReportesPorAño);
router.get('/:año/:mes', getReporteMensual);
 
export default router;
 