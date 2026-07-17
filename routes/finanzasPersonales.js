// routes/finanzasPersonales.js
// Finanzas Personales (SOLO administrador). Módulo APARTE de la sala de juegos.
// Todas las rutas: autenticación (Bearer token) + soloAdmin.
import express from 'express';
import authMiddleware from '../middlewares/auth.js';
import { soloAdmin } from '../middlewares/roles.js';
import {
  getCategorias,
  addMovimiento,
  getMovimientos,
  getResumenMensual,
  getAniosDisponibles,
  getTipoCambio,
  getMovimientoById,
  updateMovimiento,
  deleteMovimiento,
} from '../controllers/finanzasPersonalesController.js';

const router = express.Router();

// Solo el administrador puede tocar cualquier cosa de este módulo.
router.use(authMiddleware, soloAdmin);

// Rutas estáticas ANTES de /:id (si no, Express las trataría como un id).
router.get('/categorias', getCategorias);
router.get('/resumen', getResumenMensual);          // ?mes=&anio=
router.get('/anios-disponibles', getAniosDisponibles);
router.get('/tipo-cambio', getTipoCambio);          // TC del dólar (Hacienda, cacheado por día)

router.get('/', getMovimientos);                    // ?mes=&anio=[&tipo=&page=&limit=]
router.post('/', addMovimiento);

router.get('/:id', getMovimientoById);
router.put('/:id', updateMovimiento);
router.delete('/:id', deleteMovimiento);

export default router;
