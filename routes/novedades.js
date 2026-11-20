// routes/novedades.js
// Módulo de Administración: Novedades de la página pública.
//
// Pública (sin login): /publicas. El resto requiere Bearer token; el guard
// global de roles ya impide que un vendedor acceda (igual que torneos).
import express from 'express';
import authMiddleware from '../middlewares/auth.js';
import { uploadBase64ToCloudinary } from '../middlewares/upload.js';
import {
  getNovedadesPublicas,
  getNovedades,
  addNovedad,
  updateNovedad,
  deleteNovedad,
  reordenarNovedades,
} from '../controllers/novedadesController.js';

const router = express.Router();

// ── PÚBLICA ──
router.get('/publicas', getNovedadesPublicas);

// ── PROTEGIDAS (admin/colaborador) ──
router.get('/', authMiddleware, getNovedades);
router.post('/', authMiddleware, uploadBase64ToCloudinary, addNovedad);
// '/orden' va ANTES de '/:id' para que Express no lo tome por un id.
router.put('/orden', authMiddleware, reordenarNovedades);
router.put('/:id', authMiddleware, uploadBase64ToCloudinary, updateNovedad);
router.delete('/:id', authMiddleware, deleteNovedad);

export default router;
