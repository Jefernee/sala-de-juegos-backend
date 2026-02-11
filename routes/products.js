// routes/products.js
import express from "express";
import upload from "../middlewares/upload.js";
import authMiddleware from "../middlewares/auth.js";
import {
  getInventario,
  addProducto,
  updateProducto,
  deleteProducto,
  getProductosPaginados,
  getProductosPublicos,
  getProductosParaVenta,
} from "../controllers/inventarioController.js";

const router = express.Router();

// ✅ RUTAS PÚBLICAS (sin autenticación)
router.get("/public", getProductosPublicos);
router.get("/para-venta", getProductosParaVenta);

// ✅ RUTAS PROTEGIDAS (requieren autenticación)
// IMPORTANTE: El orden de middlewares es: authMiddleware -> upload -> controlador
router.post("/", authMiddleware, upload.single("imagen"), addProducto);
router.put("/:id", authMiddleware, upload.single("imagen"), updateProducto);
router.delete("/:id", authMiddleware, deleteProducto);

// ✅ RUTAS DE LECTURA PROTEGIDAS
router.get("/list", authMiddleware, getProductosPaginados);
router.get("/", authMiddleware, getInventario);

export default router;






