// middlewares/auth.js
import jwt from "jsonwebtoken";

const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: "No se proporcionó token de autorización. Debes iniciar sesión.",
        code: "NO_TOKEN",
      });
    }

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Formato de token inválido. Debe ser: Bearer <token>",
        code: "INVALID_TOKEN_FORMAT",
      });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        error: "Token vacío. Debes iniciar sesión.",
        code: "EMPTY_TOKEN",
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error("❌ JWT_SECRET no está configurado en el servidor");
      return res.status(500).json({
        error: "Error de configuración del servidor",
        code: "NO_JWT_SECRET",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Adjuntar información del usuario a la petición
    req.user = {
      id: decoded.id,
      email: decoded.email,
      nombre: decoded.nombre,
      rol: decoded.rol, // administrador | colaborador | vendedor
    };

    next();
  } catch (error) {
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

    console.error("❌ Error en autenticación:", error.message);
    return res.status(500).json({
      error: "Error al verificar la autenticación",
      code: "AUTH_ERROR",
      details: error.message,
    });
  }
};

export default authMiddleware;
