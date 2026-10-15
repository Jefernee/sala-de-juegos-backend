// scripts/probarTurnoPendiente.js
//
// Pruebas del turno de tiempo pendiente y del fin lineal al agregar tiempo.
// Corre con `npm run probar-turno` (o `node scripts/probarTurnoPendiente.js`).
// No necesita base de datos ni servidor: prueba la aritmética pura, que es
// donde vivían las decisiones difíciles.
//
// Se usa node:test, que viene con Node — el repo no tiene framework de pruebas
// y no hacía falta agregar una dependencia para esto.

import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import {
  calcularFinTurno,
  minutosJugados,
  pendienteTrasCerrar,
  turnoVencido,
  validarInicioTurno,
  resolverFinTrasEditar,
  guardarPendienteCancelaAviso,
} from '../utils/turnoPendiente.js';

const MIN = 60 * 1000;
const enMinutos = (base, m) => new Date(base.getTime() + m * MIN);

// ─── El caso completo del que salió el diseño ────────────────────────────────
// Un chico con 45 min pendientes. Es el ejemplo con el que se acordó la regla:
// el pendiente NO baja al arrancar, baja al cerrar y con lo que se jugó.

test('caso A: el turno llega al final y descuenta todo', () => {
  const inicio = new Date('2026-09-14T16:10:00Z');
  const turno = { minutos: 45, inicio, fin: calcularFinTurno(inicio, 45) };

  assert.equal(turno.fin.toISOString(), '2026-09-14T16:55:00.000Z', 'el fin es inicio + 45');

  // A las 4:55 el turno venció y nadie lo detuvo.
  assert.equal(turnoVencido(turno, turno.fin), true);
  assert.equal(minutosJugados(turno, turno.fin), 45);
  assert.equal(pendienteTrasCerrar(45, 45), 0, 'el pendiente queda en 0');
});

test('caso B: se detiene a la mitad y devuelve lo que no se jugó', () => {
  const inicio = new Date('2026-09-14T16:10:00Z');
  const turno = { minutos: 45, inicio, fin: calcularFinTurno(inicio, 45) };

  // El chico se va a las 4:30 y el encargado toca detener en el momento.
  const usados = minutosJugados(turno, enMinutos(inicio, 20));
  assert.equal(usados, 20);
  assert.equal(pendienteTrasCerrar(45, usados), 25, 'quedan 25 min pendientes');
});

test('el encargado puede corregir si tocó detener tarde', () => {
  const inicio = new Date('2026-09-14T16:10:00Z');
  const turno = { minutos: 45, inicio, fin: calcularFinTurno(inicio, 45) };

  // Se fue a las 4:30 pero el botón se tocó a las 4:40: el reloj dice 30.
  assert.equal(minutosJugados(turno, enMinutos(inicio, 30)), 30);
  // Corrigiendo a 20, el pendiente refleja lo que de verdad jugó.
  assert.equal(pendienteTrasCerrar(45, 20), 25);
});

// ─── Los bordes que pueden romper la cuenta ──────────────────────────────────

test('detener pasado el fin nunca descuenta más de lo que se puso a correr', () => {
  const inicio = new Date('2026-09-14T16:10:00Z');
  const turno = { minutos: 45, inicio, fin: calcularFinTurno(inicio, 45) };

  // Dos horas después el reloj daría 120, pero el cliente solo puso 45 en juego.
  assert.equal(minutosJugados(turno, enMinutos(inicio, 120)), 45);
  assert.equal(pendienteTrasCerrar(45, minutosJugados(turno, enMinutos(inicio, 120))), 0);
});

test('un reloj corrido hacia atrás no regala tiempo', () => {
  const inicio = new Date('2026-09-14T16:10:00Z');
  const turno = { minutos: 45, inicio, fin: calcularFinTurno(inicio, 45) };
  assert.equal(minutosJugados(turno, enMinutos(inicio, -10)), 0, 'nunca negativo');
});

test('el pendiente nunca queda negativo', () => {
  assert.equal(pendienteTrasCerrar(10, 45), 0);
  assert.equal(pendienteTrasCerrar(undefined, 45), 0);
});

