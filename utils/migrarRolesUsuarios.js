// utils/migrarRolesUsuarios.js
// Migración idempotente de roles de usuario.
//
// 1) A todos los usuarios que aún no tienen rol (creados antes de esta feature)
//    se les asigna 'colaborador' (acceso total, sin ser el dueño).
// 2) La cuenta del dueño (ADMIN_EMAIL) se fuerza SIEMPRE a 'administrador',
//    aunque ya existiera con otro rol.
//
// Se corre al arrancar el servidor. Idempotente: solo escribe donde hace falta.
// Asume que la conexión a MongoDB ya está abierta.
import User from '../models/User.js';
import { ADMIN_EMAIL, ROL_ADMIN, ROL_COLABORADOR } from '../config/roles.js';

export const migrarRolesUsuarios = async () => {
  // 1) Usuarios sin rol → colaborador.
  const sinRol = await User.updateMany(
    { $or: [{ rol: { $exists: false } }, { rol: null }] },
    { $set: { rol: ROL_COLABORADOR } }
  );

  // 2) La cuenta del dueño → administrador (si no lo es ya).
  const admin = await User.updateMany(
    { email: ADMIN_EMAIL, rol: { $ne: ROL_ADMIN } },
    { $set: { rol: ROL_ADMIN } }
  );

  return {
    colaboradores: sinRol.modifiedCount || 0,
    adminFijado: (admin.modifiedCount || 0) > 0,
  };
};
