// scripts/testNotificacionWhatsApp.js
// Hecho por Claude Code — Prueba manual de la integración de WhatsApp (CallMeBot).
//
// Manda UN mensaje de prueba a TODOS los destinatarios configurados, para
// verificar que las variables de entorno y las apikeys funcionan ANTES de
// conectarlo al evento real. Muestra en consola el resultado de cada número.
//
// Uso:
//   node scripts/testNotificacionWhatsApp.js
//   node scripts/testNotificacionWhatsApp.js "Mensaje personalizado de prueba"
//
// Requiere en el .env:
//   CALLMEBOT_RECIPIENTS   → lista "numero:apikey" separada por comas.
// Nota: este script IGNORA NOTIFICACIONES_WHATSAPP_ENABLED a propósito (fuerza el
// envío) para que puedas probar aunque las notificaciones estén apagadas en prod.

import dotenv from 'dotenv';
import { formatearHoraCR, parseDestinatarios } from '../utils/notificacionesWhatsApp.js';

dotenv.config();

// Forzamos el envío para la prueba, sin importar el flag de producción.
process.env.NOTIFICACIONES_WHATSAPP_ENABLED = 'true';

const run = async () => {
  const destinatarios = parseDestinatarios();

  if (destinatarios.length === 0) {
    console.error('❌ CALLMEBOT_RECIPIENTS está vacío o mal formado en el .env');
    console.error('   Formato esperado: numero:apikey,numero:apikey');
    console.error('   Ejemplo: +50688881234:111111,+50677775678:222222');
    console.error('   Copiá .env.example a .env y completá esa variable.');
    process.exit(1);
  }

  // Import dinámico DESPUÉS de forzar el flag, para que el módulo lo lea activado.
  const { enviarNotificacion } = await import('../utils/notificacionesWhatsApp.js');

  const personalizado = process.argv.slice(2).join(' ').trim();
  const mensaje = personalizado ||
    `🧪 Prueba de notificaciones — Sala de Juegos | ${formatearHoraCR(new Date())}`;

  console.log(`📤 Enviando mensaje de prueba a ${destinatarios.length} destinatario(s), en serie...`);
  console.log(`   Texto: "${mensaje}"`);
  console.log(`   Números: ${destinatarios.map((d) => d.phone).join(', ')}`);
  console.log('');

  const resultados = await enviarNotificacion(mensaje);

  console.log('');
  console.log('─── Resultado por destinatario ───');
  for (const r of resultados) {
    console.log(`   ${r.ok ? '✅' : '❌'} ${r.phone} ${r.ok ? 'OK' : 'FALLÓ'}`);
  }

  const exitosos = resultados.filter((r) => r.ok).length;
  console.log('');
  console.log(`📊 Total: ${exitosos}/${resultados.length} enviado(s) correctamente.`);

  if (exitosos === 0) {
    console.error('❌ No llegó a nadie. Revisá que cada número tenga SU apikey correcta,');
    console.error('   que cada persona haya activado CallMeBot en su WhatsApp, y los logs de arriba.');
    process.exit(1);
  } else if (exitosos < resultados.length) {
    console.warn('⚠️ Llegó a algunos pero no a todos. Revisá los que fallaron arriba.');
    process.exit(0);
  } else {
    console.log('✅ Llegó a todos. Revisá los WhatsApp para confirmar.');
    process.exit(0);
  }
};

run().catch((err) => {
  console.error('❌ Error inesperado en la prueba:', err);
  process.exit(1);
});
