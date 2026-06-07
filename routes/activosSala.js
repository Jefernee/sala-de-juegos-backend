// routes/activosSala.js
// Hecho por Claude Code — Módulo de Administración: Activos de la Sala
// Todas las rutas requieren autenticación con Bearer token.
// POST y PUT procesan imágenes base64 (artículo + factura) con el
// middleware uploadActivoImagesToCloudinary, igual que productos.
import express from 'express';
import authMiddleware from '../middlewares/auth.js';
import { uploadActivoImagesToCloudinary } from '../middlewares/upload.js';
import {
  addActivo,
  getActivos,
  getActivoById,
  updateActivo,
  deleteActivo,
} from '../controllers/activosSalaController.js';

const router = express.Router();

router.get('/', authMiddleware, getActivos);                // [?page=&limit=&search=&tipoRegistro=]

router.post('/',
  authMiddleware,
  uploadActivoImagesToCloudinary,   // procesa imagenBase64 e imagenFacturaBase64 (opcionales)
  addActivo
);

router.get('/:id', authMiddleware, getActivoById);

router.put('/:id',
  authMiddleware,
  uploadActivoImagesToCloudinary,   // permite reemplazar cualquiera de las dos imágenes
  updateActivo
);

router.delete('/:id', authMiddleware, deleteActivo);

export default router;
