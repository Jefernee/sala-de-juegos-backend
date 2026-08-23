// middlewares/auth.js
import jwt from "jsonwebtoken";
import { cortesListos, tokenInvalidadoPorCorte } from "../utils/cortesSesion.js";
import { rolesListos, rolVigente } from "../utils/rolesVigentes.js";

const authMiddleware = async (req, res, next) => {
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

    // Los tokens ya no vencen solos: el único freno es el corte que hace el
    // administrador desde el panel. Si este token se firmó antes del corte, se
    // pide login de nuevo. El código SESION_CERRADA lo distingue de un token
    // roto, para que el frontend muestre "se cerró la sesión" y no "error".
    await cortesListos();
    if (tokenInvalidadoPorCorte(decoded)) {
      return res.status(401).json({
        error: "Tu sesión fue cerrada por el administrador. Iniciá sesión de nuevo.",
        code: "SESION_CERRADA",
      });
    }

    // El rol NO se toma del token, se consulta (ver utils/rolesVigentes.js).
    // El token dura 10 años: si le creyéramos, cambiarle el rol a alguien no le
    // haría efecto hasta que volviera a entrar, y no se le va a pedir que
    // vuelva a entrar solo por eso. Si el caché todavía no sabe nada de este
    // usuario, se cae al rol del token.
    await rolesListos();

    // Adjuntar información del usuario a la petición
    req.user = {
      id: decoded.id,
      email: decoded.email,
      nombre: decoded.nombre,
      rol: rolVigente(decoded.id) || decoded.rol, // administrador | colaborador | vendedor
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
