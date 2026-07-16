// middlewares/auth.js
import jwt from "jsonwebtoken";

const authMiddleware = (req, res, next) => {
  console.log("\n🔐 ========== AUTH MIDDLEWARE ==========");
  console.log("📍 Ruta:", req.method, req.originalUrl);
  console.log("📦 Headers:", {
    authorization: req.headers.authorization ? "✅ Presente" : "❌ Ausente",
    contentType: req.headers["content-type"],
  });

  try {
    // Obtener token del header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      console.error("❌ No se proporcionó token de autorización");
      return res.status(401).json({
        error: "No se proporcionó token de autorización. Debes iniciar sesión.",
        code: "NO_TOKEN",
      });
    }

    if (!authHeader.startsWith("Bearer ")) {
      console.error("❌ Formato de token inválido");
      return res.status(401).json({
        error: "Formato de token inválido. Debe ser: Bearer <token>",
        code: "INVALID_TOKEN_FORMAT",
      });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      console.error("❌ Token vacío");
      return res.status(401).json({
        error: "Token vacío. Debes iniciar sesión.",
        code: "EMPTY_TOKEN",
      });
    }

    console.log("🔑 Token recibido:", token.substring(0, 20) + "...");

    // Verificar que exista la clave secreta
    if (!process.env.JWT_SECRET) {
      console.error("❌ JWT_SECRET no está configurado en el servidor");
      return res.status(500).json({
        error: "Error de configuración del servidor",
        code: "NO_JWT_SECRET",
      });
    }

    // Verificar el token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    console.log("✅ Token verificado exitosamente");
    console.log("👤 Usuario:", {
      id: decoded.id,
      username: decoded.username,
      role: decoded.role,
    });

    // Adjuntar información del usuario a la petición
    req.user = {
      id: decoded.id,
      email: decoded.email, // ✅
      nombre: decoded.nombre, // ✅
      rol: decoded.rol, // rol del usuario (administrador | colaborador | vendedor)
    };

    console.log("🔐 ========== AUTH OK ==========\n");
    next();
  } catch (error) {
    console.error("❌ Error en autenticación:", {
      name: error.name,
      message: error.message,
    });

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        error: "Token inválido. Por favor, inicia sesión nuevamente.",
        code: "INVALID_TOKEN",
      });
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        error: "Token expirado. Por favor, inicia sesión nuevamente.",
        code: "EXPIRED_TOKEN",
      });
    }

    // Error genérico
    return res.status(500).json({
      error: "Error al verificar la autenticación",
      code: "AUTH_ERROR",
      details: error.message,
    });
  }
};

export default authMiddleware;
