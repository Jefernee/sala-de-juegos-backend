import mongoose from "mongoose";
import User from "../models/User.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { ROLES, ROL_ADMIN, ROL_COLABORADOR, ADMIN_EMAIL } from "../config/roles.js";
import SesionesCorte from "../models/SesionesCorte.js";
import { refrescarCortes, estadoCortes, segundoDeCorte, cortesListos, tokenInvalidadoPorCorte, cortarSesionDe } from "../utils/cortesSesion.js";
import { cifrarPassword, descifrarPassword } from "../utils/passwordVisible.js";
import { refrescarRoles, rolesListos, rolVigente } from "../utils/rolesVigentes.js";

// Vencimiento del token de sesión.
//
// Es tan largo que en la práctica la sesión no se cae sola: se entra una vez y
// el celular queda adentro. NO es "sin vencimiento" a propósito — ver el
// comentario largo en el login, más abajo.
const SESION_LARGA = "3650d"; // 10 años

// Quién hace la petición, según el Bearer token (si lo hay). Sirve para que
// register solo permita asignar un rol distinto de 'colaborador' cuando quien
// crea el usuario es un administrador autenticado. Nunca lanza.
//
// El rol se consulta, no se lee del token (ver utils/rolesVigentes.js): si a un
// administrador lo bajaron a colaborador, su token sigue diciendo
// "administrador" durante 10 años, y no debería poder seguir creando vendedores
// con él. Requiere haber llamado a rolesListos() antes.
const rolDelSolicitante = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
    return rolVigente(decoded.id) || decoded.rol || null;
  } catch {
    return null;
  }
};

