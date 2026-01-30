import express from "express";
import User from "../models/User.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const router = express.Router();

// Registro de usuario
router.post("/register", async (req, res) => {
  try {
    const { email, password, nombre } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "El usuario ya existe" });
    }

    // Hashear contraseña manualmente
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = new User({
      email,
      password: hashedPassword,
      nombre,
    });

    await user.save();

    res.status(201).json({
      message: "Usuario creado exitosamente",
      user: { id: user._id, email: user.email, nombre: user.nombre },
    });
  } catch (error) {
    console.error("Error en registro:", error);
    res
      .status(500)
      .json({ message: "Error al registrar usuario", error: error.message });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    console.log("🔐 ========================================");
    console.log("🔐 LOGIN REQUEST RECIBIDO");
    console.log("🔐 Timestamp:", new Date().toISOString());
    const { email, password } = req.body;

    console.log("🔍 Intentando login con:", email); // Debug

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email y contraseña son requeridos" });
    }

    // Buscar usuario
    const user = await User.findOne({ email });

    if (!user) {
      console.log("❌ Usuario no encontrado"); // Debug
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    console.log("✅ Usuario encontrado:", user.email); // Debug

    // Verificar contraseña usando bcrypt directamente
    const validPassword = await bcrypt.compare(password, user.password);

    console.log("🔑 Contraseña válida:", validPassword); // Debug

    if (!validPassword) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    // Crear token JWT
    const token = jwt.sign(
      {
        id: user._id,
        email: user.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" },
    );

    console.log("✅ Login exitoso para:", user.email); // Debug

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        nombre: user.nombre,
      },
    });
  } catch (error) {
    console.error("❌ Error en login:", error);
    res
      .status(500)
      .json({ message: "Error al iniciar sesión", error: error.message });
  }
});

// Verificar token
router.get("/verify", async (req, res) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ valid: false });
    }

    const verified = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(verified.id).select("-password");

    if (!user) {
      return res.status(401).json({ valid: false });
    }

    res.json({ valid: true, user });
  } catch (error) {
    res.status(401).json({ valid: false });
  }
});

export default router;
