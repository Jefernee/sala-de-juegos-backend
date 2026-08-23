// models/SesionesCorte.js
//
// El interruptor del administrador para obligar a volver a iniciar sesión.
//
// Los tokens JWT no se pueden "borrar": una vez firmados valen hasta que
// expiran, y ahora expiran en 10 años para que el celular del vendedor no pida
// login todos los días. Para poder cortarlos igual se guarda una FECHA DE
// CORTE: todo token emitido ANTES de esa fecha deja de valer.
//
// Es UN SOLO documento (clave: 'sesiones'):
//   • global    → corta las sesiones de TODOS.
//   • porUsuario → corta las de un usuario puntual (ej. se perdió un celular),
//                  sin sacar a los demás.
//
// Vale la que sea más reciente de las dos para ese usuario.
//
// Se lee UNA vez por minuto y se guarda en memoria (ver utils/cortesSesion.js):
// el middleware de autenticación corre en cada petición y no puede pagar una
// consulta a Mongo cada vez.
import mongoose from 'mongoose';

const sesionesCorteSchema = new mongoose.Schema(
  {
    // Clave fija: siempre hay un solo documento.
    clave: { type: String, default: 'sesiones', unique: true },

    // Tokens emitidos antes de esta fecha no valen para NADIE.
    // null = nunca se cortó nada.
    global: { type: Date, default: null },

    // Cortes individuales. Clave: id del usuario | Valor: fecha de corte.
    porUsuario: { type: Map, of: Date, default: () => new Map() },

    // Para poder decir en el panel quién cortó y cuándo.
    ultimoCorte: {
      fecha: { type: Date, default: null },
      porEmail: { type: String, default: '' },
      alcance: { type: String, default: '' }, // 'todos' | 'usuario'
    },
  },
  { timestamps: true }
);

export default mongoose.model('SesionesCorte', sesionesCorteSchema);