// ============================================
// REGISTRO DE USUARIO
// ============================================
export const register = async (req, res) => {
  try {
    const { email, password, nombre } = req.body;

    console.log("📝 ========================================");
    console.log("📝 REGISTRO REQUEST RECIBIDO");
    console.log("📝 Timestamp:", new Date().toISOString());
    console.log("📝 Email:", email);

    // Validación de campos
    if (!email || !password || !nombre) {
      console.log("❌ Faltan campos requeridos");
      return res.status(400).json({ 
        success: false,
        message: "Todos los campos son requeridos",
        missingFields: {
          email: !email,
          password: !password,
          nombre: !nombre
        }
      });
    }

    // Verificar si el usuario ya existe
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log("❌ Usuario ya existe:", email);
      return res.status(400).json({ 
        success: false,
        message: "El usuario ya existe",
        field: "email"
      });
    }

    // Determinar el rol a asignar. Por seguridad, un registro PÚBLICO siempre
    // crea 'colaborador'. Solo un administrador autenticado puede crear un
    // usuario con otro rol (ej. un vendedor). Nunca se puede crear un segundo
    // administrador desde acá (ese lo define el email del dueño en la migración).
    let rolAsignado = ROL_COLABORADOR;
    await rolesListos();
    if (rolDelSolicitante(req) === ROL_ADMIN && ROLES.includes(req.body.rol) && req.body.rol !== ROL_ADMIN) {
      rolAsignado = req.body.rol;
    }

    // Hashear contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Crear usuario. Guardamos también la copia cifrada recuperable para que el
    // administrador pueda ver la contraseña en el módulo de Usuarios.
    const user = new User({
      email,
      password: hashedPassword,
      passwordVisible: cifrarPassword(password),
      nombre,
      rol: rolAsignado,
    });

    await user.save();

    console.log(`✅ Usuario creado exitosamente: ${email} (rol: ${user.rol})`);

    res.status(201).json({
      success: true,
      message: "Usuario creado exitosamente",
      user: {
        id: user._id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol,
      },
    });

  } catch (error) {
    console.error("❌ ERROR EN REGISTRO:", error);

    // Error de validación de Mongoose
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: "Error de validación",
        errors: Object.keys(error.errors).map(key => ({
          field: key,
          message: error.errors[key].message
        })),
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    }

    // Error de duplicado (email único)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "El email ya está registrado",
        field: "email"
      });
    }

    // Error genérico
    res.status(500).json({ 
      success: false,
      message: "Error al registrar usuario",
      error: process.env.NODE_ENV === 'development' ? error.message : 'Error interno del servidor',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
};

// ============================================
// LOGIN CON MEDICIÓN DE TIEMPOS
// ============================================
export const login = async (req, res) => {
  const timestamps = {
    inicio: Date.now()
  };

  try {
    console.log("🔐 ========================================");
    console.log("🔐 LOGIN REQUEST RECIBIDO");
    console.log("🔐 Timestamp:", new Date().toISOString());
    
    const { email, password } = req.body;
    console.log("🔍 Email:", email);

    // Validación de campos
    if (!email || !password) {
      console.log("❌ Campos incompletos");
      return res.status(400).json({ 
        success: false,
        message: "Email y contraseña son requeridos",
        missingFields: {
          email: !email,
          password: !password
        }
      });
    }

    timestamps.validacion = Date.now();
    console.log(`⏱️  Validación: ${timestamps.validacion - timestamps.inicio}ms`);

    // Buscar usuario en MongoDB
    const user = await User.findOne({ email });
    timestamps.busquedaDB = Date.now();
    console.log(`⏱️  Búsqueda en MongoDB: ${timestamps.busquedaDB - timestamps.validacion}ms`);

    if (!user) {
      console.log("❌ Usuario no encontrado:", email);
      return res.status(401).json({ 
        success: false,
        message: "Credenciales inválidas",
        hint: process.env.NODE_ENV === 'development' ? "Usuario no encontrado" : undefined
      });
    }

    console.log("✅ Usuario encontrado:", user.email);

    // Verificar contraseña con bcrypt
    const validPassword = await bcrypt.compare(password, user.password);
    timestamps.bcrypt = Date.now();
    console.log(`⏱️  Bcrypt compare: ${timestamps.bcrypt - timestamps.busquedaDB}ms`);
    console.log("🔑 Contraseña válida:", validPassword);

    if (!validPassword) {
      console.log("❌ Contraseña incorrecta para:", email);
      return res.status(401).json({ 
        success: false,
        message: "Credenciales inválidas",
        hint: process.env.NODE_ENV === 'development' ? "Contraseña incorrecta" : undefined
      });
    }

    // Crear token JWT (incluye el rol para autorizar módulos en el backend)
    const token = jwt.sign(
      {
        id: user._id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol,
      },
      process.env.JWT_SECRET,
      // ─────────────────────────────────────────────────────────────
      // LA SESIÓN NO SE CAE SOLA.
      //
      // Antes duraba 24h y el celular del vendedor pedía login todos los días,
      // en medio del mostrador. Ahora se entra una vez y el teléfono queda
      // adentro.
      //
      // POR QUÉ 10 AÑOS Y NO "SIN VENCIMIENTO": un token sin `exp` es válido
      // para este backend, pero deja sin respuesta a cualquier frontend que
      // mire la fecha de vencimiento para saber si la sesión sigue viva. Al no
      // encontrarla, lo normal es que la dé por vencida y mande al login otra
      // vez — el token eterno terminaría causando justo lo que se quería
      // evitar. Con una fecha lejana la sesión es eterna en la práctica y el
      // token sigue siendo un token corriente para quien lo lea.
      //
      // "Eterna" solo se corta de una forma: el dueño aprieta "Cerrar sesiones"
      // y se guarda una fecha de corte que invalida todos los tokens firmados
      // antes (ver models/SesionesCorte.js). Ese es el freno que reemplaza al
      // vencimiento: si se pierde un celular, hay que usarlo.
      //
      // JWT_EXPIRA_EN existe por si algún día se quiere volver a un vencimiento
      // corto ("30d", "12h").
      // ─────────────────────────────────────────────────────────────
      { expiresIn: process.env.JWT_EXPIRA_EN || SESION_LARGA }
    );
    timestamps.jwt = Date.now();
    console.log(`⏱️  Generación JWT: ${timestamps.jwt - timestamps.bcrypt}ms`);

    console.log("✅ Login exitoso para:", user.email);

    // Tiempo total
    timestamps.fin = Date.now();
    const tiempoTotal = timestamps.fin - timestamps.inicio;
    
    console.log("📊 ========== RESUMEN DE TIEMPOS ==========");
    console.log(`⏱️  Validación:     ${timestamps.validacion - timestamps.inicio}ms`);
    console.log(`⏱️  MongoDB:        ${timestamps.busquedaDB - timestamps.validacion}ms`);
    console.log(`⏱️  Bcrypt:         ${timestamps.bcrypt - timestamps.busquedaDB}ms`);
    console.log(`⏱️  JWT:            ${timestamps.jwt - timestamps.bcrypt}ms`);
    console.log(`⏱️  TIEMPO TOTAL:   ${tiempoTotal}ms (${(tiempoTotal/1000).toFixed(2)}s)`);
    console.log("==========================================");

    res.json({
      success: true,
      message: "Login exitoso",
      token,
      user: {
        id: user._id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol,
      },
    });

  } catch (error) {
    console.error("❌ ERROR EN LOGIN:", error);

    // Error de JWT
    if (error.name === 'JsonWebTokenError') {
      return res.status(500).json({
        success: false,
        message: "Error al generar token",
        error: process.env.NODE_ENV === 'development' ? error.message : 'Error de autenticación'
      });
    }

    // Error de conexión a BD
    if (error.name === 'MongoNetworkError' || error.name === 'MongoServerError') {
      return res.status(503).json({
        success: false,
        message: "Error de conexión con la base de datos",
        error: process.env.NODE_ENV === 'development' ? error.message : 'Servicio temporalmente no disponible'
      });
    }

    // Error genérico
    res.status(500).json({ 
      success: false,
      message: "Error al iniciar sesión",
      error: process.env.NODE_ENV === 'development' ? error.message : 'Error interno del servidor',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
};

// ============================================
// VERIFICAR TOKEN
// ============================================
export const verifyToken = async (req, res) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      console.log("❌ Token no proporcionado");
      return res.status(401).json({
        success: false,
        valid: false,
        message: "Token no proporcionado",
        code: "NO_TOKEN",
      });
    }

    // Verificar token
    const verified = jwt.verify(token, process.env.JWT_SECRET);

    // Mismo freno que el authMiddleware: el frontend llama a /verify al abrir
    // la app, y si el dueño cerró las sesiones tiene que enterarse ACÁ, antes
    // de entrar a ninguna pantalla.
    await cortesListos();
    if (tokenInvalidadoPorCorte(verified)) {
      return res.status(401).json({
        success: false,
        valid: false,
        message: "Tu sesión fue cerrada por el administrador. Iniciá sesión de nuevo.",
        code: "SESION_CERRADA",
      });
    }

    // Buscar usuario
    const user = await User.findById(verified.id).select("-password");

    if (!user) {
      console.log("❌ Usuario no encontrado para token");
      // El token está bien firmado pero apunta a alguien que ya no está. Va
      // como INVALID_TOKEN porque para el frontend el efecto es el mismo: este
      // token no sirve, hay que volver a entrar.
      return res.status(401).json({
        success: false,
        valid: false,
        message: "Usuario no encontrado",
        code: "INVALID_TOKEN",
      });
    }

    console.log("✅ Token válido para:", user.email);

    res.json({
      success: true,
      valid: true,
      user: {
        id: user._id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol,
      }
    });

  } catch (error) {
    console.error("❌ ERROR EN VERIFICACIÓN:", error);

    // Token expirado
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        valid: false,
        message: "Token expirado",
        expired: true,
        code: "EXPIRED_TOKEN",
      });
    }

    // Token inválido
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        valid: false,
        message: "Token inválido",
        code: "INVALID_TOKEN",
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }

    // Error inesperado (Mongo caído, un bug acá adentro): va como 500, NO como
    // 401. Un 401 significa "tu sesión no sirve" y el frontend está en su
    // derecho de mandar al login al recibirlo; devolverlo por un problema
    // nuestro es justo lo que sacaba al vendedor de la app al abrirla.
    res.status(500).json({
      success: false,
      valid: false,
      message: "Error al verificar token",
      code: "AUTH_ERROR",
      error: process.env.NODE_ENV === 'development' ? error.message : 'Error de autenticación'
    });
  }
};

