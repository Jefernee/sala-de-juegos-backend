// routes/whatsappRecipients.js
// Hecho por Claude Code — Rutas CRUD de destinatarios de WhatsApp (protegidas).
import express from 'express';
const router = express.Router();
import authMiddleware from '../middlewares/auth.js';
import {
  getRecipients,
  createRecipient,
  updateRecipient,
  deleteRecipient,
} from '../controllers/whatsappRecipientsController.js';

router.get('/', authMiddleware, getRecipients);
router.post('/', authMiddleware, createRecipient);
router.put('/:id', authMiddleware, updateRecipient);
router.delete('/:id', authMiddleware, deleteRecipient);

export default router;
