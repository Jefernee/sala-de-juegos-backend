// scripts/probarCorreoBCR.js
//
// Pruebas de los gastos que se anotan solos desde el correo del BCR.
//
// POR QUÉ EXISTE
// El BCR manda con el MISMO formato una compra, un retiro de cajero y una
// transacción negada: ninguna columna dice "retiro". Si la regla se rompe, el
// mes se llena de gastos que no existieron (cada retiro contaría como gasto, y
// después otra vez cuando se gaste la plata). Las filas de abajo son las de
// correos reales; cualquier cambio a utils/correoBCR.js tiene que seguir
// pasándolas.
//
// El controlador corre de verdad sobre una base falsa en memoria: no toca Mongo.
//
// Corre con `npm run probar-correo-bcr`.

import test from 'node:test';
import assert from 'node:assert/strict';

import MovimientoPersonal from '../models/MovimientoPersonal.js';
import ResumenPersonalMes from '../models/ResumenPersonalMes.js';
import User from '../models/User.js';
import {
  leerTransacciones,
  decidir,
  pareceRetiro,
  categoriaDeComercio,
} from '../utils/correoBCR.js';
import { esCorreoSinpe, leerSinpe, decidirSinpe, descripcionSinpe } from '../utils/correoSinpeBCR.js';
import { recibirCorreoBCR } from '../controllers/gastosCorreoController.js';

console.error = () => {};

// ─── CORREOS ─────────────────────────────────────────────────────────────────

// Misma estructura que el correo real (tabla del logo + tabla de detalle).
const correoBCR = (...filas) => `<!DOCTYPE html><html><body>
<table><tbody><tr><td><img src="cid:vLogo"></td><td><img src="cid:vFranquicia"></td></tr></tbody></table>
<div class="azul">Detalle de Transacciones </div>
<table style="width:100%"><thead><tr>
<th class="azul">Fecha</th><th class="azul">Autorización</th><th class="azul">No.Referencia</th>
<th class="azul">Monto</th><th class="azul">Moneda</th><th class="azul">Comercio</th><th class="azul">Estado</th>
</tr></thead><tbody>
${filas.map((f) => `<tr>${f.map((c) => `<td class="datos">${c}</td>`).join('')}</tr>`).join('\n')}
</tbody></table></body></html>`;

// Filas tomadas de correos reales.
const COMPRA = ['04/10/2026 12:45:12', '00068358', '94710603', '11,900.00', 'COLON COSTA RICA', 'SODA EL BUEN GUSTO HEREDIA CR', 'Aprobada'];
const RETIRO = ['16/09/2026 15:14:01', '00518200', '625921172586', '15,000.00', 'COLON COSTA RICA', 'ICAFE San Pedro Barva Barva CR', 'Aprobada'];
const NEGADA = ['15/09/2026 15:13:51', '00000000', '62725198', '9,400.00', 'COLON COSTA RICA', 'ASSA COMPANIA DE SEGUR SAN JOSE CR', 'Negada'];

const leerUna = (fila) => leerTransacciones(correoBCR(fila))[0];

// ─── LECTURA Y DECISIÓN ──────────────────────────────────────────────────────

test('lee las 7 columnas de la compra', () => {
  const tx = leerUna(COMPRA);
  assert.equal(tx.monto, 11900);
  assert.equal(tx.moneda, 'CRC');
  assert.equal(tx.comercio, 'SODA EL BUEN GUSTO HEREDIA CR');
  assert.equal(tx.referencia, '94710603');
  // 12:45 en Costa Rica (UTC-6) = 18:45 UTC
  assert.equal(tx.fecha.toISOString(), '2026-10-04T18:45:12.000Z');
});

test('ignora la tabla del logo: solo filas de 7 columnas', () => {
  assert.equal(leerTransacciones(correoBCR(COMPRA)).length, 1);
});

test('lee varias transacciones del mismo correo', () => {
  assert.equal(leerTransacciones(correoBCR(COMPRA, NEGADA)).length, 2);
});

test('la compra aprobada se anota', () => {
  assert.deepEqual(decidir(leerUna(COMPRA)), { accion: 'anotar', categoria: 'Comida preparada' });
});

test('el retiro en ICAFE se ignora', () => {
  const d = decidir(leerUna(RETIRO));
  assert.equal(d.accion, 'ignorar');
  assert.equal(d.retiro, true);
});

test('la transacción negada se ignora', () => {
  const d = decidir(leerUna(NEGADA));
  assert.equal(d.accion, 'ignorar');
  assert.match(d.motivo, /Negada/);
});

