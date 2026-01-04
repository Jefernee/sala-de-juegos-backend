// routes/products.js
import express from "express";
import upload from "../middlewares/upload.js";
import authMiddleware from "../middlewares/auth.js"; // ✅ IMPORTAR
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

router.get("/para-venta", getProductosParaVenta);
router.get("/list", getProductosPaginados);
router.get("/", getInventario);

// ✅ AGREGAR authMiddleware ANTES de upload
router.post("/", authMiddleware, upload.single("imagen"), addProducto);
// ✅ PUT - Editar producto (FALTABA upload.single("imagen"))
router.put("/:id", authMiddleware, upload.single("imagen"), updateProducto);
router.get("/public", getProductosPublicos);
router.delete("/:id", authMiddleware, deleteProducto); // ✅ También proteger DELETE

export default router;





