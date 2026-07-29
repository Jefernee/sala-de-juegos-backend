// scripts/testAlertaEmail.js
// Prueba manual de las alertas por correo.
//
// USO:
//   node scripts/testAlertaEmail.js
//   node scripts/testAlertaEmail.js "Asunto personalizado"
//
// Necesita RESEND_API_KEY y ALERTAS_EMAIL_TO en el .env. Fuerza el interruptor
// ALERTAS_EMAIL_ENABLED para poder probar aunque las alertas estén apagadas en
// producción, y NO pasa por el enfriamiento: manda el correo siempre.

import dotenv from 'dotenv';
dotenv.config();

// Se fuerza ANTES de importar el módulo, porque la config se lee en tiempo de
// ejecución pero el interruptor se consulta en cada envío.
process.env.ALERTAS_EMAIL_ENABLED = 'true';

const { enviarEmail, configEmail } = await import('../utils/alertasEmail.js');

const asunto = process.argv[2] || '✅ Prueba de alertas — Sala de Juegos';
const cuerpo = [
  'Esto es una prueba del sistema de alertas por correo.',
  '',
  'Si estás leyendo esto, las alertas están bien configuradas: cuando un aviso',
  'de WhatsApp no se pueda entregar, o el backend tenga un error grave, te va a',
  'llegar un correo como este.',
  '',
  `Enviado el ${new Date().toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' })}.`,
].join('\n');

const cfg = configEmail();
console.log('📧 Enviando correo de prueba...');
console.log('   De:    ', cfg.desde);
console.log('   Para:  ', cfg.para || '(¡falta ALERTAS_EMAIL_TO!)');
console.log('   API key:', cfg.apiKey ? `${cfg.apiKey.slice(0, 6)}…` : '(¡falta RESEND_API_KEY!)');

const res = await enviarEmail(asunto, cuerpo);

if (res.ok) {
  console.log('✅ Enviado. Revisá la bandeja (y la carpeta de spam la primera vez).');
  process.exit(0);
}

console.error(`❌ No se pudo enviar: ${res.motivo || 'motivo desconocido'}`);
process.exit(1);
