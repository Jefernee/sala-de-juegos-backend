// routes/juegos.js
// Módulo de Juegos: el catálogo de lo que se puede jugar.
//
// OJO con el orden y con los permisos:
//   • /vitrina es PÚBLICA (la página principal la lee sin token) y por eso se
//     monta aparte, antes del guard de autenticación (ver server.js).
//   • el resto pide Bearer token, y el guard de roles deja fuera al vendedor:
//     administrar el catálogo es cosa del dueño y los colaboradores. El
//     vendedor igual ve los juegos al cobrar, por GET /api/plays/juegos.
import express from 'express';
import authMiddleware from '../middlewares/auth.js';
import {
  uploadPortadaJuegoToCloudinary,
  uploadActivoImagesToCloudinary,   // de acá sale la foto de la factura
} from '../middlewares/upload.js';
import {
  getJuegos,
  crearJuego,
  actualizarJuego,
  borrarJuego,
  agregarCompra,
  editarCompra,
  borrarCompra,
} from '../controllers/juegosController.js';

const router = express.Router();

router.get('/', authMiddleware, getJuegos);

router.post('/',
  authMiddleware,
  uploadPortadaJuegoToCloudinary,   // procesa portadaBase64 (opcional)
  uploadActivoImagesToCloudinary,   // y imagenFacturaBase64, si vino con compra
  crearJuego
);

router.put('/:id',
  authMiddleware,
  uploadPortadaJuegoToCloudinary,   // permite cambiar la portada
  actualizarJuego
);

router.delete('/:id', authMiddleware, borrarJuego);

// Las compras de un juego. Registrar una es el camino de "estaba como gratis y
// resulta que se compró"; darla de baja es el de vuelta. Las tres tocan los
// reportes del mes de la compra, por eso viven juntas y no dentro del PUT del
// juego, que no toca plata.
// La foto de la factura viaja igual que en Activos (imagenFacturaBase64), y
// se guarda en el mismo campo del activo: es la misma factura, entre por
// donde entre.
router.post('/:id/compra', authMiddleware, uploadActivoImagesToCloudinary, agregarCompra);
router.put('/:id/compra/:placa', authMiddleware, uploadActivoImagesToCloudinary, editarCompra);
router.delete('/:id/compra/:placa', authMiddleware, borrarCompra);

export default router;
