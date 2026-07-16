import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { ROLES, ROL_COLABORADOR } from '../config/roles.js';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  nombre: {
    type: String,
    default: ''
  },
  // Rol del usuario. Controla qué módulos ve/usa (ver config/roles.js).
  // Por defecto 'colaborador' (acceso total, sin ser el dueño). Los usuarios
  // existentes se migran a este valor al arrancar; la cuenta del dueño se
  // fuerza a 'administrador' por email en esa misma migración.
  rol: {
    type: String,
    enum: {
      values: ROLES,
      message: 'Rol inválido: {VALUE}',
    },
    default: ROL_COLABORADOR,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Método para comparar contraseñas
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};


const User = mongoose.model('User', userSchema);

export default User;