// utils/dateUtils.js

/**
 * Obtiene rangos de fechas en UTC para hoy, semana y mes
 * @returns {Object} Objeto con rangos de fechas
 */
export const getUTCDateRanges = () => {
  const ahora = new Date();

  // Inicio y fin del día actual en UTC
  const hoy = new Date(
    Date.UTC(
      ahora.getUTCFullYear(),
      ahora.getUTCMonth(),
      ahora.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );

  const finHoy = new Date(
    Date.UTC(
      ahora.getUTCFullYear(),
      ahora.getUTCMonth(),
      ahora.getUTCDate(),
      23,
      59,
      59,
      999
    )
  );

  // Inicio de la semana en UTC (domingo)
  const inicioSemana = new Date(hoy);
  inicioSemana.setUTCDate(hoy.getUTCDate() - ahora.getUTCDay());

  // Inicio del mes en UTC
  const inicioMes = new Date(
    Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1, 0, 0, 0, 0)
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
  console.log(`📅 Rangos de búsqueda UTC:`);
  console.log(`   Hoy: ${ranges.hoy.inicio.toISOString()} a ${ranges.hoy.fin.toISOString()}`);
  console.log(`   Semana desde: ${ranges.semana.inicio.toISOString()}`);
  console.log(`   Mes desde: ${ranges.mes.inicio.toISOString()}`);
};
