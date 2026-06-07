// utils/dateUtils.js

/**
 * Obtiene rangos de fechas basados en la zona horaria de Costa Rica
 * El día inicia a las 12:00 AM (medianoche) hora de Costa Rica
 * @returns {Object} Objeto con rangos de fechas
 */
export const getUTCDateRanges = () => {
  // Obtener fecha/hora actual en Costa Rica
  const ahoraCostaRica = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }));
  
  // Inicio del día en Costa Rica (00:00:00) convertido a UTC
  // Costa Rica es UTC-6, entonces medianoche CR = 6:00 AM UTC
  const hoy = new Date(
    Date.UTC(
      ahoraCostaRica.getFullYear(),
      ahoraCostaRica.getMonth(),
      ahoraCostaRica.getDate(),
      6, // +6 horas para compensar UTC-6
      0,
      0,
      0
    )
  );

  // Fin del día en Costa Rica (23:59:59.999) convertido a UTC
  const finHoy = new Date(
    Date.UTC(
      ahoraCostaRica.getFullYear(),
      ahoraCostaRica.getMonth(),
      ahoraCostaRica.getDate() + 1,
      5, // Día siguiente a las 05:59:59 UTC = 23:59:59 Costa Rica
      59,
      59,
      999
    )
  );

  // Inicio de la semana en Costa Rica (domingo a las 00:00:00)
  const inicioSemana = new Date(hoy);
  const diaActual = ahoraCostaRica.getDay(); // 0 = domingo
  inicioSemana.setUTCDate(hoy.getUTCDate() - diaActual);

  // Inicio del mes en Costa Rica (día 1 a las 00:00:00)
  const inicioMes = new Date(
    Date.UTC(
      ahoraCostaRica.getFullYear(),
      ahoraCostaRica.getMonth(),
      1,
      6, // +6 horas para compensar UTC-6
      0,
      0,
      0
    )
  );

  return {
    hoy: {
      inicio: hoy,
      fin: finHoy,
    },
    semana: {
      inicio: inicioSemana,
    },
    mes: {
      inicio: inicioMes,
    },
  };
};

/**
 * Obtiene una fecha X días atrás desde hoy
 * @param {number} days - Número de días hacia atrás
 * @returns {Date} Fecha calculada
 */
export const getDaysAgo = (days) => {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - days);
  fecha.setHours(0, 0, 0, 0);
  return fecha;
};

/**
 * Formatea fecha para logs en zona horaria de Costa Rica
 * @param {Date} date - Fecha a formatear
 * @returns {string} Fecha formateada
 */
export const formatCostaRicaTime = (date = new Date()) => {
  return date.toLocaleString('es-CR', {
    timeZone: 'America/Costa_Rica',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

/**
 * Muestra en consola los rangos de fechas para debugging
 * @param {Object} ranges - Objeto de rangos retornado por getUTCDateRanges
 */
export const logDateRanges = (ranges) => {
  console.log(`📅 Rangos de búsqueda (Zona horaria: Costa Rica):`);
  console.log(`   Hoy UTC: ${ranges.hoy.inicio.toISOString()} a ${ranges.hoy.fin.toISOString()}`);
  console.log(`   Hoy CR:  ${formatCostaRicaTime(ranges.hoy.inicio)} a ${formatCostaRicaTime(ranges.hoy.fin)}`);
  console.log(`   Semana desde UTC: ${ranges.semana.inicio.toISOString()}`);
  console.log(`   Mes desde UTC: ${ranges.mes.inicio.toISOString()}`);
};


/**
 * Hecho por Claude Code — Crea un filtro de MongoDB para un mes completo
 * en zona horaria de Costa Rica (UTC-6).
 * Medianoche CR del día 1 = 06:00 UTC. Rango [inicio, fin) exclusivo:
 * no hay huecos ni traslapes entre meses consecutivos.
 * @param {number} mes - Mes (1-12)
 * @param {number} anio - Año (ej. 2026)
 * @returns {Object} Filtro para el campo fecha: { $gte, $lt }
 */
export const crearFiltroMes = (mes, anio) => {
  const inicio = new Date(Date.UTC(anio, mes - 1, 1, 6, 0, 0, 0));
  const fin = new Date(Date.UTC(anio, mes, 1, 6, 0, 0, 0)); // día 1 del mes siguiente
  return { $gte: inicio, $lt: fin };
};

/**
 * Hecho por Claude Code — Genera la fecha que el backend guarda para un
 * registro del mes elegido en el frontend. El frontend NUNCA envía fechas:
 * solo elige mes y año, y el backend resuelve la fecha a guardar.
 *   - Mes actual → fecha/hora actual (timestamp real)
 *   - Mes pasado → día 1 de ese mes a medianoche de Costa Rica (06:00 UTC),
 *     para que caiga dentro del filtro de ese mes
 *   - Mes futuro → null (no permitido)
 * @param {number} mes - Mes elegido (1-12)
 * @param {number} anio - Año elegido (ej. 2026)
 * @returns {Date|null} Fecha a guardar o null si el mes es futuro
 */
export const crearFechaParaMes = (mes, anio) => {
  const cr = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }));
  const mesActual = cr.getMonth() + 1;
  const anioActual = cr.getFullYear();

  if (anio > anioActual || (anio === anioActual && mes > mesActual)) return null; // futuro
  if (anio === anioActual && mes === mesActual) return new Date(); // ahora mismo
  return new Date(Date.UTC(anio, mes - 1, 1, 6, 0, 0, 0)); // día 1, medianoche CR
};

/**
 *  Nueva función Convierte fechas de formulario a filtro MongoDB
 * Convierte una fecha en formato YYYY-MM-DD a rango UTC de Costa Rica
 * @param {string} fechaInicio - Fecha inicio en formato YYYY-MM-DD
 * @param {string} fechaFin - Fecha fin en formato YYYY-MM-DD (opcional)
 * @returns {Object} Filtro de MongoDB para el campo fecha
 */
export const crearFiltroFechas = (fechaInicio, fechaFin) => {
  const filtro = {};

  if (fechaInicio) {
    const [year, month, day] = fechaInicio.split('-');
    // Inicio del día en Costa Rica = 06:00 UTC
    const fechaInicioUTC = new Date(Date.UTC(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      6, 0, 0, 0
    ));
    filtro.$gte = fechaInicioUTC;
  }

  if (fechaFin) {
    const [year, month, day] = fechaFin.split('-');
    // Fin del día en Costa Rica = 05:59:59.999 UTC del día siguiente
    const fechaFinUTC = new Date(Date.UTC(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day) + 1,
      5, 59, 59, 999
    ));
    filtro.$lte = fechaFinUTC;
  }

  return filtro;
};