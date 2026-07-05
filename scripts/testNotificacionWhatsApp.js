// scripts/testNotificacionWhatsApp.js
// Hecho por Claude Code — Prueba manual de la integración de WhatsApp (CallMeBot).
//
// Manda UN mensaje de prueba a TODOS los destinatarios ACTIVOS de la base de
// datos, para verificar que las apikeys funcionan. Muestra el resultado de cada
// número en consola.
//
// Uso:
//   node scripts/testNotificacionWhatsApp.js
//   node scripts/testNotificacionWhatsApp.js "Mensaje personalizado de prueba"
//
// Requiere en el .env: MONGO_URI (y destinatarios cargados en la base).
// Nota: fuerza el envío ignorando NOTIFICACIONES_WHATSAPP_ENABLED, para que
// puedas probar aunque las notificaciones estén apagadas en prod.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { formatearHoraCR, obtenerDestinatarios } from '../utils/notificacionesWhatsApp.js';

dotenv.config();

// Forzamos el envío para la prueba, sin importar el flag de producción.
process.env.NOTIFICACIONES_WHATSAPP_ENABLED = 'true';

const run = async () => {
  if (!process.env.MONGO_URI) {
    console.error('❌ Falta MONGO_URI en el archivo .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ Conectado a MongoDB');

  const destinatarios = await obtenerDestinatarios();

  if (destinatarios.length === 0) {
    console.error('❌ No hay destinatarios activos en la base (ni respaldo en CALLMEBOT_RECIPIENTS).');
    console.error('   Agregá al menos uno desde el frontend, o cargá CALLMEBOT_RECIPIENTS en el .env.');
    await mongoose.disconnect();
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

  await mongoose.disconnect();

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
