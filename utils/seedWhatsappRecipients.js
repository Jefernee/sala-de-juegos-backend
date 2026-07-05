// utils/seedWhatsappRecipients.js
// Hecho por Claude Code — Siembra idempotente de destinatarios de WhatsApp.
//
// Corre al arrancar el servidor. Si la colección whatsapp_recipients está VACÍA
// y existe la variable CALLMEBOT_RECIPIENTS, inserta esos números para no perder
// el que ya estaba configurado. Si ya hay destinatarios en la base, no hace nada.
// (Mismo patrón idempotente que las otras migraciones al arranque.)
import WhatsappRecipient from '../models/WhatsappRecipient.js';
import { parseDestinatarios } from './notificacionesWhatsApp.js';

/**
 * @returns {Promise<{sembrados: number}>}
 */
export const seedWhatsappRecipients = async () => {
  const existentes = await WhatsappRecipient.countDocuments();
  if (existentes > 0) return { sembrados: 0 };

  const desdeEnv = parseDestinatarios(); // [{phone, apikey}] o []
  if (desdeEnv.length === 0) return { sembrados: 0 };

  const docs = desdeEnv.map((d, i) => ({
    nombre: `Destinatario ${i + 1}`,
    telefono: d.phone,
    apikey: d.apikey,
    activo: true,
  }));

  await WhatsappRecipient.insertMany(docs);
  return { sembrados: docs.length };
};
