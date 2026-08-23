// utils/rolesVigentes.js
//
// El rol DE VERDAD de cada usuario, leído de la base y no del token.
//
// POR QUÉ EXISTE: el rol viaja dentro del token, y el token ahora dura 10 años.
// Sin esto, cambiarle el rol a alguien no le haría ningún efecto mientras siga
// con el token que tiene en el celular — o sea, prácticamente nunca. La otra
// salida era cerrarle la sesión al cambiarle el rol, pero eso lo devolvería a
// la pantalla de login, que es justo lo que se quiso eliminar. Así que el token
// sirve para saber QUIÉN es; el rol se consulta acá.
//
// El caché es igual al de los cortes (ver utils/cortesSesion.js) y por el mismo
// motivo: esto corre en CADA petición y no puede pagar una consulta a Mongo
// cada vez. Se relee una vez por minuto, y al cambiar un rol se refresca en el
// acto para que aplique de inmediato.
//
// Si la lectura falla (Mongo caído), se usa lo último que se supo, y si nunca
// se supo nada se cae al rol del token: es preferible seguir funcionando con un
// dato de hace un minuto que dejar la app tiesa.
import User from '../models/User.js';

const REFRESCO_MS = 60 * 1000;

let cache = new Map(); // id (string) → rol
let leidoEn = 0;
let cargando = null;

export const refrescarRoles = async () => {
  const usuarios = await User.find().select('rol').lean();
  cache = new Map(usuarios.map((u) => [String(u._id), u.rol]));
  leidoEn = Date.now();
  return cache;
};

const releerEnSegundoPlano = () => {
  if (cargando) return cargando;
  cargando = refrescarRoles()
    .catch((e) => {
      console.error('⚠️ No se pudieron leer los roles (se usa el último valor):', e.message);
      // Se marca como leído igual para no golpear Mongo en cada petición
      // mientras esté caído. Se reintenta al próximo vencimiento.
      leidoEn = Date.now();
    })
    .finally(() => { cargando = null; });
  return cargando;
};

// Garantiza que el caché se haya leído AL MENOS una vez antes de decidir.
// Solo la primera vez del proceso se espera; después el refresco es en segundo
// plano y no frena ninguna petición.
export const rolesListos = async () => {
  if (leidoEn === 0) await releerEnSegundoPlano();
  else if (Date.now() - leidoEn >= REFRESCO_MS) releerEnSegundoPlano();
};

// El rol actual de un usuario, o null si no se sabe (usuario recién creado que
// todavía no entró al caché, o Mongo caído en el arranque). Quien llama decide
// qué hacer con el null; lo normal es caer al rol del token.
export const rolVigente = (usuarioId) => cache.get(String(usuarioId)) || null;
