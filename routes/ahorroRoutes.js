import express from 'express';
import { getAhorro, agregarAhorro } from '../controllers/ahorroController.js';
import authMiddleware from '../middlewares/auth.js';

const router = express.Router();

router.get('/', authMiddleware, getAhorro);
router.post('/', authMiddleware, agregarAhorro);

export default router;