test('un retiro en otro cajero se reconoce por la referencia de 12 dígitos', () => {
  assert.ok(pareceRetiro({ comercio: 'BCR SUCURSAL HEREDIA CR', referencia: '612345678901' }));
});

test('un retiro se reconoce por la palabra ATM aunque la referencia sea corta', () => {
  assert.ok(pareceRetiro({ comercio: 'ATM BN BARVA', referencia: '12345678' }));
});

test('un retiro en un cajero ATH de otro banco se reconoce', () => {
  assert.ok(pareceRetiro({ comercio: 'ATH BN SANTO DOMINGO CR', referencia: '12345678' }));
});

test('una compra con referencia de 8 dígitos no es retiro', () => {
  assert.equal(pareceRetiro({ comercio: 'WALMART HEREDIA CR', referencia: '94710603' }), null);
});

test('"ATM" dentro de otra palabra no la vuelve retiro', () => {
  assert.equal(pareceRetiro({ comercio: 'BATMAN TOYS', referencia: '94710603' }), null);
});

test('categoría según el comercio', () => {
  assert.equal(categoriaDeComercio('WALMART HEREDIA CR'), 'Supermercado');
  assert.equal(categoriaDeComercio('Super Barva CR'), 'Supermercado');
  assert.equal(categoriaDeComercio('SERVICENTRO LA GLORIA'), 'Combustible');
  assert.equal(categoriaDeComercio('ASSA COMPANIA DE SEGUR SAN JOSE CR'), 'Seguros');
  assert.equal(categoriaDeComercio('NETFLIX.COM'), 'Suscripciones');
  assert.equal(categoriaDeComercio('FERRETERIA EPA'), 'Otros');
});

test('categorías de comercios típicos de Costa Rica', () => {
  const casos = {
    'MAXI PALI SANTO DOMINGO CR': 'Supermercado',
    'SUPERCOMPRO BARVA CR': 'Supermercado',
    'AUTO MERCADO HEREDIA': 'Supermercado',
    'DELTA SAN PABLO CR': 'Combustible',
    'RESTAURANTE EL FOGON': 'Comida preparada',
    'CAFETERIA LA U': 'Comida preparada',
    'POLLO RICO HEREDIA': 'Comida preparada',
    'FARMACIA FISCHEL HEREDIA': 'Salud',
    'SPOTIFY P1234': 'Suscripciones',
    'DIDI RIDES CR': 'Transporte',
    'KOLBI RECARGAS': 'Internet/Celular',
    'ICE PAGO SERVICIOS': 'Internet/Celular',
  };
  for (const [comercio, categoria] of Object.entries(casos)) {
    assert.equal(categoriaDeComercio(comercio), categoria, comercio);
  }
});

test('una palabra metida DENTRO de otra no cambia la categoría', () => {
  assert.equal(categoriaDeComercio('AMAZON WEB SERVICES'), 'Otros'); // "ICE" en SERVICES
  assert.equal(categoriaDeComercio('TUBERIAS DEL VALLE'), 'Otros'); // "UBER" en TUBERIAS
  assert.equal(categoriaDeComercio('MASSAGE CENTER'), 'Otros'); // "ASSA" en MASSAGE
});

test('todas las categorías de las reglas existen en el modelo', async () => {
  const { CATEGORIAS_EGRESO } = await import('../models/MovimientoPersonal.js');
  const { REGLAS_CATEGORIA } = await import('../utils/correoBCR.js');
  for (const { categoria } of REGLAS_CATEGORIA) {
    assert.ok(CATEGORIAS_EGRESO.includes(categoria), categoria);
  }
  assert.ok(CATEGORIAS_EGRESO.includes('Otros'));
});

test('una moneda desconocida no se anota a ciegas', () => {
  const fila = [...COMPRA];
  fila[4] = 'EURO';
  assert.equal(decidir(leerUna(fila)).accion, 'ignorar');
});

// ─── CONTROLADOR (base falsa) ────────────────────────────────────────────────

const CLAVE = 'clave-de-prueba';
const DUENO = { _id: '64b000000000000000000001' };

// Movimientos "guardados" en esta corrida.
let guardados = [];

const lean = (valor) => ({ select: () => ({ lean: async () => valor }), lean: async () => valor });

User.findOne = () => lean(DUENO);
MovimientoPersonal.findOne = (filtro) =>
  lean(guardados.find((m) => m.referenciaBanco === filtro.referenciaBanco) || null);
