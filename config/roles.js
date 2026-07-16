// config/roles.js
// Hecho por Claude Code — Definición central de roles de usuario.
//
// Tres roles:
//   • administrador → el dueño. Acceso total. Es UNA sola cuenta (ADMIN_EMAIL).
//   • colaborador   → personal de confianza. Acceso total (igual que el admin
//                     hoy). Es el rol por defecto de cualquier usuario nuevo y
//                     el que se le asigna a todos los usuarios existentes.
//   • vendedor      → cajero. Solo puede usar los módulos de Ventas y de
//                     Control de plays (ver middlewares/roles.js).
//
// El correo del administrador se puede sobreescribir con la variable de entorno
// ADMIN_EMAIL; si no está, se usa el del dueño. Se guarda en minúsculas porque
// el modelo User guarda el email en minúsculas (lowercase: true).
export const ROL_ADMIN = 'administrador';
export const ROL_COLABORADOR = 'colaborador';
export const ROL_VENDEDOR = 'vendedor';

export const ROLES = [ROL_ADMIN, ROL_COLABORADOR, ROL_VENDEDOR];

export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'jefernee.ruiz@gmail.com')
  .trim()
  .toLowerCase();
