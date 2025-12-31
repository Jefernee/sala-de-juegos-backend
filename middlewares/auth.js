// ============================================
// 2. MIDDLEWARE DE AUTENTICACIÓN (middleware/auth.js)
// ============================================
import jwt from 'jsonwebtoken';

const authMiddleware = (req, res, next) => {
  try {
    // Obtener token del header
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: "Acceso denegado. No hay token." });
    }
    
    // Verificar token
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (error) {
    res.status(401).json({ message: "Token inválido o expirado" });
  }
};

export default authMiddleware;