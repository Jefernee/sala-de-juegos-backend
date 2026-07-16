import mongoose from "mongoose";
import User from "../models/User.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { ROLES, ROL_ADMIN, ROL_COLABORADOR, ADMIN_EMAIL } from "../config/roles.js";

// Lee el rol del que hace la petición a partir del Bearer token (si lo hay).
// Sirve para que register solo permita asignar un rol distinto de 'colaborador'
// cuando quien crea el usuario es un administrador autenticado. Nunca lanza.
const rolDelSolicitante = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET).rol || null;
  } catch {
    return null;
  }
};

// ============================================
// REGISTRO DE USUARIO
// ============================================
export const register = async (req, res) => {
  try {
    const { email, password, nombre } = req.body;

    console.log("📝 ========================================");
    console.log("📝 REGISTRO REQUEST RECIBIDO");
    console.log("📝 Timestamp:", new Date().toISOString());
    console.log("📝 Email:", email);

    // Validación de campos
    if (!email || !password || !nombre) {
      console.log("❌ Faltan campos requeridos");
      return res.status(400).json({ 
        success: false,
        message: "Todos los campos son requeridos",
        missingFields: {
          email: !email,
          password: !password,
          nombre: !nombre
        }
      });
    }

    // Verificar si el usuario ya existe
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log("❌ Usuario ya existe:", email);
      return res.status(400).json({ 
        success: false,
        message: "El usuario ya existe",
        field: "email"
      });
    }

    // Determinar el rol a asignar. Por seguridad, un registro PÚBLICO siempre
    // crea 'colaborador'. Solo un administrador autenticado puede crear un
    // usuario con otro rol (ej. un vendedor). Nunca se puede crear un segundo
    // administrador desde acá (ese lo define el email del dueño en la migración).
    let rolAsignado = ROL_COLABORADOR;
    if (rolDelSolicitante(req) === ROL_ADMIN && ROLES.includes(req.body.rol) && req.body.rol !== ROL_ADMIN) {
      rolAsignado = req.body.rol;
    }

    // Hashear contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Crear usuario
    const user = new User({
      email,
      password: hashedPassword,
      nombre,
      rol: rolAsignado,
    });

    await user.save();

    console.log(`✅ Usuario creado exitosamente: ${email} (rol: ${user.rol})`);

    res.status(201).json({
      success: true,
      message: "Usuario creado exitosamente",
      user: {
        id: user._id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol,
      },
    });

  } catch (error) {
    console.error("❌ ERROR EN REGISTRO:", error);

    // Error de validación de Mongoose
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: "Error de validación",
        errors: Object.keys(error.errors).map(key => ({
          field: key,
          message: error.errors[key].message
        })),
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    }

    // Error de duplicado (email único)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "El email ya está registrado",
        field: "email"
      });
    }

    // Error genérico
    res.status(500).json({ 
      success: false,
      message: "Error al registrar usuario",
      error: process.env.NODE_ENV === 'development' ? error.message : 'Error interno del servidor',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
};

// ============================================
// LOGIN CON MEDICIÓN DE TIEMPOS
// ============================================
export const login = async (req, res) => {
  const timestamps = {
    inicio: Date.now()
  };

  try {
    console.log("🔐 ========================================");
    console.log("🔐 LOGIN REQUEST RECIBIDO");
    console.log("🔐 Timestamp:", new Date().toISOString());
    
    const { email, password } = req.body;
    console.log("🔍 Email:", email);

    // Validación de campos
    if (!email || !password) {
      console.log("❌ Campos incompletos");
      return res.status(400).json({ 
        success: false,
        message: "Email y contraseña son requeridos",
        missingFields: {
          email: !email,
          password: !password
        }
      });
    }

    timestamps.validacion = Date.now();
    console.log(`⏱️  Validación: ${timestamps.validacion - timestamps.inicio}ms`);

    // Buscar usuario en MongoDB
    const user = await User.findOne({ email });
    timestamps.busquedaDB = Date.now();
    console.log(`⏱️  Búsqueda en MongoDB: ${timestamps.busquedaDB - timestamps.validacion}ms`);

    if (!user) {
      console.log("❌ Usuario no encontrado:", email);
      return res.status(401).json({ 
        success: false,
        message: "Credenciales inválidas",
        hint: process.env.NODE_ENV === 'development' ? "Usuario no encontrado" : undefined
      });
    }

    console.log("✅ Usuario encontrado:", user.email);

    // Verificar contraseña con bcrypt
    const validPassword = await bcrypt.compare(password, user.password);
    timestamps.bcrypt = Date.now();
    console.log(`⏱️  Bcrypt compare: ${timestamps.bcrypt - timestamps.busquedaDB}ms`);
    console.log("🔑 Contraseña válida:", validPassword);

    if (!validPassword) {
      console.log("❌ Contraseña incorrecta para:", email);
      return res.status(401).json({ 
        success: false,
        message: "Credenciales inválidas",
        hint: process.env.NODE_ENV === 'development' ? "Contraseña incorrecta" : undefined
      });
    }

    // Crear token JWT (incluye el rol para autorizar módulos en el backend)
    const token = jwt.sign(
      {
        id: user._id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );
    timestamps.jwt = Date.now();
    console.log(`⏱️  Generación JWT: ${timestamps.jwt - timestamps.bcrypt}ms`);

    console.log("✅ Login exitoso para:", user.email);

    // Tiempo total
    timestamps.fin = Date.now();
    const tiempoTotal = timestamps.fin - timestamps.inicio;
    
    console.log("📊 ========== RESUMEN DE TIEMPOS ==========");
    console.log(`⏱️  Validación:     ${timestamps.validacion - timestamps.inicio}ms`);
    console.log(`⏱️  MongoDB:        ${timestamps.busquedaDB - timestamps.validacion}ms`);
    console.log(`⏱️  Bcrypt:         ${timestamps.bcrypt - timestamps.busquedaDB}ms`);
    console.log(`⏱️  JWT:            ${timestamps.jwt - timestamps.bcrypt}ms`);
    console.log(`⏱️  TIEMPO TOTAL:   ${tiempoTotal}ms (${(tiempoTotal/1000).toFixed(2)}s)`);
    console.log("==========================================");

    res.json({
      success: true,
      message: "Login exitoso",
      token,
      user: {
        id: user._id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol,
      },
    });

  } catch (error) {
    console.error("❌ ERROR EN LOGIN:", error);

    // Error de JWT
    if (error.name === 'JsonWebTokenError') {
      return res.status(500).json({
        success: false,
        message: "Error al generar token",
        error: process.env.NODE_ENV === 'development' ? error.message : 'Error de autenticación'
      });
    }

    // Error de conexión a BD
    if (error.name === 'MongoNetworkError' || error.name === 'MongoServerError') {
      return res.status(503).json({
        success: false,
        message: "Error de conexión con la base de datos",
        error: process.env.NODE_ENV === 'development' ? error.message : 'Servicio temporalmente no disponible'
      });
    }

    // Error genérico
    res.status(500).json({ 
      success: false,
      message: "Error al iniciar sesión",
      error: process.env.NODE_ENV === 'development' ? error.message : 'Error interno del servidor',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
};

// ============================================
// VERIFICAR TOKEN
// ============================================
export const verifyToken = async (req, res) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      console.log("❌ Token no proporcionado");
      return res.status(401).json({ 
        success: false,
        valid: false, 
        message: "Token no proporcionado" 
      });
    }

    // Verificar token
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    
    // Buscar usuario
    const user = await User.findById(verified.id).select("-password");

    if (!user) {
      console.log("❌ Usuario no encontrado para token");
      return res.status(401).json({ 
        success: false,
        valid: false, 
        message: "Usuario no encontrado" 
      });
    }

    console.log("✅ Token válido para:", user.email);

    res.json({
      success: true,
      valid: true,
      user: {
        id: user._id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol,
      }
    });

  } catch (error) {
    console.error("❌ ERROR EN VERIFICACIÓN:", error);

    // Token expirado
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false,
        valid: false, 
        message: "Token expirado",
        expired: true
      });
    }

    // Token inválido
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false,
        valid: false, 
        message: "Token inválido",
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }

    // Error genérico
    res.status(401).json({
      success: false,
      valid: false,
      message: "Error al verificar token",
      error: process.env.NODE_ENV === 'development' ? error.message : 'Error de autenticación'
    });
  }
};

