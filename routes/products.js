// routes/products.js
import express from "express";
import { uploadBase64ToCloudinary } from "../middlewares/upload.js";
import authMiddleware from "../middlewares/auth.js";
import {
  getInventario,
  addProducto,
  updateProducto,
  deleteProducto,
  getProductosPaginados,
  getProductosPublicos,
  getProductosParaVenta,
  getIngredientes,          // Hecho por Claude Code
  getProductoById,          // Hecho por Claude Code
} from "../controllers/inventarioController.js";

const router = express.Router();

// ✅ RUTAS PÚBLICAS
router.get("/public", getProductosPublicos);
router.get("/para-venta", getProductosParaVenta);

// ─────────────────────────────────────────────────────────────────
// Hecho por Claude Code — GET /api/products/ingredientes
// Lista todos los ítems de inventario de tipo 'producto' disponibles
// para ser usados como ingredientes al crear o editar una receta.
// Protegida: solo usuarios autenticados pueden ver esto.
// ─────────────────────────────────────────────────────────────────
router.get("/ingredientes", authMiddleware, getIngredientes);

// ✅ RUTAS PROTEGIDAS - AMBAS USAN BASE64
router.post("/",
  authMiddleware,
  uploadBase64ToCloudinary,   // ✅ Procesa imagenBase64 del body (opcional para recetas)
  addProducto
);

router.put("/:id",
  authMiddleware,
  uploadBase64ToCloudinary,   // ✅ También procesa imagenBase64 (opcional en PUT)
  updateProducto
);

// ✅ RUTAS DE LECTURA PROTEGIDAS
// Hecho por Claude Code — /list y / deben ir ANTES de /:id para que Express
// no las interprete como si "list" fuera un ID de producto.
router.get("/list", authMiddleware, getProductosPaginados);
router.get("/", authMiddleware, getInventario);

// Hecho por Claude Code — GET /api/products/:id — va al final para no
// interceptar rutas estáticas como /list, /ingredientes, /para-venta, /public
router.get("/:id", authMiddleware, getProductoById);

router.delete("/:id", authMiddleware, deleteProducto);

export default router;



