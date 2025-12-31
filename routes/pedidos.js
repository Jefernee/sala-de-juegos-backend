// ============================================
// routes/pedidos.js - CON CONTROLADORES
// ============================================
import express from 'express';
import {
  addPedido,
  getPedidos,
  getPedidoById,
  updatePedidoEstado,
  deletePedido
} from '../controllers/pedidosController.js';

const router = express.Router();

// CRUD de pedidos
router.get('/', getPedidos);
router.post('/', addPedido);
router.get('/:id', getPedidoById);
router.patch('/:id', updatePedidoEstado);
router.delete('/:id', deletePedido);

export default router;