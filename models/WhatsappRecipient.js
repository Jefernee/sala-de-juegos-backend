// models/WhatsappRecipient.js
// Hecho por Claude Code — Destinatarios de las notificaciones de WhatsApp.
//
// CallMeBot no soporta grupos: cada persona recibe el mensaje en su propio
// número y cada número tiene SU PROPIA apikey. Estos destinatarios se
// administran desde el frontend (CRUD) y los lee tanto el backend como el
// Scheduled Trigger de MongoDB Atlas.
//
// La colección se llama 'whatsapp_recipients' (importante: el Trigger de Atlas
// la referencia con ese nombre exacto).
import mongoose from 'mongoose';

const whatsappRecipientSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: [true, 'El nombre es requerido'],
    trim: true,
  },
  telefono: {
    type: String,
    required: [true, 'El teléfono es requerido'],
    trim: true,
  },
  apikey: {
    type: String,
    required: [true, 'La apikey de CallMeBot es requerida'],
    trim: true,
  },
  activo: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
  collection: 'whatsapp_recipients',
});

const WhatsappRecipient = mongoose.model('WhatsappRecipient', whatsappRecipientSchema);

export default WhatsappRecipient;
