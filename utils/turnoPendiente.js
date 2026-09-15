// utils/turnoPendiente.js
// La aritmética del turno de tiempo pendiente, sin base de datos ni Express.
//
// El tiempo pendiente es tiempo YA PAGADO que el cliente no usó. Un "turno" es
// ponerlo a correr: no cobra nada y no crea una sesión nueva (ver el comentario
// de `pendienteEnCurso` en models/plays.js).
//
// LA REGLA QUE ORDENA TODO: el pendiente NO baja al arrancar el turno, baja al
// CERRARLO, y con lo que realmente se jugó. Así el encargado nunca tiene que
// calcular cuánto devolver: contesta la pregunta fácil (cuánto jugó, que lo
// vio) y el sistema hace la resta.
//
// Está aparte del controlador para poder probarlo: ver scripts/probarTurnoPendiente.js

/** Minutos → milisegundos. */
const MIN_MS = 60 * 1000;

/**
 * Fin del turno = inicio + minutos, con los segundos ya en cero por venir de
 * un instante redondeado. Es el valor que se copia a `finProgramado` para que
 * los despachadores de WhatsApp manden el aviso sin saber que esto existe.
 */
export const calcularFinTurno = (inicio, minutos) =>
  new Date(new Date(inicio).getTime() + Number(minutos) * MIN_MS);

/**
 * Cuánto se jugó del turno hasta `ahora`.
 *
 * Se recorta a los dos extremos a propósito:
 *  - nunca menos de 0 (si el reloj del servidor se corrió hacia atrás);
 *  - nunca más que los minutos que se pusieron a correr, porque detener un
 *    turno que ya se pasó de la hora no puede descontar tiempo que el cliente
 *    no había puesto en juego.
 */
export const minutosJugados = (turno, ahora = new Date()) => {
  if (!turno?.inicio) return 0;
  const corridos = Math.round((new Date(ahora).getTime() - new Date(turno.inicio).getTime()) / MIN_MS);
  return Math.min(Math.max(corridos, 0), Number(turno.minutos) || 0);
};

/** ¿El turno ya llegó a su fin? Lo que hace que el backend lo cierre solo. */
export const turnoVencido = (turno, ahora = new Date()) =>
  !!turno?.fin && new Date(turno.fin).getTime() <= new Date(ahora).getTime();

/**
 * El pendiente que queda tras cerrar el turno. Nunca negativo: si por un dato
 * viejo el turno tuviera más minutos que el pendiente, el piso es 0 y no un
 * número imposible.
 */
export const pendienteTrasCerrar = (tiempoPendiente, minutosUsados) =>
  Math.max(0, (Number(tiempoPendiente) || 0) - (Number(minutosUsados) || 0));

/**
 * ¿Se puede arrancar un turno de `minutos` sobre este play?
 * Devuelve null si se puede, o el mensaje de error listo para mostrar.
 */
export const validarInicioTurno = (play, minutos) => {
  const pedido = Number(minutos);
  const disponible = Number(play?.tiempoPendiente) || 0;

  if (play?.pendienteEnCurso) {
    return 'Este registro ya tiene un tiempo pendiente corriendo. Detenelo antes de arrancar otro.';
  }
  if (!Number.isFinite(pedido) || pedido <= 0) {
    return 'Poné cuántos minutos va a jugar.';
  }
  if (disponible <= 0) {
    return 'Este registro no tiene tiempo pendiente.';
  }
  if (pedido > disponible) {
    return `Solo quedan ${disponible} minutos pendientes.`;
  }
  return null;
};

