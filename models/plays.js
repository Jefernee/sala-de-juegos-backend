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
  }
}, {
  timestamps: true
});

// ✅ ELIMINADO el middleware pre('save') problemático
// Ahora el controlador se encarga de asignar tipoPlay y los totales

const Play = mongoose.model('Play', playSchema);

export default Play;