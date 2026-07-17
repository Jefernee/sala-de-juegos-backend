// middlewares/roles.js
// Autorización por rol (defensa real en el backend).
//
// Dos piezas:
//   • restringirVendedor: guard GLOBAL. Un vendedor solo puede tocar los
//     módulos de Ventas y Control de plays (más leer productos para el POS y
//     autenticarse). Cualquier otra ruta /api/* le devuelve 403, aunque intente
//     llamarla por fuera del frontend. admin y colaborador pasan sin restricción.
//   • soloAdmin: guard puntual para endpoints que solo el administrador puede
//     usar (ej. gestionar los roles de los demás usuarios). Va DESPUÉS de
//     authMiddleware, porque necesita req.user.rol.
import jwt from 'jsonwebtoken';
import { ROL_ADMIN, ROL_VENDEDOR } from '../config/roles.js';

// Prefijos que un vendedor SÍ puede usar (además de GET en /api/products).
const VENDEDOR_PERMITIDO = ['/api/auth', '/api/sales', '/api/plays'];

// ¿La ruta pedida está permitida para un vendedor?
const vendedorPuede = (path, method) => {
  const enLista = VENDEDOR_PERMITIDO.some((p) => path === p || path.startsWith(p + '/'));
  if (enLista) return true;
  // El POS de ventas necesita LEER el catálogo de productos (solo lectura).
  if (path === '/api/products' || path.startsWith('/api/products/')) {
    return method === 'GET';
  }
  return false;
};

export const restringirVendedor = (req, res, next) => {
  const authHeader = req.headers.authorization;
  // Sin token: dejamos que el authMiddleware de la ruta responda 401 como siempre.
  if (!authHeader?.startsWith('Bearer ')) return next();

  let decoded;
  try {
    decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
  } catch {
    // Token inválido/expirado: que lo maneje el authMiddleware de la ruta.
    return next();
  }

  // Solo restringimos a los vendedores. Tokens viejos sin rol (o admin/
  // colaborador) tienen acceso total y pasan de largo.
  if (decoded.rol !== ROL_VENDEDOR) return next();

  if (!vendedorPuede(req.path, req.method)) {
    return res.status(403).json({
      error: 'Tu rol (vendedor) solo tiene acceso a Ventas y Control de plays.',
      code: 'ROL_NO_AUTORIZADO',
    });
  }
  next();
};

// Solo el administrador puede continuar. Requiere authMiddleware antes.
export const soloAdmin = (req, res, next) => {
  if (req.user?.rol !== ROL_ADMIN) {
    return res.status(403).json({
      error: 'Solo el administrador puede realizar esta acción.',
      code: 'SOLO_ADMIN',
    });
  }
  next();
};