test('turnoVencido solo es cierto cuando el fin ya pasó', () => {
  const inicio = new Date('2026-09-14T16:10:00Z');
  const turno = { minutos: 45, inicio, fin: calcularFinTurno(inicio, 45) };
  assert.equal(turnoVencido(turno, enMinutos(inicio, 44)), false);
  assert.equal(turnoVencido(turno, enMinutos(inicio, 45)), true, 'justo en el fin, vencido');
  assert.equal(turnoVencido(null, new Date()), false, 'sin turno no hay nada que cerrar');
});

// ─── Quién puede arrancar un turno ───────────────────────────────────────────

test('no se arranca un segundo turno sobre uno que ya corre', () => {
  const play = { tiempoPendiente: 45, pendienteEnCurso: { minutos: 20, inicio: new Date() } };
  assert.match(validarInicioTurno(play, 10), /ya tiene un tiempo pendiente corriendo/);
});

test('no se arranca sin tiempo pendiente, ni por más del que queda', () => {
  assert.match(validarInicioTurno({ tiempoPendiente: 0 }, 10), /no tiene tiempo pendiente/);
  assert.match(validarInicioTurno({ tiempoPendiente: 30 }, 45), /Solo quedan 30 minutos/);
});

test('no se arranca con minutos inválidos', () => {
  for (const malo of [0, -5, NaN, 'hola', undefined]) {
    assert.ok(validarInicioTurno({ tiempoPendiente: 45 }, malo), `debería rechazar ${String(malo)}`);
  }
});

test('arrancar con todo el pendiente es válido (el caso normal)', () => {
  assert.equal(validarInicioTurno({ tiempoPendiente: 45, pendienteEnCurso: null }, 45), null);
});

// ─── Agregar tiempo: el fin es LINEAL ────────────────────────────────────────
// El tiempo agregado se pega al final del anterior (horaInicio + tiempoPagado),
// no a la hora en que se digitó. Antes se anclaba al reloj y regalaba minutos.

test('caso Nando: agregar tarde NO corre el aviso a las 10:39 PM', () => {
  // Inicio 4:05 PM con 2 h. A las 8:39 PM le agregan 2 h más (total 4 h).
  // Hora CR = UTC-6.
  const ahora = new Date('2026-10-14T02:39:00Z');        // 8:39 PM
  const finCalculado = new Date('2026-10-14T02:05:00Z'); // 4:05 + 4 h = 8:05 PM

  const r = resolverFinTrasEditar({ finCalculado, ahora });

  assert.equal(r.fin.toISOString(), '2026-10-14T02:05:00.000Z', 'el fin es 8:05 PM, no 10:39 PM');
  assert.equal(r.reArmaAviso, false, 'esas 2 h ya se jugaron: no hay aviso que mandar');
  assert.equal(r.cancelaAviso, true);
});

test('agregar un poco tarde: el fin no regala los minutos de atraso', () => {
  // Arrancó 3:00 con 1 h (venció 4:00). A las 4:20 le agregan otra hora.
  const ahora = new Date('2026-09-14T16:20:00Z');
  const finCalculado = new Date('2026-09-14T17:00:00Z'); // 3:00 + 2 h

  const r = resolverFinTrasEditar({ finCalculado, ahora });

  assert.equal(r.fin.toISOString(), '2026-09-14T17:00:00.000Z', 'termina 5:00, no 5:20');
  assert.equal(r.reArmaAviso, true, 'el fin está en el futuro: avisa a las 5:00');
});

test('extensión normal: si el fin nuevo ya cae en el futuro, no se toca nada', () => {
  // Arrancó 3:00 con 30 min. A las 3:10, todavía jugando, paga 30 más.
  const ahora = new Date('2026-09-14T15:10:00Z');
  const finCalculado = new Date('2026-09-14T16:00:00Z'); // 3:00 + 60

  const r = resolverFinTrasEditar({ finCalculado, ahora });

  assert.equal(r.fin.toISOString(), finCalculado.toISOString(), 'se respeta horaInicio + tiempoPagado');
  assert.equal(r.reArmaAviso, true);
});