MovimientoPersonal.create = async (doc) => {
  const mov = { ...doc, _id: `mov${guardados.length + 1}` };
  guardados.push(mov);
  return mov;
};
// El resumen del mes se regenera después de guardar; acá no interesa su contenido.
MovimientoPersonal.aggregate = async () => [];
ResumenPersonalMes.deleteOne = async () => ({});

const llamar = async ({ clave = CLAVE, body }) => {
  const req = { body, get: (h) => (h.toLowerCase() === 'x-clave-correo' ? clave : undefined) };
  const res = {
    statusCode: null,
    cuerpo: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.cuerpo = b; return this; },
  };
  await recibirCorreoBCR(req, res);
  return res;
};

test.beforeEach(() => {
  guardados = [];
  process.env.CORREO_BCR_CLAVE = CLAVE;
  process.env.CORREO_BCR_USUARIO_EMAIL = 'dueno@ejemplo.com';
});

test('sin la clave correcta no anota nada', async () => {
  const res = await llamar({ clave: 'otra', body: { html: correoBCR(COMPRA) } });
  assert.equal(res.statusCode, 401);
  assert.equal(guardados.length, 0);
});

test('sin clave configurada en el servidor no acepta nada', async () => {
  delete process.env.CORREO_BCR_CLAVE;
  const res = await llamar({ body: { html: correoBCR(COMPRA) } });
  assert.equal(res.statusCode, 503);
});

test('la compra se guarda como egreso del mes con su referencia', async () => {
  const res = await llamar({ body: { html: correoBCR(COMPRA) } });
  assert.equal(res.statusCode, 200);
  assert.equal(guardados.length, 1);
  const [mov] = guardados;
  assert.equal(mov.tipo, 'egreso');
  assert.equal(mov.fondo, 'mes');
  assert.equal(mov.monto, 11900);
  assert.equal(mov.categoria, 'Comida preparada');
  assert.equal(mov.origen, 'correo_bcr');
  assert.equal(mov.referenciaBanco, '00068358-94710603');
  assert.equal(res.cuerpo.resultados[0].accion, 'anotado');
});

test('el mismo correo dos veces se anota una sola vez', async () => {
  await llamar({ body: { html: correoBCR(COMPRA) } });
  const res = await llamar({ body: { html: correoBCR(COMPRA) } });
  assert.equal(guardados.length, 1);
  assert.equal(res.cuerpo.resultados[0].accion, 'repetido');
});

test('el retiro y la negada no se guardan', async () => {
  const res = await llamar({ body: { html: correoBCR(RETIRO, NEGADA) } });
  assert.equal(guardados.length, 0);
  assert.deepEqual(res.cuerpo.resultados.map((r) => r.accion), ['ignorado', 'ignorado']);
  assert.equal(res.cuerpo.resultados[0].retiro, true);
});

test('en modo prueba dice qué haría pero no guarda', async () => {
  const res = await llamar({ body: { html: correoBCR(COMPRA), prueba: true } });
  assert.equal(guardados.length, 0);
  assert.equal(res.cuerpo.resultados[0].accion, 'anotaria');
});

// ─── SINPE MÓVIL ─────────────────────────────────────────────────────────────

// Estructura del aviso real ("Etiqueta: valor" en párrafos). Las tildes van
// como entidades HTML a propósito: así las suele mandar el BCR.
const correoSinpe = ({ verbo = 'debitado', monto = '5,000.00', motivo = 'Transferencia SINPE', hora = '8:36 PM' } = {}) => `<html><body>
<div class="azul">Transacci&oacute;n SINPE M&Oacute;VIL</div>
<p><b>Estimado (a):</b> RUIZ GARCIA JEFERNEE PATRICIO</p>
<p>Le informamos que se ha ${verbo} de su cuenta BCR la siguiente transacci&oacute;n SINPE M&oacute;vil:</p>
<p><b>N&uacute;mero de referencia:</b> 2026100215283000606194522</p>
<p><b>Tel&eacute;fono Destino:</b> 88301616</p>
<p><b>Nombre cliente Destino:</b> alberto avila hernandez</p>
<p><b>Entidad Destino:</b> Banco BAC San Jos&eacute;</p>
<p><b>Monto:</b> ${monto}</p>
<p><b>Motivo:</b> ${motivo}</p>
<p>Esta transacci&oacute;n fue realizada el 02/10/2026 a las ${hora}</p>
</body></html>`;

