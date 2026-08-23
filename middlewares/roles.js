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
import { ROL_ADMIN, ROL_VENDEDOR, ADMIN_EMAIL } from '../config/roles.js';
import { rolesListos, rolVigente } from '../utils/rolesVigentes.js';

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

export const restringirVendedor = async (req, res, next) => {
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

  // El rol se consulta, no se lee del token: este guard corre antes que el
  // authMiddleware y tiene que aplicar el rol de HOY, no el que tenía la
  // persona el día que hizo login (ver utils/rolesVigentes.js).
  await rolesListos();
  const rol = rolVigente(decoded.id) || decoded.rol;

  // Solo restringimos a los vendedores. Tokens viejos sin rol (o admin/
  // colaborador) tienen acceso total y pasan de largo.
  if (rol !== ROL_VENDEDOR) return next();

  if (!vendedorPuede(req.path, req.method)) {
    return res.status(403).json({
      error: 'Tu rol (vendedor) solo tiene acceso a Ventas y Control de plays.',
      code: 'ROL_NO_AUTORIZADO',
    });
  }
  next();
};

// ─────────────────────────────────────────────────────────────────
// Solo EL DUEÑO (la cuenta de ADMIN_EMAIL) puede continuar.
//
// Más estricto que soloAdmin: hoy hay TRES cuentas con rol 'administrador'
// (Jefernee, Antoyef y Minor), así que soloAdmin no sirve para las acciones que
// son del dueño y de nadie más — como cerrar las sesiones de todo el mundo.
// Se compara por email, en minúscula, contra ADMIN_EMAIL (ver config/roles.js).
// Requiere authMiddleware antes.
// ─────────────────────────────────────────────────────────────────
export const soloDueño = (req, res, next) => {
  const email = String(req.user?.email || '').trim().toLowerCase();
  if (email !== ADMIN_EMAIL) {
    return res.status(403).json({
      error: 'Esta acción es solo para el dueño de la sala.',
      code: 'SOLO_DUENO',
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
