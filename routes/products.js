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
} from "../controllers/inventarioController.js";

const router = express.Router();

// ✅ RUTAS PÚBLICAS
router.get("/public", getProductosPublicos);
router.get("/para-venta", getProductosParaVenta);

// ✅ RUTAS PROTEGIDAS - AMBAS USAN BASE64
router.post("/",
  authMiddleware,
  uploadBase64ToCloudinary,   // ✅ Procesa imagenBase64 del body
  addProducto
);

router.put("/:id",
  authMiddleware,
  uploadBase64ToCloudinary,   // ✅ También procesa imagenBase64 (opcional en PUT)
  updateProducto
);

router.delete("/:id", authMiddleware, deleteProducto);

// ✅ RUTAS DE LECTURA PROTEGIDAS
router.get("/list", authMiddleware, getProductosPaginados);
router.get("/", authMiddleware, getInventario);

export default router;