test('SINPE: se reconoce y no se confunde con el aviso de la tarjeta', () => {
  assert.equal(esCorreoSinpe(correoSinpe()), true);
  assert.equal(esCorreoSinpe(correoBCR(COMPRA)), false);
});

test('SINPE: lee monto, destinatario, referencia y fecha', () => {
  const s = leerSinpe(correoSinpe());
  assert.equal(s.monto, 5000);
  assert.equal(s.referencia, '2026100215283000606194522');
  assert.equal(s.destinatario, 'alberto avila hernandez');
  assert.equal(s.entidad, 'Banco BAC San José');
  // 8:36 PM en Costa Rica (UTC-6) = 02:36 UTC del día siguiente
  assert.equal(s.fecha.toISOString(), '2026-10-03T02:36:00.000Z');
});

test('SINPE: también si etiqueta y valor vienen en celdas separadas', () => {
  const enTabla = `<table><tbody>
<tr><td>Le informamos que se ha debitado de su cuenta BCR la siguiente transacci&oacute;n SINPE M&oacute;vil:</td></tr>
<tr><td>N&uacute;mero de referencia:</td><td>2026100215283000606194522</td></tr>
<tr><td>Nombre cliente Destino:</td><td>alberto avila hernandez</td></tr>
<tr><td>Monto:</td><td>5,000.00</td></tr>
<tr><td>Esta transacci&oacute;n fue realizada el 02/10/2026 a las 8:36 PM</td></tr>
</tbody></table>`;
  const s = leerSinpe(enTabla);
  assert.equal(s.monto, 5000);
  assert.equal(s.referencia, '2026100215283000606194522');
  assert.equal(s.destinatario, 'alberto avila hernandez');
  assert.equal(decidirSinpe(s).accion, 'anotar');
});

test('SINPE: 12 AM y 12 PM se leen bien', () => {
  assert.equal(leerSinpe(correoSinpe({ hora: '12:05 AM' })).fecha.toISOString(), '2026-10-02T06:05:00.000Z');
  assert.equal(leerSinpe(correoSinpe({ hora: '12:05 PM' })).fecha.toISOString(), '2026-10-02T18:05:00.000Z');
});

test('SINPE enviado (debitado) se anota en Otros con a quién se mandó', () => {
  const s = leerSinpe(correoSinpe());
  assert.deepEqual(decidirSinpe(s), { accion: 'anotar', categoria: 'Otros' });
  assert.equal(descripcionSinpe(s), 'SINPE a Alberto Avila Hernandez');
});

test('SINPE: si el motivo dice algo, va en la descripción', () => {
  assert.equal(
    descripcionSinpe(leerSinpe(correoSinpe({ motivo: 'Almuerzo' }))),
    'SINPE a Alberto Avila Hernandez · Almuerzo'
  );
});

test('SINPE recibido (acreditado) no se anota', () => {
  assert.equal(decidirSinpe(leerSinpe(correoSinpe({ verbo: 'acreditado' }))).accion, 'ignorar');
});

test('SINPE: el controlador lo guarda como egreso en colones con su referencia', async () => {
  const res = await llamar({ body: { html: correoSinpe() } });
  assert.equal(res.statusCode, 200);
  assert.equal(guardados.length, 1);
  const [mov] = guardados;
  assert.equal(mov.tipo, 'egreso');
  assert.equal(mov.monto, 5000);
  assert.equal(mov.moneda, 'CRC');
  assert.equal(mov.categoria, 'Otros');
  assert.equal(mov.descripcion, 'SINPE a Alberto Avila Hernandez');
  assert.equal(mov.referenciaBanco, 'SINPE-2026100215283000606194522');
  assert.equal(mov.origen, 'correo_bcr');
});

test('SINPE: el mismo correo dos veces se anota una sola vez', async () => {
  await llamar({ body: { html: correoSinpe() } });
  const res = await llamar({ body: { html: correoSinpe() } });
  assert.equal(guardados.length, 1);
  assert.equal(res.cuerpo.resultados[0].accion, 'repetido');
});

test('SINPE recibido: el controlador no guarda nada', async () => {
  const res = await llamar({ body: { html: correoSinpe({ verbo: 'acreditado' }) } });
  assert.equal(guardados.length, 0);
  assert.equal(res.cuerpo.resultados[0].accion, 'ignorado');
});

test('un correo que no es del BCR responde 422', async () => {
  const res = await llamar({ body: { html: '<p>hola</p>' } });
  assert.equal(res.statusCode, 422);
});
