// utils/rankingClientes.js
//
// Ranking de "quién jugó más". Vive acá, y no dentro de un controlador, porque
// lo usan TRES lugares que no se pueden contradecir:
//
//   1. El endpoint por periodo  → GET /api/monthly-reports/:año/:mes/clientes
//   2. El generador de reportes → MonthlyReportPlaysController.calcularReporte
//   3. La regeneración automática → playsController.calcularDatosReporte
//
// Si el cálculo estuviera copiado en cada uno, el Top 10 guardado en el reporte
// del mes podría decir una cosa y la pantalla del ranking otra.
//
// Nota sobre los nombres: el cliente se escribe a mano en cada play, así que
// "José", "jose" y "JOSÉ " son la misma persona. Se agrupan por el nombre
// normalizado (sin tildes ni mayúsculas) y se muestra la forma más usada.

import { normalizarTexto } from './textoBusqueda.js';

export const NOMBRES_MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril',
  'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const CR_TZ = 'America/Costa_Rica';

// Etiqueta para los plays que se guardaron sin nombre de cliente.
const SIN_NOMBRE = 'Sin nombre';

// ─────────────────────────────────────────────────────────────────
// Fechas: el día en la sala corre de medianoche a medianoche de Costa
// Rica (UTC-6), igual que en el resto de los reportes.
// ─────────────────────────────────────────────────────────────────

/** Cantidad de días del mes (mes es 1-12). */
export const diasDelMes = (año, mes) => new Date(Date.UTC(año, mes, 0)).getUTCDate();

/** Medianoche CR del día indicado, en UTC. */
export const inicioDiaCR = (año, mes, dia) => new Date(Date.UTC(año, mes - 1, dia, 6, 0, 0, 0));

/** Último instante del día CR indicado (23:59:59.999 CR), en UTC. */
export const finDiaCR = (año, mes, dia) => new Date(Date.UTC(año, mes - 1, dia + 1, 5, 59, 59, 999));

/** 'YYYY-MM-DD' del día CR al que pertenece un instante. Sirve para contar días distintos. */
export const claveDiaCR = (fecha) => {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: CR_TZ }); // en-CA = YYYY-MM-DD
};