// ============================================
// LISTAR USUARIOS (solo administrador)
// Hecho por Claude Code — Para el panel de gestión de roles del frontend.
// ============================================
export const getUsers = async (req, res) => {
  try {
    const users = await User.find()
      .select("email nombre rol createdAt")
      .sort({ createdAt: 1 })
      .lean();
    res.json({ success: true, users });
  } catch (error) {
    console.error("❌ ERROR AL LISTAR USUARIOS:", error);
    res.status(500).json({ success: false, message: "Error al listar usuarios", error: error.message });
  }
};

// ============================================
// CAMBIAR EL ROL DE UN USUARIO (solo administrador)
// Hecho por Claude Code — Recibe { rol } en el body. No se puede asignar el rol
// 'administrador' desde acá (el admin lo define el email del dueño) ni cambiarle
// el rol a la cuenta del dueño (para no dejar el sistema sin administrador).
// ============================================
export const updateUserRol = async (req, res) => {
  try {
    const { id } = req.params;
    const { rol } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "ID de usuario inválido" });
    }

    // Solo se pueden asignar colaborador o vendedor (no administrador).
    if (!ROLES.includes(rol) || rol === ROL_ADMIN) {
      return res.status(400).json({
        success: false,
        message: `Rol inválido. Valores permitidos: ${ROLES.filter((r) => r !== ROL_ADMIN).join(", ")}`,
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "Usuario no encontrado" });
    }

    // Proteger la cuenta del dueño: no se le puede quitar el rol de administrador.
    if (user.email === ADMIN_EMAIL) {
      return res.status(400).json({
        success: false,
        message: "No se puede cambiar el rol de la cuenta del administrador (dueño).",
      });
    }

    user.rol = rol;
    await user.save();

    console.log(`✅ Rol de ${user.email} cambiado a "${rol}"`);
    res.json({
      success: true,
      message: "Rol actualizado",
      user: { id: user._id, email: user.email, nombre: user.nombre, rol: user.rol },
    });
  } catch (error) {
    console.error("❌ ERROR AL CAMBIAR ROL:", error);
    res.status(500).json({ success: false, message: "Error al cambiar el rol", error: error.message });
  }
};