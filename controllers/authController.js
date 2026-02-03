import User from "../models/User.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

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

    // Hashear contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Crear usuario
    const user = new User({
      email,
      password: hashedPassword,
      nombre,
    });

    await user.save();

    console.log("✅ Usuario creado exitosamente:", email);

    res.status(201).json({
      success: true,
      message: "Usuario creado exitosamente",
      user: { 
        id: user._id, 
        email: user.email, 
        nombre: user.nombre 
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
// LOGIN
// ============================================
export const login = async (req, res) => {
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

    // Buscar usuario
    const user = await User.findOne({ email });

    if (!user) {
      console.log("❌ Usuario no encontrado:", email);
      return res.status(401).json({ 
        success: false,
        message: "Credenciales inválidas",
        hint: process.env.NODE_ENV === 'development' ? "Usuario no encontrado" : undefined
      });
    }

    console.log("✅ Usuario encontrado:", user.email);

    // Verificar contraseña
    const validPassword = await bcrypt.compare(password, user.password);
    console.log("🔑 Contraseña válida:", validPassword);

    if (!validPassword) {
      console.log("❌ Contraseña incorrecta para:", email);
      return res.status(401).json({ 
        success: false,
        message: "Credenciales inválidas",
        hint: process.env.NODE_ENV === 'development' ? "Contraseña incorrecta" : undefined
      });
    }

    // Crear token JWT
    const token = jwt.sign(
      {
        id: user._id,
        email: user.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    console.log("✅ Login exitoso para:", user.email);

    res.json({
      success: true,
      message: "Login exitoso",
      token,
      user: {
        id: user._id,
        email: user.email,
        nombre: user.nombre,
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
        nombre: user.nombre
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