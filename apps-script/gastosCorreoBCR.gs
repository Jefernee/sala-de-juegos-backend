/**
 * Gastos automáticos desde el correo del BCR — Google Apps Script.
 *
 * Corre en el Gmail donde llegan los avisos del BCR (jefernee50@gmail.com).
 * Cada 5 minutos busca los avisos nuevos del BCR —"Notificación de
 * Transacciones BCR" (tarjeta) y "SINPEMOVIL - Notificación de transacción
 * realizada"— y se los pasa al backend (POST /api/gastos-correo/bcr), que
 * decide si es un gasto (lo anota) o un retiro / una negada / un SINPE
 * recibido (lo ignora).
 *
 * NO guarda la clave en el código: va en Configuración del proyecto →
 * Propiedades del script → CORREO_BCR_CLAVE.
 *
 * Instalación: correr `instalar` una vez (pide permisos). Desde ese momento
 * solo se procesan los correos que lleguen DESPUÉS: los gastos viejos ya están
 * anotados a mano y no se tienen que duplicar.
 *
 * Etiquetas en Gmail (para ver qué decidió con cada correo):
 *   Finanzas/Anotado  → se anotó como gasto.
 *   Finanzas/Retiro   → se tomó como retiro de efectivo y NO se anotó.
 *   Finanzas/Error    → el backend no lo pudo procesar; se reintenta solo.
 * Gmail junta en una conversación los correos con el mismo asunto, así que la
 * etiqueta queda en la conversación: puede tener más de una.
 */

const URL_BACKEND = 'https://chosen-sandra-jefernee-f13f70d9.koyeb.app/api/gastos-correo/bcr';
// Tarjeta: bcrtarjestcta@. SINPE Móvil: mensajero@ (que manda también otros
// avisos; los que no son SINPE el backend los responde con 422 y se saltan).
const BUSQUEDA = '{from:bcrtarjestcta@bancobcr.com from:mensajero@bancobcr.com} newer_than:3d';
const ETIQUETAS = { anotado: 'Finanzas/Anotado', retiro: 'Finanzas/Retiro', error: 'Finanzas/Error' };
// Ids de correos ya procesados que se recuerdan (los de 3 días caben de sobra).
const MAX_RECORDADOS = 300;

/** Correr UNA vez: marca desde cuándo procesar y programa la revisión cada 5 min. */
function instalar() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CORREO_BCR_CLAVE')) {
    throw new Error('Falta CORREO_BCR_CLAVE en Propiedades del script.');
  }
  props.setProperty('DESDE', String(Date.now()));
  props.setProperty('PROCESADOS', '[]');

  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'revisarCorreosBCR')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('revisarCorreosBCR').timeBased().everyMinutes(5).create();

  Object.values(ETIQUETAS).forEach(etiqueta);
  console.log('Instalado. Se procesan los correos que lleguen desde ahora.');
}

/** La corre el disparador cada 5 minutos. */
function revisarCorreosBCR() {
  // Si una corrida tarda, que la siguiente no procese lo mismo en paralelo.
  const candado = LockService.getScriptLock();
  if (!candado.tryLock(1000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const clave = props.getProperty('CORREO_BCR_CLAVE');
    const desde = Number(props.getProperty('DESDE') || Date.now());
    const procesados = JSON.parse(props.getProperty('PROCESADOS') || '[]');

    for (const hilo of GmailApp.search(BUSQUEDA)) {
      for (const correo of hilo.getMessages()) {
        if (correo.getDate().getTime() < desde) continue;
        if (procesados.includes(correo.getId())) continue;

        const resultado = enviar(correo, clave);
        if (!resultado) {
          hilo.addLabel(etiqueta(ETIQUETAS.error));
          continue; // no se marca: se reintenta en la próxima corrida
        }
        for (const r of resultado.resultados || []) {
          if (r.accion === 'anotado' || r.accion === 'repetido') hilo.addLabel(etiqueta(ETIQUETAS.anotado));
          if (r.retiro) hilo.addLabel(etiqueta(ETIQUETAS.retiro));
          console.log(`${r.accion}: ${r.comercio} ${r.monto} ${r.motivo || r.categoria || ''}`);
        }
        hilo.removeLabel(etiqueta(ETIQUETAS.error));
        procesados.push(correo.getId());
      }
    }

    props.setProperty('PROCESADOS', JSON.stringify(procesados.slice(-MAX_RECORDADOS)));
  } finally {
    candado.releaseLock();
  }
}

// Devuelve la respuesta del backend, o null si hay que reintentar.
function enviar(correo, clave) {
  try {
    const resp = UrlFetchApp.fetch(URL_BACKEND, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-clave-correo': clave },
      payload: JSON.stringify({ html: correo.getBody() }),
      muteHttpExceptions: true,
    });
    const codigo = resp.getResponseCode();
    // 422: el correo no trae transacciones (otro tipo de aviso del BCR). No es
    // un error que se arregle reintentando.
    if (codigo === 422) return { resultados: [] };
    if (codigo !== 200) {
      console.error(`Backend respondió ${codigo}: ${resp.getContentText()}`);
      return null;
    }
    return JSON.parse(resp.getContentText());
  } catch (e) {
    // Koyeb dormido o sin red: se reintenta en 5 minutos.
    console.error(`No se pudo llamar al backend: ${e}`);
    return null;
  }
}

function etiqueta(nombre) {
  return GmailApp.getUserLabelByName(nombre) || GmailApp.createLabel(nombre);
}
