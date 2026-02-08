// routes/plays.js
import express from 'express';
const router = express.Router();
import authMiddleware from '../middlewares/auth.js';
import {
  getAllPlays,
  getPlayById,
  createPlay,
  updatePlay,
  deletePlay
} from '../controllers/playsController.js';

// Todas las rutas requieren autenticación
router.get('/', authMiddleware, getAllPlays);
router.get('/:id', authMiddleware, getPlayById);
router.post('/', authMiddleware, createPlay);
router.put('/:id', authMiddleware, updatePlay);
router.delete('/:id', authMiddleware, deletePlay);

export default router;