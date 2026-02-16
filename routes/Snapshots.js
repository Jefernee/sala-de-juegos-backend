import express from 'express';
import {
  createSnapshot,
  getSnapshots,
  getSnapshotByPeriod,
  compareYears,
  compareMonths,
  getSnapshotSummary
} from '../controllers/snapshotsController.js';
import authMiddleware from '../middlewares/auth.js';

const router = express.Router();

// Comparaciones y resúmenes (ANTES de rutas con parámetros)
router.get('/summary', authMiddleware, getSnapshotSummary);
router.get('/compare/years', authMiddleware, compareYears);
router.get('/compare/months', authMiddleware, compareMonths);

// CRUD - SOLO lectura y creación (no update ni delete)
router.get('/', authMiddleware, getSnapshots);
router.post('/', authMiddleware, createSnapshot);
router.get('/:year', authMiddleware, getSnapshotByPeriod);
router.get('/:year/:month', authMiddleware, getSnapshotByPeriod);

export default router;