// controllers/whatsappRecipientsController.js
// Hecho por Claude Code — CRUD de destinatarios de notificaciones WhatsApp.
// Lo usa el frontend para agregar/editar/borrar números sin tocar Koyeb.
import WhatsappRecipient from '../models/WhatsappRecipient.js';

// Normaliza el teléfono: quita espacios (deja el "+" si viene en internacional).
const limpiarTelefono = (tel) => String(tel || '').replace(/\s+/g, '').trim();

// ─────────────────────────────────────────────────────────────────
// GET - Listar todos los destinatarios
// ─────────────────────────────────────────────────────────────────
export const getRecipients = async (req, res) => {
  try {
    const recipients = await WhatsappRecipient.find().sort({ createdAt: 1 });
    res.status(200).json({ success: true, data: recipients });
  } catch (error) {
    console.error('❌ Error en getRecipients:', error);
    res.status(500).json({ success: false, message: 'Error al obtener los destinatarios', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// POST - Crear destinatario
// ─────────────────────────────────────────────────────────────────
export const createRecipient = async (req, res) => {
  try {
    const nombre = (req.body.nombre || '').trim();
    const telefono = limpiarTelefono(req.body.telefono);
    const apikey = (req.body.apikey || '').trim();
    const activo = req.body.activo !== undefined ? !!req.body.activo : true;

    if (!nombre || !telefono || !apikey) {
      return res.status(400).json({ success: false, message: 'nombre, telefono y apikey son requeridos' });
    }

    const recipient = await WhatsappRecipient.create({ nombre, telefono, apikey, activo });
    res.status(201).json({ success: true, message: 'Destinatario creado', data: recipient });
  } catch (error) {
    console.error('❌ Error en createRecipient:', error);
    res.status(400).json({ success: false, message: 'Error al crear el destinatario', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// PUT - Actualizar destinatario
// ─────────────────────────────────────────────────────────────────
export const updateRecipient = async (req, res) => {
  try {
    const recipient = await WhatsappRecipient.findById(req.params.id);
    if (!recipient) return res.status(404).json({ success: false, message: 'Destinatario no encontrado' });

    if (req.body.nombre !== undefined) recipient.nombre = req.body.nombre.trim();
    if (req.body.telefono !== undefined) recipient.telefono = limpiarTelefono(req.body.telefono);
    if (req.body.apikey !== undefined) recipient.apikey = req.body.apikey.trim();
    if (req.body.activo !== undefined) recipient.activo = !!req.body.activo;

    const actualizado = await recipient.save();
    res.status(200).json({ success: true, message: 'Destinatario actualizado', data: actualizado });
  } catch (error) {
    console.error('❌ Error en updateRecipient:', error);
    res.status(400).json({ success: false, message: 'Error al actualizar el destinatario', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// DELETE - Eliminar destinatario
// ─────────────────────────────────────────────────────────────────
export const deleteRecipient = async (req, res) => {
  try {
    const recipient = await WhatsappRecipient.findByIdAndDelete(req.params.id);
    if (!recipient) return res.status(404).json({ success: false, message: 'Destinatario no encontrado' });
    res.status(200).json({ success: true, message: 'Destinatario eliminado', data: {} });
  } catch (error) {
    console.error('❌ Error en deleteRecipient:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar el destinatario', error: error.message });
  }
};