// ============================================
// LISTAR USUARIOS (solo administrador)
// Para el panel de gestión de roles del frontend.
// ============================================
export const getUsers = async (req, res) => {
  try {
    // Las contraseñas visibles SOLO las puede ver el dueño (ADMIN_EMAIL). Otros
    // administradores gestionan usuarios/roles pero NUNCA ven contraseñas: ni
    // siquiera se cargan de la base para ellos.
    const esDueno = String(req.user?.email || "").toLowerCase() === ADMIN_EMAIL;

    // +passwordVisible: el campo es select:false; con "+" se agrega de forma
    // confiable. Solo se pide cuando quien consulta es el dueño.
    let consulta = User.find().sort({ createdAt: 1 });
    if (esDueno) consulta = consulta.select("+passwordVisible");
    const users = await consulta.lean();

    // Construimos la salida explícitamente: NO exponemos el hash de login
    // (`password` del doc). La contraseña descifrada se devuelve SOLO al dueño;
    // para cualquier otro admin va null.
    const salida = users.map((u) => ({
      _id: u._id,
      email: u.email,
      nombre: u.nombre,
      rol: u.rol,
      createdAt: u.createdAt,
      password: esDueno ? descifrarPassword(u.passwordVisible) : null,
    }));

    res.json({ success: true, users: salida });
  } catch (error) {
    console.error("❌ ERROR AL LISTAR USUARIOS:", error);
    res.status(500).json({ success: false, message: "Error al listar usuarios", error: error.message });
  }
};

