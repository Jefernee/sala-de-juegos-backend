import express from "express";
import {
  register,
  login,
  verifyToken,
  getUsers,
  updateUserRol,
  updateUserPassword,
  accesoDueno,
  cerrarSesiones,
} from "../controllers/authController.js";
import authMiddleware from "../middlewares/auth.js";
import { soloAdmin, soloDueño } from "../middlewares/roles.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.get("/verify", verifyToken);

// ── Gestión de usuarios / roles / contraseñas (solo administrador) ──
// el frontend usa esto para el panel de usuarios.
router.get("/users", authMiddleware, soloAdmin, getUsers);
router.patch("/users/:id/rol", authMiddleware, soloAdmin, updateUserRol);
router.patch("/users/:id/password", authMiddleware, soloAdmin, updateUserPassword);

// ── Acciones reservadas al DUEÑO (ADMIN_EMAIL), no a cualquier administrador ──
// Hoy hay tres cuentas con rol administrador; estas dos rutas son solo de la
// cuenta del dueño y devuelven 403 SOLO_DUENO a las otras dos.
//
// GET  /api/auth/acceso-dueno    → qué puede hacer solo él + estado de sesiones
// POST /api/auth/cerrar-sesiones → { usuarioId? }  (sin body = todos)
router.get("/acceso-dueno", authMiddleware, soloDueño, accesoDueno);
router.post("/cerrar-sesiones", authMiddleware, soloDueño, cerrarSesiones);

export default router;