test('corregir hacia ABAJO una sesión vieja no re-arma el aviso', () => {
  // Editar ayer un play para bajarle el tiempo no puede mandar un WhatsApp.
  const ahora = new Date('2026-09-14T16:10:00Z');
  const finCalculado = new Date('2026-09-13T15:00:00Z');

  const r = resolverFinTrasEditar({ finCalculado, ahora });

  assert.equal(r.reArmaAviso, false, 'no se avisa de algo que terminó ayer');
});

// ─── Guardar tiempo pendiente NO puede disparar el aviso ─────────────────────
// El cliente se va antes: se le baja el tiempo pagado y el resto queda como
// pendiente. El fin nuevo cae en el pasado y no hay partida que anunciar — pero
// el aviso seguía pendiente y la ventana de catch-up lo mandaba igual, un rato
// después de que el chico ya se había ido.

test('cortar la sesión para guardar tiempo pendiente cancela el aviso', () => {
  // Arrancó 3:00 con 2h (fin 5:00). A las 4:00 se va y se le guarda 1h.
  const ahora = new Date('2026-09-14T16:00:00Z');
  const finCalculado = new Date('2026-09-14T16:00:00Z');  // 3:00 + 60 = 4:00, ya pasó

  const r = resolverFinTrasEditar({ finCalculado, ahora });

  assert.equal(r.reArmaAviso, false, 'no se arma un aviso nuevo');
  assert.equal(r.cancelaAviso, true, 'y el que estaba pendiente se cancela');
});

test('una sesión que SÍ está corriendo con tiempo pendiente guardado igual avisa', () => {
  // El caso que no hay que romper: el chico paga 2h, juega 1h ahora y guarda 1h
  // para después. Esa hora que está jugando termina y la consola queda libre:
  // el aviso tiene que salir aunque haya tiempo pendiente guardado.
  const ahora = new Date('2026-09-14T15:10:00Z');
  const finCalculado = new Date('2026-09-14T16:00:00Z'); // en el futuro

  const r = resolverFinTrasEditar({ finCalculado, ahora });

  assert.equal(r.reArmaAviso, true, 'tener pendiente guardado no calla el aviso');
  assert.equal(r.cancelaAviso, false);
});

// ─── Mongoose escribe la bandera cuando se fuerza ────────────────────────────
// Asignarle `false` a un campo que ya venía en `false` NO se manda a Mongo, y
// eso hacía que un reclamo de un despachador sobreviviera a la edición y el fin
// nuevo se quedara sin aviso. El arreglo usa markModified.

test('markModified fuerza la escritura de notificacionFinEnviada', () => {
  const schema = new mongoose.Schema({ notificacionFinEnviada: Boolean });
  const M = mongoose.models.PruebaPlay || mongoose.model('PruebaPlay', schema);

  const sinForzar = M.hydrate({ _id: new mongoose.Types.ObjectId(), notificacionFinEnviada: false });
  sinForzar.notificacionFinEnviada = false;
  assert.deepEqual(sinForzar.getChanges(), {}, 'sin forzar no se manda nada a Mongo');

  const forzado = M.hydrate({ _id: new mongoose.Types.ObjectId(), notificacionFinEnviada: false });
  forzado.notificacionFinEnviada = false;
  forzado.markModified('notificacionFinEnviada');
  assert.deepEqual(
    forzado.getChanges(),
    { $set: { notificacionFinEnviada: false } },
    'forzado sí se escribe y le gana a un reclamo intermedio',
  );
});

// ─── El modelo acepta el turno ───────────────────────────────────────────────

test('el play valida un turno bien formado y rechaza uno sin minutos', async () => {
  const { default: Play } = await import('../models/plays.js');

  const base = {
    cliente: 'Prueba', atendio: 'Jefernee', tiempoPagado: 60, tiempoPendiente: 45,
    horaInicio: '15:00', horaFinal: '16:00', lugarDeJuego: 'Play 5 número 1',
    tipoPlay: 'Play 5', totalControles: 2, estadoPago: 'Completado',
  };
  const inicio = new Date();

  const bueno = new Play({ ...base, pendienteEnCurso: { minutos: 45, inicio, fin: calcularFinTurno(inicio, 45) } });
  assert.equal(bueno.validateSync(), undefined, 'un turno completo es válido');

  const malo = new Play({ ...base, pendienteEnCurso: { inicio, fin: calcularFinTurno(inicio, 45) } });
  assert.ok(malo.validateSync(), 'un turno sin minutos no pasa');

  const sinTurno = new Play({ ...base, pendienteEnCurso: null });
  assert.equal(sinTurno.validateSync(), undefined, 'null es válido: no hay turno');
});

