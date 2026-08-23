// utils/cortesSesion.js
//
// Caché en memoria de las fechas de corte de sesión (ver models/SesionesCorte.js).
//
// POR QUÉ UN CACHÉ: el middleware de autenticación corre en CADA petición de la
// app. Si preguntara a Mongo cada vez, cada toque en la pantalla de ventas
// costaría una consulta de ida y vuelta a Atlas. Como los cortes los hace el
// administrador a mano y son rarísimos, alcanza con releer el documento una vez
// por minuto — y cuando el propio backend hace un corte, el caché se refresca
// en el acto, así que el efecto es inmediato.
//
// Si la lectura falla (Mongo caído, arranque en frío), se conserva lo último
// que se supo y se deja pasar: es preferible que la app siga funcionando a que
// nadie pueda entrar por un problema de base de datos.
import SesionesCorte from '../models/SesionesCorte.js';

const REFRESCO_MS = 60 * 1000;

let cache = { global: null, porUsuario: new Map() };
let leidoEn = 0;
let cargando = null;

const aMapa = (doc) => {
  const m = new Map();
  if (!doc?.porUsuario) return m;
  // Mongoose devuelve un Map; el driver nativo, un objeto plano.
  const entradas = doc.porUsuario instanceof Map ? doc.porUsuario.entries() : Object.entries(doc.porUsuario);
  for (const [id, fecha] of entradas) if (fecha) m.set(String(id), new Date(fecha));
  return m;
};

// Relee el documento y actualiza el caché. Se llama sola por vencimiento, o a
// mano desde el endpoint que corta sesiones.
export const refrescarCortes = async () => {
  const doc = await SesionesCorte.findOne({ clave: 'sesiones' }).lean();
  cache = { global: doc?.global ? new Date(doc.global) : null, porUsuario: aMapa(doc) };
  leidoEn = Date.now();
  return cache;
};

const releerEnSegundoPlano = () => {
  if (cargando) return cargando;
  cargando = refrescarCortes()
    .catch((e) => {
      console.error('⚠️ No se pudieron leer los cortes de sesión (se usa el último valor):', e.message);
      // Se marca como leído igual para no golpear Mongo en cada petición
      // mientras esté caído. Se reintenta al próximo vencimiento.
      leidoEn = Date.now();
    })
    .finally(() => { cargando = null; });
  return cargando;
};

// Garantiza que el caché se haya leído AL MENOS una vez antes de decidir.
//
// Sin esto habría un hueco justo después de cada reinicio del server: el caché
// arranca vacío, y las primeras peticiones dejarían pasar un token que el
// administrador ya había cortado. Se espera solo la primera vez del proceso;
// de ahí en adelante el refresco es en segundo plano y no frena nada.
export const cortesListos = async () => {
  if (leidoEn === 0) await releerEnSegundoPlano();
  else if (Date.now() - leidoEn >= REFRESCO_MS) releerEnSegundoPlano();
};

// El segundo a partir del cual un token se considera emitido DESPUÉS del corte.
// Se exporta porque al cortar hay que firmarle al dueño un token nuevo con
// exactamente este `iat`, o su propio token nacería invalidado.
export const segundoDeCorte = (fecha) => Math.ceil(new Date(fecha).getTime() / 1000);

// ¿Este token quedó invalidado por un corte?
//
// `iat` ("issued at") es el momento en que se firmó el token, en SEGUNDOS.
// Se compara contra la fecha de corte que aplique: la global, la del usuario, o
// la más reciente de las dos.
export const tokenInvalidadoPorCorte = (decoded) => {
  if (!decoded?.iat) return false;

  const delUsuario = cache.porUsuario.get(String(decoded.id));
  const corte = [cache.global, delUsuario].filter(Boolean).sort((a, b) => b - a)[0];
  if (!corte) return false;

  // `iat` viene en SEGUNDOS enteros (se trunca al firmar), y la fecha de corte
  // tiene milisegundos. Se redondea el corte hacia ARRIBA: un token firmado en
  // el mismo segundo del corte se da por anterior. Es el lado seguro del
  // empate — preferimos pedir un login de más que dejar viva una sesión que se
  // quiso cerrar.
  return decoded.iat < segundoDeCorte(corte);
};

// Cierra la sesión de UNA persona, sin tocar la de nadie más.
//
// La usa el backend solo, cuando un cambio deja el token de esa persona
// desactualizado: el rol viaja DENTRO del token, así que cambiárselo no le hace
// efecto mientras siga con el que tiene en el celular — y con tokens de 10 años
// eso sería para siempre. Lo mismo con la contraseña: cambiársela a alguien no
// serviría de nada si su celular sigue adentro con la sesión vieja.
//
// No confundir con el botón "Cerrar sesiones" del dueño: ese es un acto
// deliberado y queda anotado en `ultimoCorte`. Este es una consecuencia
// automática de otra acción, y solo deja rastro en el log.
export const cortarSesionDe = async (usuarioId, motivo) => {
  const corte = new Date();
  await SesionesCorte.updateOne(
    { clave: 'sesiones' },
    { $set: { [`porUsuario.${usuarioId}`]: corte } },
    { upsert: true }
  );
  // Refresco inmediato: sin esto el corte tardaría hasta un minuto en aplicarse.
  await refrescarCortes();
  console.log(`🔒 Sesión de ${usuarioId} cerrada automáticamente (${motivo})`);
  return corte;
};

// Lectura del estado actual (para el panel del administrador).
export const estadoCortes = () => ({
  global: cache.global,
  usuariosConCorte: [...cache.porUsuario.entries()].map(([id, fecha]) => ({ usuarioId: id, desde: fecha })),
});
