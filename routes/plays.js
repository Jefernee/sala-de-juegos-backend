// routes/plays.js
import express from 'express';
const router = express.Router();
import authMiddleware from '../middlewares/auth.js';
import {
  getAllPlays,
  getPlayById,
  createPlay,
  updatePlay,
  deletePlay,
  notificarFinSesionManual,
  iniciarTiempoPendiente,
  detenerTiempoPendiente
} from '../controllers/playsController.js';

// Todas las rutas requieren autenticación
router.get('/', authMiddleware, getAllPlays);
router.get('/:id', authMiddleware, getPlayById);
router.post('/', authMiddleware, createPlay);
// Aviso de fin de sesión disparado por el frontend (cronómetro en 0)
router.post('/:id/notificar-fin', authMiddleware, notificarFinSesionManual);
// Turno de tiempo pendiente: poner a correr tiempo ya pagado que no se uso.
// No cobra ni crea una sesion, asi que no toca reportes (ver el controlador).
router.post('/:id/pendiente/iniciar', authMiddleware, iniciarTiempoPendiente);
router.post('/:id/pendiente/detener', authMiddleware, detenerTiempoPendiente);
router.put('/:id', authMiddleware, updatePlay);
router.delete('/:id', authMiddleware, deletePlay);

export default router;