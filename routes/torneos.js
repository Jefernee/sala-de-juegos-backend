// routes/torneos.js
// Módulo de Administración: Torneos y competiciones.
//
// Rutas PÚBLICAS (sin login): listar torneos y recibir inscripciones desde la
// página pública. El resto requiere Bearer token; el guard global de roles ya
// impide que un vendedor acceda (solo admin/colaborador gestionan torneos).
import express from 'express';
import authMiddleware from '../middlewares/auth.js';
import { uploadBase64ToCloudinary } from '../middlewares/upload.js';
import {
  addTorneo,
  getTorneos,
  getTorneosPublicos,
  getTorneoPublicoById,
  getTorneoById,
  updateTorneo,
  deleteTorneo,
  addInscripcion,
  getInscripciones,
  updateInscripcion,
  deleteInscripcion,
} from '../controllers/torneosController.js';

const router = express.Router();

// ── PÚBLICAS (sin login) ──
// Van ANTES de '/:id' para que Express no interprete "public" como un id.
router.get('/public', getTorneosPublicos);
router.get('/public/:id', getTorneoPublicoById); // detalle público para la página compartible
router.post('/:id/inscripciones', addInscripcion); // formulario público de inscripción

// ── PROTEGIDAS (admin/colaborador) ──
router.get('/', authMiddleware, getTorneos);
router.post('/', authMiddleware, uploadBase64ToCloudinary, addTorneo); // afiche opcional
router.get('/:id', authMiddleware, getTorneoById);
router.put('/:id', authMiddleware, uploadBase64ToCloudinary, updateTorneo);
router.delete('/:id', authMiddleware, deleteTorneo);

// Inscripciones (gestión desde administración)
router.get('/:id/inscripciones', authMiddleware, getInscripciones);
router.patch('/:id/inscripciones/:insId', authMiddleware, updateInscripcion);
router.delete('/:id/inscripciones/:insId', authMiddleware, deleteInscripcion);

export default router;
