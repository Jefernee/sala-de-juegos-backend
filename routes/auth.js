import express from "express";
import {
  register,
  login,
  verifyToken,
  getUsers,
  updateUserRol,
  updateUserPassword,
} from "../controllers/authController.js";
import authMiddleware from "../middlewares/auth.js";
import { soloAdmin } from "../middlewares/roles.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.get("/verify", verifyToken);

// ── Gestión de usuarios / roles / contraseñas (solo administrador) ──
// Hecho por Claude Code — el frontend usa esto para el panel de usuarios.
router.get("/users", authMiddleware, soloAdmin, getUsers);
router.patch("/users/:id/rol", authMiddleware, soloAdmin, updateUserRol);
router.patch("/users/:id/password", authMiddleware, soloAdmin, updateUserPassword);

export default router;