/** 320 → "5 h 20 min". Para no obligar al frontend a hacer la cuenta. */
export const formatearMinutos = (minutos) => {
  const total = Math.max(0, Math.round(Number(minutos) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} h`;
  return `${h} h ${m} min`;
};

// ─────────────────────────────────────────────────────────────────
// Periodos seleccionables dentro de un mes
//
// Las semanas son BLOQUES FIJOS de 7 días contados desde el día 1, no semanas
// de lunes a domingo. Así todos los meses se cortan igual, las quincenas calzan
// exacto (semanas 1-2 = quincena 1) y el dueño siempre ve lo mismo.
// ─────────────────────────────────────────────────────────────────

const BLOQUES_SEMANA = [[1, 7], [8, 14], [15, 21], [22, 28], [29, 31]];

const armarPeriodo = ({ tipo, numero, año, mes, diaInicio, diaFin, etiquetaCorta, ultimoDia }) => {
  const fin = Math.min(diaFin, ultimoDia);
  const nombreMes = NOMBRES_MESES[mes - 1].toLowerCase();
  return {
    tipo,
    numero,
    diaInicio,
    diaFin: fin,
    etiquetaCorta,
    etiqueta: `${etiquetaCorta} (${diaInicio} – ${fin} de ${nombreMes})`,
    desde: inicioDiaCR(año, mes, diaInicio),
    hasta: finDiaCR(año, mes, fin),
  };
};

/**
 * Todos los periodos que el frontend puede ofrecer para un mes, ya con sus
 * fechas resueltas. El frontend solo dibuja los botones: la cuenta de qué días
 * cubre cada semana la hace el backend, para que no se desincronicen.
 *
 * Los bloques que no existen en el mes se omiten solos: febrero de 28 días no
 * devuelve "Semana 5", y un mes de 15 días o menos no devolvería "Quincena 2".
 *
 * @param {number} año
 * @param {number} mes - 1-12
 * @returns {{semanas: Object[], quincenas: Object[], mes: Object, ultimoDia: number}}
 */
export const periodosDelMes = (año, mes) => {
  const ultimoDia = diasDelMes(año, mes);
  const base = { año, mes, ultimoDia };

  const semanas = BLOQUES_SEMANA
    .filter(([diaInicio]) => diaInicio <= ultimoDia)
    .map(([diaInicio, diaFin], i) =>
      armarPeriodo({ ...base, tipo: 'semana', numero: i + 1, diaInicio, diaFin, etiquetaCorta: `Semana ${i + 1}` })
    );

  const quincenas = [
    armarPeriodo({ ...base, tipo: 'quincena', numero: 1, diaInicio: 1, diaFin: 15, etiquetaCorta: 'Quincena 1' }),
    ...(ultimoDia > 15
      ? [armarPeriodo({ ...base, tipo: 'quincena', numero: 2, diaInicio: 16, diaFin: ultimoDia, etiquetaCorta: 'Quincena 2' })]
      : []),
  ];

  const mesCompleto = {
    tipo: 'mes',
    numero: null,
    diaInicio: 1,
    diaFin: ultimoDia,
    etiquetaCorta: 'Todo el mes',
    etiqueta: `Todo ${NOMBRES_MESES[mes - 1].toLowerCase()} ${año}`,
    desde: inicioDiaCR(año, mes, 1),
    hasta: finDiaCR(año, mes, ultimoDia),
  };

  return { semanas, quincenas, mes: mesCompleto, ultimoDia };
};

// 'YYYY-MM-DD' → {año, mes, dia}, o null si no es una fecha real.
const parseFechaISO = (str) => {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(str ?? '').trim());
  if (!m) return null;
  const año = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12) return null;
  if (dia < 1 || dia > diasDelMes(año, mes)) return null;
  return { año, mes, dia };
};

const textoFecha = ({ año, mes, dia }) => `${dia} de ${NOMBRES_MESES[mes - 1].toLowerCase()} de ${año}`;

/**
 * Traduce lo que pidió el frontend a un rango de fechas concreto.
 *
 * @param {number} año
 * @param {number} mes - 1-12
 * @param {Object} q - query params: { periodo, semana, quincena, desde, hasta }
 * @returns {{ok: true, periodo: Object} | {ok: false, mensaje: string}}
 */
export const resolverPeriodo = (año, mes, q = {}) => {
  const { semanas, quincenas, mes: mesCompleto } = periodosDelMes(año, mes);
  const tipo = String(q.periodo ?? 'mes').trim().toLowerCase();

  if (tipo === 'mes' || tipo === '') return { ok: true, periodo: mesCompleto };

  if (tipo === 'semana') {
    const n = parseInt(q.semana, 10);
    const elegida = semanas.find((s) => s.numero === n);
    if (!elegida) {
      return {
        ok: false,
        mensaje: `Semana inválida. ${NOMBRES_MESES[mes - 1]} ${año} tiene ${semanas.length} semanas (1 a ${semanas.length}).`,
      };
    }
    return { ok: true, periodo: elegida };
  }

  if (tipo === 'quincena') {
    const n = parseInt(q.quincena, 10);
    const elegida = quincenas.find((c) => c.numero === n);
    if (!elegida) {
      return { ok: false, mensaje: 'Quincena inválida. Usá quincena=1 (días 1-15) o quincena=2 (16 al final del mes).' };
    }
    return { ok: true, periodo: elegida };
  }

  if (tipo === 'personalizado') {
    const desde = parseFechaISO(q.desde);
    const hasta = parseFechaISO(q.hasta);
    if (!desde || !hasta) {
      return { ok: false, mensaje: 'Para el periodo personalizado se necesitan desde y hasta en formato YYYY-MM-DD (ej. desde=2026-08-04&hasta=2026-08-12).' };
    }
    const inicio = inicioDiaCR(desde.año, desde.mes, desde.dia);
    const fin    = finDiaCR(hasta.año, hasta.mes, hasta.dia);
    if (inicio > fin) {
      return { ok: false, mensaje: 'La fecha "desde" no puede ser posterior a "hasta".' };
    }
    return {
      ok: true,
      periodo: {
        tipo: 'personalizado',
        numero: null,
        diaInicio: desde.dia,
        diaFin: hasta.dia,
        etiquetaCorta: 'Personalizado',
        etiqueta: `Del ${textoFecha(desde)} al ${textoFecha(hasta)}`,
        desde: inicio,
        hasta: fin,
      },
    };
  }

  return { ok: false, mensaje: 'Periodo inválido. Usá: mes, semana, quincena o personalizado.' };
};

// ─────────────────────────────────────────────────────────────────
// El ranking
// ─────────────────────────────────────────────────────────────────

// Qué campo se usa para ordenar según lo que pidió el usuario.
const CAMPO_ORDEN = {
  sesiones: 'sesiones',
  tiempo:   'tiempoTotalMinutos',
  monto:    'montoTotal',
};

export const ORDENES_VALIDOS = Object.keys(CAMPO_ORDEN);

/**
 * Arma el ranking de clientes a partir de una lista de plays ya filtrada por
 * fecha. Devuelve SIEMPRE a todos los clientes, del que más jugó al que menos;
 * cortar en un Top 10 es decisión de quien llama.
 *
 * @param {Object[]} plays - Documentos de Play (lean)
 * @param {Object} [opciones]
 * @param {'sesiones'|'tiempo'|'monto'} [opciones.ordenarPor='sesiones']
 * @returns {Object[]} clientes ordenados, con `posicion` ya asignada
 */
export const construirRankingClientes = (plays, { ordenarPor = 'sesiones' } = {}) => {
  const mapa = new Map();

  for (const play of plays) {
    const nombreCrudo = String(play.cliente ?? '').trim();
    const clave = normalizarTexto(nombreCrudo) || ' sin-nombre';
    const fecha = play.fecha instanceof Date ? play.fecha : new Date(play.fecha);

    if (!mapa.has(clave)) {
      mapa.set(clave, {
        variantes: new Map(), // cómo se ha escrito el nombre → veces y última vez
        juegos: new Map(),
        dias: new Set(),
        sesiones: 0,
        tiempoTotalMinutos: 0,
        montoTotal: 0,
        totalPlay4: 0,
        totalPlay5: 0,
        totalPingPong: 0,
        controlesAdicionales: 0,
        totalCostosControles: 0,
        primeraVisita: null,
        ultimaVisita: null,
      });
    }
    const c = mapa.get(clave);

    c.sesiones++;
    c.tiempoTotalMinutos   += play.tiempoPagado     || 0;
    c.montoTotal           += play.total            || 0;
    c.totalPlay4           += play.totalPlay4       || 0;
    c.totalPlay5           += play.totalPlay5       || 0;
    c.totalPingPong        += play.totalPingPong    || 0;
    c.controlesAdicionales += play.controlAdicional || 0;
    c.totalCostosControles += play.costoControles   || 0;

    // Forma de escribir el nombre: nos quedamos con la más usada.
    if (nombreCrudo) {
      const v = c.variantes.get(nombreCrudo) || { veces: 0, ultima: null };
      v.veces++;
      if (!v.ultima || fecha > v.ultima) v.ultima = fecha;
      c.variantes.set(nombreCrudo, v);
    }

    const dia = claveDiaCR(fecha);
    if (dia) c.dias.add(dia);

    if (!Number.isNaN(fecha.getTime())) {
      if (!c.primeraVisita || fecha < c.primeraVisita) c.primeraVisita = fecha;
      if (!c.ultimaVisita  || fecha > c.ultimaVisita)  c.ultimaVisita  = fecha;
    }

    for (const juego of (Array.isArray(play.juegosJugados) ? play.juegosJugados : [])) {
      if (!juego) continue;
      const nombreJuego = String(juego).trim();
      if (!nombreJuego) continue;
      c.juegos.set(nombreJuego, (c.juegos.get(nombreJuego) || 0) + 1);
    }
  }

  const campo = CAMPO_ORDEN[ordenarPor] || CAMPO_ORDEN.sesiones;

  // Qué tan presentable se ve una forma de escribir el nombre, para desempatar:
  // "José" (2) se prefiere sobre "jose" (1), y ambas sobre "JOSÉ" (0).
  const calidadNombre = (s) => {
    const tieneLetras = s !== s.toLowerCase() || s !== s.toUpperCase();
    if (tieneLetras && s.length > 1 && s === s.toUpperCase()) return 0; // A GRITOS
    return s[0] === s[0].toUpperCase() && s[0] !== s[0].toLowerCase() ? 2 : 1;
  };

  const lista = [...mapa.values()].map((c) => {
    // Nombre a mostrar: la escritura más repetida; si empatan, la que mejor se
    // ve y, de últimas, la más reciente.
    const mejorVariante = [...c.variantes.entries()].sort((a, b) =>
      b[1].veces - a[1].veces ||
      calidadNombre(b[0]) - calidadNombre(a[0]) ||
      (b[1].ultima?.getTime() || 0) - (a[1].ultima?.getTime() || 0)
    )[0];

    return {
      cliente: mejorVariante ? mejorVariante[0] : SIN_NOMBRE,
      sesiones: c.sesiones,
      diasDistintos: c.dias.size,
      tiempoTotalMinutos: c.tiempoTotalMinutos,
      tiempoTotalTexto: formatearMinutos(c.tiempoTotalMinutos),
      promedioMinutosPorSesion: c.sesiones ? Math.round(c.tiempoTotalMinutos / c.sesiones) : 0,
      montoTotal: c.montoTotal,
      promedioMontoPorSesion: c.sesiones ? Math.round(c.montoTotal / c.sesiones) : 0,
      totalPlay4: c.totalPlay4,
      totalPlay5: c.totalPlay5,
      totalPingPong: c.totalPingPong,
      controlesAdicionales: c.controlesAdicionales,
      totalCostosControles: c.totalCostosControles,
      primeraVisita: c.primeraVisita,
      ultimaVisita: c.ultimaVisita,
      juegosFavoritos: [...c.juegos.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
        .slice(0, 3)
        .map(([nombre, vecesJugado]) => ({ nombre, vecesJugado })),
    };
  });

  // Orden: primero la métrica pedida; los empates se rompen con las otras dos y,
  // al final, alfabéticamente, para que el orden sea estable entre llamadas.
  lista.sort((a, b) =>
    b[campo] - a[campo] ||
    b.sesiones - a.sesiones ||
    b.tiempoTotalMinutos - a.tiempoTotalMinutos ||
    b.montoTotal - a.montoTotal ||
    a.cliente.localeCompare(b.cliente, 'es')
  );

  return lista.map((c, i) => ({ posicion: i + 1, ...c }));
};

/**
 * Top 10 en la forma reducida que se guarda dentro del reporte mensual
 * (al lado de juegosMasJugados). Se guarda poco: lo que la tarjeta del reporte
 * necesita mostrar. El detalle completo sale del endpoint de ranking.
 * @param {Object[]} plays
 * @returns {Object[]}
 */
export const construirTopClientes = (plays, limite = 10) =>
  construirRankingClientes(plays, { ordenarPor: 'sesiones' })
    .slice(0, limite)
    .map((c) => ({
      posicion: c.posicion,
      cliente: c.cliente,
      sesiones: c.sesiones,
      tiempoTotalMinutos: c.tiempoTotalMinutos,
      montoTotal: c.montoTotal,
      totalPlay4: c.totalPlay4,
      totalPlay5: c.totalPlay5,
      totalPingPong: c.totalPingPong,
      diasDistintos: c.diasDistintos,
      ultimaVisita: c.ultimaVisita,
    }));