/**
 * LA EXTENSION TARDIA.
 *
 * El formulario deriva la hora final de `horaInicio + tiempoPagado`, no de
 * "ahora + lo que se agrego". Si entre que el tiempo se vencio y que se
 * registra la extension paso mas rato que el tiempo agregado, ese fin nace ya
 * vencido: el aviso no se re-armaba y esos minutos nuevos NUNCA avisaban (y el
 * cronometro de la pantalla tambien quedaba mal).
 *
 * Cuando se AGREGA tiempo a una sesion cuyo fin anterior ya paso, el tiempo
 * nuevo empieza a correr ahora: el fin se ancla al reloj.
 *
 * EL OTRO LADO: si el fin nuevo YA PASO, el aviso no solo no se re-arma: hay
 * que CANCELARLO. Es el caso de guardar tiempo pendiente porque el cliente se
 * fue antes (se le baja el tiempo pagado y el fin nuevo cae en el pasado). No
 * hay partida que anunciar -el encargado esta ahi mismo editando-, pero el
 * aviso seguia pendiente y la ventana de catch-up del despachador lo mandaba
 * igual, un rato despues de que el chico ya se habia ido.
 *
 * Con esto updatePlay queda igual que createPlay, que ya hacia exactamente
 * esto: `notificacionFinEnviada: !finEnFuturo`.
 *
 * Vive aca y no dentro del controlador para poder probarlo de verdad
 * (ver scripts/probarTurnoPendiente.js).
 *
 * @returns {{ fin: Date, reArmaAviso: boolean, cancelaAviso: boolean, anclado: boolean }}
 */
export const resolverFinTrasEditar = ({
  finCalculado, finAnterior, tiempoPagadoNuevo, tiempoPagadoViejo, ahora = new Date(),
}) => {
  const ahoraMs = new Date(ahora).getTime();
  const finEnFuturo = finCalculado instanceof Date && finCalculado.getTime() > ahoraMs;

  const sumoTiempo = Number(tiempoPagadoNuevo) > Number(tiempoPagadoViejo);
  const finAnteriorVencido =
    finAnterior instanceof Date && finAnterior.getTime() <= ahoraMs;

  if (!finEnFuturo && sumoTiempo && finAnteriorVencido) {
    const agregados = Number(tiempoPagadoNuevo) - Number(tiempoPagadoViejo);
    const base = new Date(ahoraMs);
    base.setSeconds(0, 0);
    return {
      fin: new Date(base.getTime() + agregados * MIN_MS),
      reArmaAviso: true,
      cancelaAviso: false,
      anclado: true,
    };
  }

  return {
    fin: finCalculado,
    reArmaAviso: finEnFuturo,
    // El fin nuevo ya paso: no hay nada que anunciar.
    cancelaAviso: !finEnFuturo,
    anclado: false,
  };
};

/**
 * GUARDAR TIEMPO PENDIENTE = EL CLIENTE DEJO DE JUGAR.
 *
 * Si a una sesion que todavia no aviso le aparece (o le crece) el tiempo
 * pendiente, es porque el cliente se fue antes y se le esta guardando lo que no
 * uso. Esa consola ya quedo libre, asi que el aviso de "termino la partida"
 * programado para la hora original no tiene a quien avisarle: hay que
 * cancelarlo.
 *
 * OJO con la version amplia de esta regla -"si hay tiempo pendiente, no
 * avisar"-, que rompe el caso legitimo: un cliente paga 2 h, juega 1 h ahora y
 * guarda 1 h para despues. Esa hora que ESTA jugando tiene que avisar cuando
 * termine, y ahi el pendiente ya existia desde antes. Por eso lo que importa no
 * es que el pendiente EXISTA, sino que haya APARECIDO o CRECIDO en esta edicion.
 *
 * Tampoco alcanzaba con mirar el tiempo pagado: no se puede bajar para guardar
 * pendiente, porque es el que calcula la plata de la venta. El encargado anota
 * el pendiente y deja el pagado como estaba.
 *
 * @param {number} pendienteViejo - antes de la edicion
 * @param {number} pendienteNuevo - despues
 * @returns {boolean} true si hay que cancelar el aviso pendiente
 */
export const guardarPendienteCancelaAviso = (pendienteViejo, pendienteNuevo) =>
  (Number(pendienteNuevo) || 0) > (Number(pendienteViejo) || 0);
