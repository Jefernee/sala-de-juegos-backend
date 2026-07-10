// models/plays.js
import mongoose from 'mongoose';

const playSchema = new mongoose.Schema({
  fecha: {
    type: Date,
    required: [true, 'La fecha es requerida'],
    default: Date.now
  },
  cliente: {
    type: String,
    required: [true, 'El nombre del cliente es requerido'],
    trim: true
  },
  atendio: {
    type: String,
    required: [true, 'El nombre de quien atendió es requerido'],
    enum: ['Jefernee', 'Minor', 'Antoyef', 'Stiven', 'Tobit', 'Anfernee', 'Leda'],
    trim: true
  },
  tiempoPagado: {
    type: Number,
    required: [true, 'El tiempo pagado es requerido'],
    min: [0, 'El tiempo no puede ser negativo']
  },
  tiempoPendiente: {
    type: Number,
    default: 0,
    min: [0, 'El tiempo no puede ser negativo']
  },
  horaInicio: {
    type: String,
    required: [true, 'La hora de inicio es requerida'],
    trim: true
  },
  horaFinal: {
    type: String,
    required: [true, 'La hora final es requerida'],
    trim: true
  },
  lugarDeJuego: {
    type: String,
    required: [true, 'El lugar de juego es requerido'],
    enum: [
      'Play 4 número 1',
      'Play 4 número 2', 
      'Play 4 número 3',
      'Play 5 número 1',
      'Play 5 número 2',
      'Play 5 número 3',
      'Ping Pong'
    ],
    trim: true
  },
  tipoPlay: {
    type: String,
    enum: ['Play 4', 'Play 5', 'Ping Pong'],
    required: true
  },
  juegosJugados: {
    type: [String],
    validate: {
      validator: function(arr) {
        return arr.length <= 2;
      },
      message: 'Solo se pueden seleccionar hasta 2 juegos'
    },
    default: []
  },
  // Total de controles usados en la partida (1 a 4). Es el dato "real": los 2
  // primeros son gratis y del 3.º en adelante se cobran (ver controlAdicional).
  totalControles: {
    type: Number,
    required: [true, 'El total de controles es requerido'],
    min: [1, 'Mínimo 1 control'],
    max: [4, 'Máximo 4 controles']
  },
  // Controles que se COBRAN = max(0, totalControles - 2). Base del costo y de
  // los reportes; se mantiene para no cambiar ese cálculo.
  controlAdicional: {
    type: Number,
    default: 0,
    min: [0, 'No puede ser negativo'],
    max: [2, 'Máximo 2 controles adicionales']
  },
  subtotal: {
    type: Number,
    default: 0,
    min: [0, 'El subtotal no puede ser negativo']
  },
  costoControles: {
    type: Number,
    default: 0,
    min: [0, 'El costo no puede ser negativo']
  },
  total: {
    type: Number,
    default: 0,
    min: [0, 'El total no puede ser negativo']
  },
  // Monto REAL cobrado por el play. Es la fuente de verdad del ingreso: se usa
  // tal cual (no se recalcula desde el tiempo) para que el reporte sume el monto
  // exacto que se cobró. En "modo por tiempo" coincide con total; en "modo por
  // monto" el empleado escribe el monto y el tiempo se deriva. Igual a `total`.
  montoPagado: {
    type: Number,
    default: 0,
    min: [0, 'El monto no puede ser negativo']
  },
  // Totales separados para reportes
  totalPlay4: {
    type: Number,
    default: 0
  },
  totalPlay5: {
    type: Number,
    default: 0
  },
  totalPingPong: {
    type: Number,
    default: 0
  },
  estadoPago: {
    type: String,
    enum: ['En Proceso', 'Completado', 'Pendiente'],
    default: 'En Proceso',
    required: true
  },
  // ─────────────────────────────────────────────────────────────
  // Notificación automática de fin de sesión por WhatsApp
  // Hecho por Claude Code. Ver utils/finSesionScheduler.js
  // ─────────────────────────────────────────────────────────────
  // Instante exacto en que se agota el tiempo pagado (hora de registro + tiempoPagado).
  // El scheduler dispara la notificación cuando este momento ya pasó.
  finProgramado: {
    type: Date,
    default: null
  },
  // Bandera anti-duplicado: true cuando ya se mandó (o se intentó) el aviso de fin.
  notificacionFinEnviada: {
    type: Boolean,
    default: false
  },
  // ─────────────────────────────────────────────────────────────
  // Origen del registro. Los plays normales quedan en null (creados por el
  // sistema). Los cierres mensuales importados del Excel histórico llevan
  // 'excel_historico': son agregados (uno por rubro/mes), no sesiones reales.
  // Sirve para el rollback de la migración (borrar solo lo migrado) y para que
  // cualquier lógica que espere detalle de sesión pueda distinguirlos.
  // Ver scripts/migrarHistoricoExcel.js
  // ─────────────────────────────────────────────────────────────
  origen: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// ✅ ELIMINADO el middleware pre('save') problemático
// Ahora el controlador se encarga de asignar tipoPlay y los totales

const Play = mongoose.model('Play', playSchema);

export default Play;