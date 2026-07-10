// scripts/parseHistoricoExcel.js
// Hecho por Claude Code — Lector del Excel histórico "Sala de juegos Oficial.xlsx".
//
// Lee las 24 hojas mensuales (mar 2024 – feb 2026), normaliza CADA sesión a la
// forma que consume la migración, y RECONCILIA la suma de cada mes contra los
// totales auditados del prompt. Si un mes no cuadra, `ok` viene en false y la
// migración se aborta (no importa datos que no cuadren).
//
// El Excel tiene 3 variantes de layout (2024 con "X" por consola; 2025-2026 con
// columna de texto "Lugar/Elección de Juego"; encabezados en filas distintas) y
// una sección de helados a la derecha que se ignora. La detección de columnas es
// dinámica (por encabezado), no por posición fija.
//
// NOTA: `xlsx` es devDependency. Este archivo NO lo importa server.js, así que no
// pesa en producción; solo se usa al correr la migración localmente.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

// Hoja del Excel → [año, mes]. Whitelist explícita (los nombres son irregulares:
// mayúsculas mixtas, espacios finales, 2024 sin año en el nombre). Las hojas
// extra ("Noviembre" duplicada, "Hoja 8", inventarios) quedan fuera a propósito.
const MAPA_HOJAS = {
  'Marzo ': [2024, 3], 'Abril': [2024, 4], 'Mayo': [2024, 5], 'Junio ': [2024, 6],
  'Julio ': [2024, 7], 'Agosto ': [2024, 8], 'Septiembre ': [2024, 9], 'Octubre': [2024, 10],
  'Noviembre ': [2024, 11], 'Diciembre': [2024, 12],
  'ENERO 2025': [2025, 1], 'Febrero 2025': [2025, 2], 'Marzo 2025': [2025, 3], 'ABRIL 2025': [2025, 4],
  'MAYO 2025': [2025, 5], 'JUNIO 2025': [2025, 6], 'JULIO 2025': [2025, 7], 'AGOSTO 2025': [2025, 8],
  'SEPTIEMBRE 2025': [2025, 9], 'OCTUBRE 2025': [2025, 10], 'NOVIEMBRE 2025': [2025, 11], 'DICIEMBRE 2025': [2025, 12],
  'ENERO 2026': [2026, 1], 'FEBRERO 2026': [2026, 2],
};

// Totales auditados [play4, play5, pingpong, adicional, total] para reconciliar.
const AUDIT = {
  '2024-3': [76050, 0, 0, 3600, 79650], '2024-4': [98450, 0, 0, 4800, 103250], '2024-5': [156485, 0, 0, 12100, 168585],
  '2024-6': [136600, 0, 0, 8200, 144800], '2024-7': [229700, 0, 0, 11150, 240850], '2024-8': [248550, 0, 0, 16600, 265150],
  '2024-9': [191750, 0, 0, 13200, 204950], '2024-10': [213000, 0, 0, 12200, 225200], '2024-11': [207800, 0, 0, 11000, 218800],
  '2024-12': [113800, 28500, 3000, 6400, 151700], '2025-1': [130300, 26400, 10100, 3200, 170000], '2025-2': [96200, 25900, 6700, 4600, 133400],
  '2025-3': [102050, 44500, 6000, 7600, 160150], '2025-4': [72800, 33600, 1400, 4200, 112000], '2025-5': [79600, 45100, 1600, 5400, 131700],
  '2025-6': [99750, 39800, 3300, 2600, 145450], '2025-7': [73650, 32200, 0, 4200, 110050], '2025-8': [52600, 25050, 7600, 1600, 86850],
  '2025-9': [71000, 35000, 3800, 1200, 111000], '2025-10': [70500, 65300, 2200, 2600, 140600], '2025-11': [37100, 96150, 2800, 2400, 138450],
  '2025-12': [36500, 52950, 2050, 2800, 94300], '2026-1': [26900, 48900, 1600, 2400, 79800], '2026-2': [54800, 39700, 1750, 3600, 99850],
};

export const CHECKSUM_PLAYS = 3516535;

const norm = (v) => (v == null ? '' : String(v).trim());
const low = (v) => norm(v).toLowerCase();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Localiza índices de columnas leyendo el encabezado (hdr) y su subfila (sub).
const mapearColumnas = (hdr, sub) => {
  const c = { p4Units: [], p5Units: [], ppUnit: -1 };
  for (let i = 0; i < hdr.length; i++) {
    const h = low(hdr[i]); const s = low(sub[i]);
    if (h === 'atendió' || h === 'atendio') c.atendio = i;
    if (h === 'tiempo pagado') c.tiempo = i;
    if (h.includes('adicional') || (h.includes('control') && h.includes('₡'))) c.control = i;
    if (h.includes('elección') || h.includes('eleccion') || h.includes('lugar de juego')) c.lugarTxt = i;
    if (h === 'juegos jugados') { c.juego1 = i; c.juego2 = i + 1; }
    if (h === 'play 4') c.p4Units.push(i);
    if (h === 'play 5') c.p5Units.push(i);
    if (h === 'ping pong') c.ppUnit = i;
    if (h === 'total' || h === 'total play') {
      if (s === 'play 4') c.totP4 = i;
      else if (s === 'play 5') c.totP5 = i;
      else if (s === 'ping pong') c.totPP = i;
      else if (h === 'total play' && !s) c.totSingle = i;
    }
  }
  if (c.p4Units.length) { const b = c.p4Units[0]; c.p4Units = [b, b + 1, b + 2]; }
  if (c.p5Units.length) { const b = c.p5Units[0]; c.p5Units = [b, b + 1, b + 2]; }
  return c;
};

