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
import { uploadPortadaJuegoToCloudinary } from '../middlewares/upload.js';
import {
  getJuegos,
  crearJuego,
  actualizarJuego,
  borrarJuego,
  borrarCompra,
} from '../controllers/juegosController.js';

const router = express.Router();

router.get('/', authMiddleware, getJuegos);

router.post('/',
  authMiddleware,
  uploadPortadaJuegoToCloudinary,   // procesa portadaBase64 (opcional)
  crearJuego
);

router.put('/:id',
  authMiddleware,
  uploadPortadaJuegoToCloudinary,   // permite cambiar la portada
  actualizarJuego
);

router.delete('/:id', authMiddleware, borrarJuego);

// Dar de baja una compra. Va ANTES de '/:id' no haría falta (la ruta es más
// larga), pero se deja junto a su hermana para que se lean seguidas.
router.delete('/:id/compra/:placa', authMiddleware, borrarCompra);

export default router;