// ─── El mensaje de WhatsApp distingue el turno de la sesión original ─────────
// Sin distinguirlo diría la duración de la sesión vieja (que no es la que acaba
// de correr) y seguiría listando como pendientes los minutos recién agotados.

test('el aviso de un turno habla del turno, no de la sesión original', async () => {
  const { construirMensajeFinSesion } = await import('../utils/notificacionesWhatsApp.js');

  const inicio = new Date('2026-09-14T22:10:00Z'); // 4:10 PM en CR
  const play = {
    lugarDeJuego: 'Play 5 número 1', cliente: 'Dylan', atendio: 'Jefernee',
    horaInicio: '13:00', tiempoPagado: 120, tiempoPendiente: 45,
    totalControles: 2, total: 2000, estadoPago: 'Completado',
    pendienteEnCurso: { minutos: 30, inicio, fin: calcularFinTurno(inicio, 30) },
  };

  const msg = construirMensajeFinSesion(play, play.pendienteEnCurso.fin);

  assert.match(msg, /Terminó el tiempo pendiente/, 'el título dice qué terminó');
  assert.match(msg, /Tiempo pendiente jugado: 30min/);
  assert.match(msg, /Le queda pendiente: 15min/, '45 − 30, no los 45 enteros');
  assert.doesNotMatch(msg, /Duración: 2h/, 'la sesión original no es lo que terminó');
  assert.match(msg, /Consola: Play 5 número 1/, 'lo accionable sigue estando');
});

test('sin turno, el aviso de siempre no cambia', async () => {
  const { construirMensajeFinSesion } = await import('../utils/notificacionesWhatsApp.js');

  const play = {
    lugarDeJuego: 'Play 4 número 2', cliente: 'Dylan', atendio: 'Minor',
    horaInicio: '13:00', tiempoPagado: 120, tiempoPendiente: 45,
    totalControles: 2, total: 2000, estadoPago: 'Completado',
    pendienteEnCurso: null,
  };

  const msg = construirMensajeFinSesion(play, new Date('2026-09-14T21:00:00Z'));

  assert.match(msg, /Terminó la partida/);
  assert.match(msg, /Duración: 2h/);
  assert.match(msg, /Tiempo pendiente: 45min/);
  assert.doesNotMatch(msg, /jugado/);
});

// ─── Anotar tiempo pendiente cancela el aviso ────────────────────────────────
// El caso que de verdad pasa en el local, y el que se me habia escapado: NO se
// baja el tiempo pagado (es el que calcula la plata de la venta), solo se anota
// el pendiente. Como cambioTiempo solo mira tiempoPagado/horaInicio/horaFinal,
// ninguno cambia y el aviso seguia programado para la hora original.

test('anotar tiempo pendiente en una sesión que no avisó cancela el aviso', () => {
  assert.equal(guardarPendienteCancelaAviso(0, 60), true, 'aparecio pendiente');
  assert.equal(guardarPendienteCancelaAviso(30, 60), true, 'crecio el pendiente');
});

test('un pendiente que ya estaba y no cambió NO calla el aviso', () => {
  // El caso que no hay que romper: pago 2h, juega 1h ahora y guarda 1h para
  // despues. Al editar cualquier otra cosa el pendiente sigue igual, y la hora
  // que esta jugando tiene que avisar cuando termine.
  assert.equal(guardarPendienteCancelaAviso(60, 60), false);
});

test('devolver tiempo pendiente tampoco calla el aviso', () => {
  // Si BAJA es porque se lo jugo o se corrigio: nada que cancelar.
  assert.equal(guardarPendienteCancelaAviso(60, 0), false);
  assert.equal(guardarPendienteCancelaAviso(60, 30), false);
});

test('valores raros no cancelan nada por accidente', () => {
  assert.equal(guardarPendienteCancelaAviso(undefined, undefined), false);
  assert.equal(guardarPendienteCancelaAviso(null, 0), false);
});