// ============================================
// REASIGNAR CONTRASEÑA DE UN USUARIO (solo administrador)
// Actualiza el login (hash) y la copia visible a la vez.
// ============================================
export const updateUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "ID de usuario inválido" });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ success: false, message: "La contraseña debe tener al menos 6 caracteres" });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "Usuario no encontrado" });
    }

    // Blindaje de la cuenta del dueño: solo el propio dueño puede cambiar su
    // contraseña. Así ningún otro admin puede resetearla para entrar como él.
    const esDueno = String(req.user?.email || "").toLowerCase() === ADMIN_EMAIL;
    if (user.email === ADMIN_EMAIL && !esDueno) {
      return res.status(403).json({
        success: false,
        message: "Solo el dueño puede cambiar la contraseña de esta cuenta.",
      });
    }

    // Cambiarle la clave a OTRA persona le cierra la sesión: si no, su celular
    // seguiría adentro con la sesión vieja y el cambio no habría servido de
    // nada (el token dura 10 años). A uno mismo NO se la cierra — el que acaba
    // de escribir la contraseña nueva es uno, no hay nada que proteger, y salir
    // de la app sería un castigo sin motivo.
    //
    // El corte va ANTES de guardar a propósito: si fallara después, quedaría
    // una contraseña nueva con una sesión vieja viva, que es justo lo que no se
    // quiere. Al revés no hace daño — si falla el guardado, esa persona vuelve
    // a entrar con la contraseña de siempre.
    const esUnoMismo = String(user._id) === String(req.user.id);
    if (!esUnoMismo) {
      await cortarSesionDe(user._id, `cambio de contraseña por ${req.user.email}`);
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    user.passwordVisible = cifrarPassword(password);
    await user.save();

    console.log(`✅ Contraseña reasignada para ${user.email}`);
    res.json({
      success: true,
      message: esUnoMismo
        ? "Contraseña actualizada."
        : "Contraseña actualizada. Esa persona va a tener que iniciar sesión de nuevo.",
      sesionCerrada: !esUnoMismo,
      user: { id: user._id, email: user.email },
    });
  } catch (error) {
    console.error("❌ ERROR AL REASIGNAR CONTRASEÑA:", error);
    res.status(500).json({ success: false, message: "Error al reasignar la contraseña", error: error.message });
  }
};