const parseLugarTexto = (txt) => {
  const t = low(txt); if (!t) return null;
  if (t.includes('ping')) return { tipo: 'Ping Pong', unit: 1 };
  const um = t.match(/n[uú]mero\s*(\d)/); const unit = um ? Number(um[1]) : 1;
  if (t.includes('play 5') || t.includes('play5')) return { tipo: 'Play 5', unit };
  if (t.includes('play 4') || t.includes('play4')) return { tipo: 'Play 4', unit };
  return null;
};

// Día del mes: Date → día (hora CR); texto "09-03"/"15/03" → día; si no, 1.
const diaDelMes = (v) => {
  if (v instanceof Date) {
    const cr = new Date(v.toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }));
    return cr.getDate();
  }
  const m = norm(v).match(/^(\d{1,2})[-/]/);
  if (m) { const d = Number(m[1]); if (d >= 1 && d <= 31) return d; }
  return 1;
};

// Minutos desde texto libre ("1 h", "30min", "1 h 30 m", "1hora", "1h y 30min").
const parseMinutos = (txt) => {
  const t = low(txt); if (!t) return 0;
  const h = t.match(/(\d+)\s*h/); const m = t.match(/(\d+)\s*m(?:in)?\b/);
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
};

/**
 * Parsea el Excel y devuelve { ok, sesiones, reconciliacion, totalParseado }.
 * @param {string} rutaXlsx - ruta del archivo .xlsx
 */
export const parseHistorico = (rutaXlsx) => {
  const wb = XLSX.readFile(rutaXlsx, { cellDates: true });
  const sesiones = [];
  const reconciliacion = [];

  for (const [hoja, [año, mes]] of Object.entries(MAPA_HOJAS)) {
    const ws = wb.Sheets[hoja];
    if (!ws) { reconciliacion.push({ key: `${año}-${mes}`, hoja, error: 'HOJA NO ENCONTRADA', ok: false }); continue; }
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const hIdx = rows.findIndex((r) => norm(r[0]).toUpperCase() === 'FECHA');
    if (hIdx < 0) { reconciliacion.push({ key: `${año}-${mes}`, hoja, error: 'SIN ENCABEZADO', ok: false }); continue; }
    const col = mapearColumnas(rows[hIdx], rows[hIdx + 1] || []);

    let sP4 = 0, sP5 = 0, sPP = 0, sCtrl = 0, n = 0;
    for (let i = hIdx + 2; i < rows.length; i++) {
      const r = rows[i];
      if (norm(r[0]).toUpperCase() === 'TOTAL') continue; // fila de resumen del Excel
      const v4 = num(r[col.totP4]); const v5 = num(r[col.totP5]); const vpp = num(r[col.totPP]);
      const vsingle = col.totSingle !== undefined ? num(r[col.totSingle]) : 0;
      const ctrl = num(r[col.control]);
      const hasAmount = v4 + v5 + vpp + vsingle + ctrl > 0;
      const esFecha = r[0] instanceof Date;
      if (!esFecha && !hasAmount) continue; // ni fecha ni monto → no es sesión

      n++; sCtrl += ctrl;
      let tipo = null, unit = 1;
      if (col.lugarTxt !== undefined) { const p = parseLugarTexto(r[col.lugarTxt]); if (p) { tipo = p.tipo; unit = p.unit; } }
      if (!tipo) {
        if (col.p4Units.some((u) => low(r[u]) === 'x')) { tipo = 'Play 4'; unit = col.p4Units.findIndex((u) => low(r[u]) === 'x') + 1; }
        else if (col.p5Units.some((u) => low(r[u]) === 'x')) { tipo = 'Play 5'; unit = col.p5Units.findIndex((u) => low(r[u]) === 'x') + 1; }
        else if (col.ppUnit >= 0 && low(r[col.ppUnit]) === 'x') { tipo = 'Ping Pong'; }
      }
      let ingreso = 0;
      if (col.totP4 !== undefined || col.totP5 !== undefined || col.totPP !== undefined) {
        ingreso = v4 + v5 + vpp;
        if (!tipo) { if (v5) tipo = 'Play 5'; else if (vpp) tipo = 'Ping Pong'; else if (v4) tipo = 'Play 4'; }
        sP4 += v4; sP5 += v5; sPP += vpp;
      } else { ingreso = vsingle; sP4 += vsingle; if (!tipo) tipo = 'Play 4'; }

      const juegos = [norm(r[col.juego1]), norm(r[col.juego2])].filter(Boolean).slice(0, 2);
      sesiones.push({
        año, mes, dia: diaDelMes(r[0]),
        tipo: tipo || 'Play 4', unit: Math.min(3, Math.max(1, unit)),
        ingreso, control: ctrl,
        cliente: norm(r[1]) || 'Cliente',
        atendio: norm(r[col.atendio]) || 'Histórico',
        juegos, minutos: parseMinutos(r[col.tiempo]),
      });
    }

    const [aP4, aP5, aPP, aCtrl, aTot] = AUDIT[`${año}-${mes}`];
    const tot = sP4 + sP5 + sPP + sCtrl;
    reconciliacion.push({
      key: `${año}-${mes}`, hoja, sesiones: n,
      sP4, sP5, sPP, sCtrl, tot, aP4, aP5, aPP, aCtrl, aTot,
      ok: sP4 === aP4 && sP5 === aP5 && sPP === aPP && sCtrl === aCtrl && tot === aTot,
    });
  }

  const totalParseado = reconciliacion.reduce((s, r) => s + (r.tot || 0), 0);
  const ok = reconciliacion.every((r) => r.ok) && totalParseado === CHECKSUM_PLAYS;
  return { ok, sesiones, reconciliacion, totalParseado };
};
