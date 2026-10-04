// routes/gastosCorreo.js
// Gastos de Finanzas Personales que llegan solos desde el correo del banco.
// SIN token de sesión: lo llama un Google Apps Script, protegido con la clave
// compartida CORREO_BCR_CLAVE (ver controllers/gastosCorreoController.js).
import express from 'express';
import { recibirCorreoBCR } from '../controllers/gastosCorreoController.js';

const router = express.Router();

router.post('/bcr', recibirCorreoBCR);

export default router;
