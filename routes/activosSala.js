// routes/activosSala.js
// Módulo de Administración: Activos de la Sala
// Todas las rutas requieren autenticación con Bearer token.
// - POST/PUT del activo procesan imágenes base64 (artículo + factura de compra).
// - POST/PUT de reparaciones procesan la factura base64 de esa reparación.
import express from 'express';
import authMiddleware from '../middlewares/auth.js';
import {
  uploadActivoImagesToCloudinary,
  uploadReparacionFacturaToCloudinary,
} from '../middlewares/upload.js';
import {
  addActivo,
  getActivos,
  getActivoById,
  getProximaPlaca,
  updateActivo,
  deleteActivo,
  addReparacion,
  updateReparacion,
  deleteReparacion,
} from '../controllers/activosSalaController.js';

const router = express.Router();

router.get('/', authMiddleware, getActivos);                // [?page=&limit=&search=&categoria=&conReparacion=]

// IMPORTANTE: va ANTES de '/:id' para que no se interprete como un id.
router.get('/proxima-placa', authMiddleware, getProximaPlaca);

router.post('/',
  authMiddleware,
  uploadActivoImagesToCloudinary,   // procesa imagenBase64 e imagenFacturaBase64 (opcionales)
  addActivo
);

router.get('/:id', authMiddleware, getActivoById);

router.put('/:id',
  authMiddleware,
  uploadActivoImagesToCloudinary,   // permite reemplazar la foto o la factura de compra
  updateActivo
);

router.delete('/:id', authMiddleware, deleteActivo);

// ── Reparaciones (historial dentro del activo) ──
router.post('/:id/reparaciones',
  authMiddleware,
  uploadReparacionFacturaToCloudinary, // procesa facturaBase64 (opcional)
  addReparacion
);

router.put('/:id/reparaciones/:repId',
  authMiddleware,
  uploadReparacionFacturaToCloudinary, // permite reemplazar la factura
  updateReparacion
);

router.delete('/:id/reparaciones/:repId', authMiddleware, deleteReparacion);

export default router;