// ============================================
// CAMBIAR EL ROL DE UN USUARIO (solo administrador)
// Recibe { rol } en el body. El administrador puede asignar cualquiera de los
// roles, incluido 'administrador' (así puede tener varios administradores). Lo
// único que NO se puede es cambiarle el rol a la cuenta del dueño (ADMIN_EMAIL),
// que siempre queda como administrador para no dejar el sistema sin admin.
// ============================================
export const updateUserRol = async (req, res) => {
  try {
    const { id } = req.params;
    const { rol } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "ID de usuario inválido" });
    }

    // Se puede asignar cualquiera de los roles válidos (incluido administrador).
    if (!ROLES.includes(rol)) {
      return res.status(400).json({
        success: false,
        message: `Rol inválido. Valores permitidos: ${ROLES.join(", ")}`,
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "Usuario no encontrado" });
    }

    // Proteger la cuenta del dueño: no se le puede quitar el rol de administrador.
    if (user.email === ADMIN_EMAIL) {
      return res.status(400).json({
        success: false,
        message: "No se puede cambiar el rol de la cuenta del administrador (dueño).",
      });
    }

    user.rol = rol;
    await user.save();

    // El rol nuevo aplica SIN sacar a esa persona de la app: el backend ya no
    // le cree al token, consulta el rol (ver utils/rolesVigentes.js). Este
    // refresco es lo que hace que valga en el acto y no dentro de un minuto.
    await refrescarRoles();

    console.log(`✅ Rol de ${user.email} cambiado a "${rol}"`);
    res.json({
      success: true,
      message: "Rol actualizado. Aplica de inmediato, sin que tenga que volver a iniciar sesión.",
      user: { id: user._id, email: user.email, nombre: user.nombre, rol: user.rol },
    });
  } catch (error) {
    console.error("❌ ERROR AL CAMBIAR ROL:", error);
    res.status(500).json({ success: false, message: "Error al cambiar el rol", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// Lo que SOLO puede hacer la cuenta del dueño (ADMIN_EMAIL).
//
// Es una nota para el panel de Usuarios: cuando el dueño entra ahí, ve de un
// vistazo qué cosas son suyas y de nadie más. Hoy hay TRES cuentas con rol
// administrador (Jefernee, Antoyef, Minor), y es fácil olvidarse de cuáles
// están reservadas.
//
// Vive en el backend a propósito: es el backend el que hace cumplir cada una de
// estas reglas, así que la lista no se puede desincronizar de la realidad.
// ─────────────────────────────────────────────────────────────────
const PRIVILEGIOS_DEL_DUENO = [
  {
    clave: 'cerrar_sesiones',
    titulo: 'Cerrar las sesiones de todos',
    detalle:
      'Obliga a volver a iniciar sesión en todos los dispositivos. Los demás administradores no pueden hacerlo. Usalo si se pierde o se roba un celular con la app abierta.',
  },
  {
    clave: 'ver_contrasenas',
    titulo: 'Ver las contraseñas de los usuarios',
    detalle:
      'En la lista de usuarios solo vos ves la contraseña de cada uno. A los otros administradores ni siquiera se les manda desde el servidor.',
  },
  {
    clave: 'contrasena_protegida',
    titulo: 'Tu contraseña no te la puede cambiar nadie',
    detalle:
      'Ningún otro administrador puede cambiar la contraseña de tu cuenta, así que no pueden entrar como vos.',
  },
  {
    clave: 'rol_protegido',
    titulo: 'Tu rol no se puede tocar',
    detalle:
      'Nadie puede quitarle el rol de administrador a tu cuenta, ni siquiera vos por error.',
  },
];

// ─────────────────────────────────────────────────────────────────
// GET /api/auth/acceso-dueno   (authMiddleware + soloDueño)
// La nota del panel de Usuarios + el estado actual de las sesiones.
// ─────────────────────────────────────────────────────────────────
export const accesoDueno = async (req, res) => {
  try {
    await refrescarCortes();
    const doc = await SesionesCorte.findOne({ clave: 'sesiones' }).lean();
    const cortes = estadoCortes();

    // Nombre y correo de los usuarios que tienen un corte individual, para que
    // el panel no muestre ids sueltos.
    const ids = cortes.usuariosConCorte.map((u) => u.usuarioId);
    const usuarios = ids.length ? await User.find({ _id: { $in: ids } }).select('nombre email').lean() : [];
    const porId = new Map(usuarios.map((u) => [String(u._id), u]));

    res.json({
      ok: true,
      cuenta: req.user.email,
      soloVos: PRIVILEGIOS_DEL_DUENO,
      sesiones: {
        cerradasTodasDesde: cortes.global,
        usuariosConSesionCerrada: cortes.usuariosConCorte.map((u) => ({
          ...u,
          nombre: porId.get(u.usuarioId)?.nombre || '',
          email: porId.get(u.usuarioId)?.email || '',
        })),
        ultimoCorte: doc?.ultimoCorte?.fecha ? doc.ultimoCorte : null,
      },
    });
  } catch (error) {
    console.error('❌ accesoDueno:', error);
    res.status(500).json({ ok: false, error: 'Error al leer el acceso del dueño', mensaje: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// POST /api/auth/cerrar-sesiones   (authMiddleware + soloDueño)
// Body: { usuarioId }  → cierra la sesión de ESE usuario.
// Body vacío           → cierra las de TODOS.
//
// Los tokens ya no vencen solos (se entra una vez y el celular queda adentro),
// así que esta es la única forma de sacar a alguien. Se guarda una fecha de
// corte y todo token firmado antes deja de servir.
// ─────────────────────────────────────────────────────────────────
export const cerrarSesiones = async (req, res) => {
  try {
    const { usuarioId } = req.body || {};
    const corte = new Date();

    const $set = {
      ultimoCorte: { fecha: corte, porEmail: req.user.email, alcance: usuarioId ? 'usuario' : 'todos' },
    };

    let objetivo = null;
    if (usuarioId) {
      objetivo = await User.findById(usuarioId).select('nombre email').lean();
      if (!objetivo) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
      $set[`porUsuario.${usuarioId}`] = corte;
    } else {
      $set.global = corte;
    }

    await SesionesCorte.updateOne({ clave: 'sesiones' }, { $set }, { upsert: true });

    // Refresco inmediato: sin esto el corte tardaría hasta un minuto en hacer
    // efecto, que es justo lo que no se quiere cuando se perdió un celular.
    await refrescarCortes();

    // El corte también invalida el token del dueño (fue firmado antes), así que
    // se le devuelve uno nuevo para que NO se saque a sí mismo del sistema.
    // El `iat` se fuerza al segundo del corte: firmado "normalmente" nacería
    // dentro del mismo segundo y el propio corte lo daría por viejo.
    const tokenNuevo = jwt.sign(
      {
        id: req.user.id,
        email: req.user.email,
        nombre: req.user.nombre,
        rol: req.user.rol,
        iat: segundoDeCorte(corte),
      },
      process.env.JWT_SECRET,
      // Mismo vencimiento largo que el del login. El `exp` se cuenta desde el
      // `iat` forzado de arriba.
      { expiresIn: process.env.JWT_EXPIRA_EN || SESION_LARGA }
    );

    console.log(`🔒 Sesiones cerradas por ${req.user.email} (${usuarioId ? objetivo.email : 'TODOS'})`);

    res.json({
      ok: true,
      alcance: usuarioId ? 'usuario' : 'todos',
      usuario: objetivo ? { id: usuarioId, nombre: objetivo.nombre, email: objetivo.email } : null,
      corte,
      mensaje: usuarioId
        ? `${objetivo.nombre || objetivo.email} va a tener que iniciar sesión de nuevo.`
        : 'Todos van a tener que iniciar sesión de nuevo. Tu sesión sigue abierta.',
      // El frontend DEBE guardar este token en lugar del que tenía.
      token: tokenNuevo,
    });
  } catch (error) {
    console.error('❌ cerrarSesiones:', error);
    res.status(500).json({ ok: false, error: 'Error al cerrar las sesiones', mensaje: error.message });
  }
};
