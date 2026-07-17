// scripts/testNotificacionWhatsApp.js
// Prueba manual de la integración de WhatsApp (WAHA).
//
// Manda UN mensaje de prueba al GRUPO configurado (WAHA_CHAT_ID) para verificar
// que la conexión con WAHA funciona. Muestra el resultado en consola.
//
// Uso:
//   node scripts/testNotificacionWhatsApp.js
//   node scripts/testNotificacionWhatsApp.js "Mensaje personalizado de prueba"
//
// Requiere en el .env: WAHA_URL, WAHA_API_KEY, WAHA_SESSION, WAHA_CHAT_ID.
// Nota: fuerza el envío ignorando NOTIFICACIONES_WHATSAPP_ENABLED, para que
// puedas probar aunque las notificaciones estén apagadas en prod.

import dotenv from 'dotenv';
import { formatearHoraCR, configWaha } from '../utils/notificacionesWhatsApp.js';

dotenv.config();

// Forzamos el envío para la prueba, sin importar el flag de producción.
process.env.NOTIFICACIONES_WHATSAPP_ENABLED = 'true';

const run = async () => {
  const cfg = configWaha();
  if (!cfg.url || !cfg.apiKey || !cfg.chatId) {
    console.error('❌ Falta configuración de WAHA en el .env.');
    console.error('   Necesitás WAHA_URL, WAHA_API_KEY y WAHA_CHAT_ID (y opcional WAHA_SESSION).');
    process.exit(1);
  }

  // Import dinámico DESPUÉS de forzar el flag, para que el módulo lo lea activado.
  const { enviarNotificacion } = await import('../utils/notificacionesWhatsApp.js');

  const personalizado = process.argv.slice(2).join(' ').trim();
  const mensaje = personalizado ||
    `🧪 Prueba de notificaciones — Sala de Juegos | ${formatearHoraCR(new Date())}`;

  console.log(`📤 Enviando mensaje de prueba al grupo ${cfg.chatId} vía WAHA (${cfg.url})...`);
  console.log(`   Texto: "${mensaje}"`);
  console.log('');

  const resultado = await enviarNotificacion(mensaje);

  console.log('');
  if (resultado.ok) {
    console.log('✅ Enviado. Revisá el grupo de WhatsApp para confirmar que llegó.');
    process.exit(0);
  } else {
    console.error('❌ No se pudo enviar. Revisá los logs de arriba:');
    console.error('   - ¿WAHA_URL/WAHA_API_KEY correctos y la VM encendida?');
    console.error('   - ¿La sesión de WhatsApp en WAHA está en estado WORKING?');
    console.error('   - ¿WAHA_CHAT_ID es el ID correcto del grupo ("...@g.us")?');
    process.exit(1);
  }
};

run().catch((err) => {
  console.error('❌ Error inesperado en la prueba:', err);
  process.exit(1);
});
