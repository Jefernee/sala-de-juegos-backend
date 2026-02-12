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

// ✅ RUTAS PROTEGIDAS
// Ya no usamos upload.single("imagen") — la imagen llega como base64 en el body JSON
router.post("/",
  authMiddleware,
  uploadBase64ToCloudinary,   // ← procesa imagenBase64 del body y adjunta req.cloudinaryUrl
  addProducto
);

router.put("/:id",
  authMiddleware,
  uploadBase64ToCloudinary,   // ← también en el update
  updateProducto
);

router.delete("/:id", authMiddleware, deleteProducto);

// ✅ RUTAS DE LECTURA PROTEGIDAS
router.get("/list", authMiddleware, getProductosPaginados);
router.get("/", authMiddleware, getInventario);

export default router;




