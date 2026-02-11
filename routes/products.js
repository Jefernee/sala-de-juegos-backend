// routes/products.js
import express from "express";
import upload, { uploadToCloudinary } from "../middlewares/upload.js"; // ✅ IMPORTACIÓN CORREGIDA
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

// ✅ RUTAS PROTEGIDAS - ORDEN CORRECTO
router.post("/", 
  authMiddleware, 
  upload.single("imagen"), 
  uploadToCloudinary, // ✅ ESTO ES CRÍTICO
  addProducto
);

router.put("/:id", 
  authMiddleware, 
  upload.single("imagen"), 
  uploadToCloudinary, 
  updateProducto
);

router.delete("/:id", authMiddleware, deleteProducto);

// ✅ RUTAS DE LECTURA PROTEGIDAS
router.get("/list", authMiddleware, getProductosPaginados);
router.get("/", authMiddleware, getInventario);

export default router;




