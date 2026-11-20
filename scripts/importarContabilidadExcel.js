// scripts/importarContabilidadExcel.js
// SEGUNDA importacion historica: el libro "Contabilidad Sala de Juegos Ruiz.xlsb"
// (mar 2021 - may 2026). La primera (migrarHistoricoExcel.js) cargo plays por
// sesion de mar 2024 a feb 2026 desde OTRO Excel; esta completa lo que el sistema
// NO tiene: plays 2021-2024, maquinas/futbolin/peluches/torneos como Ganancias,
// gastos como Pagos, y activos del inventario que faltan.
//
// REGLA DEL DUENO: lo que ya tiene el sistema es lo REAL y no se modifica ni se
// borra. Solo se AGREGA lo que falta. Todo lo agregado lleva origen:'excel_contabilidad'
// (plays, ganancias, pagos, activos y las fichas de juego nuevas) para que `rollback`
// borre SOLO eso.
//
// FLUJO
//   1) python -I scripts/contabilidad/extraer_contabilidad.py <xlsb> <json> <csv_por_mes>
//      -> JSON intermedio (el .xlsb no se lee desde Node).
//   2) node scripts/importarContabilidadExcel.js prueba     # dry-run: SOLO LEE la base
//   3) node scripts/importarContabilidadExcel.js backup     # respaldo de reportes (lee)
//   4) node scripts/importarContabilidadExcel.js cargar     # ESCRIBE: inserta + regenera + verifica
//   5) node scripts/importarContabilidadExcel.js rollback   # borra solo origen 'excel_contabilidad'
//
// Argumentos opcionales: [comando] [rutaJson] [rutaResumen.md]
// Idempotente: cargar/prueba cuentan lo ya importado (origen) y no lo duplican.

import dotenv from 'dotenv';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

// Mismo truco de DNS que migrarHistoricoExcel.js (ISP que no resuelven SRV).
dns.setDefaultResultOrder('ipv4first');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* no critico */ }

import Play from '../models/plays.js';
import Ganancia from '../models/Ganancia.js';
import PagoServicio from '../models/PagoServicio.js';
import ActivoSala from '../models/ActivoSala.js';
import Juego, { normalizarNombre } from '../models/Juego.js';
import Counter, { siguienteSecuencia, fijarSecuenciaMinima } from '../models/Counter.js';
import MonthlyReport from '../models/Monthlyplaysreport.js';
import EstadoResultados from '../models/EstadoResultados.js';
import { regenerarReporteDeFecha } from '../controllers/playsController.js';
import { regenerarEstadoDeMes } from '../controllers/estadoResultadosController.js';
import { regenerarReporteActivos } from '../controllers/activosReportController.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORIGEN = 'excel_contabilidad';
const CONTADOR_PLACA = 'numeroPlacaActivo';

const SCRATCH = 'C:/Users/antoy/AppData/Local/Temp/claude/b725d29b6a9aa162/4abfac10-c9a0-4500-b6aa-9fe8abfb5748/scratchpad';
const RUTA_JSON = process.argv[3] || `${SCRATCH}/agente4/contabilidad_items.json`;
const RUTA_RESUMEN = process.argv[4] || `${SCRATCH}/agente4/resumen_prueba.md`;
const RUTA_SISTEMA_ACTIVOS_CSV = `${SCRATCH}/agente/sistema_activos.csv`; // solo para comparar en la prueba

// Totales que DEBEN cuadrar (informe del analisis previo).
const ESPERADO = {
  plays: 3397710,
  monedas: 6573010,
  zapata: 1059600,
  futbolin: 571200,
  peluches: 84600,
  torneos: 17400,
  activosInventarioTotal: 6147585,     // total de la hoja Inventario
  activosInventarioDuplicado: 33500,   // "Fifa FC 25" aparece 2 veces
  activosAgregarCandidatos: 703630,    // los 56
};

// ─────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────
const R = (n) => '₡' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const mesDe = (iso) => iso.slice(0, 7);
const fechaCR = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 6, 0, 0, 0)); };
const mesKeyCR = (date) => {
  const p = new Date(date.getTime() - 6 * 3600 * 1000); // CR = UTC-6
  return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, '0')}`;
};
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const redondear = (n) => Math.round(n * 100) / 100;
const dias = (a, b) => Math.abs(a.getTime() - b.getTime()) / 86400000;

// ─────────────────────────────────────────────────────────────
// DECISIONES (todas explicitas para que sean faciles de revisar y cambiar)
// ─────────────────────────────────────────────────────────────
// Maquinas: rangos de meses por categoria.
const RANGOS = {
  monedas: ['2021-04', '2025-10'],
  zapata: ['2024-07', '2025-10'],
  futbolin: ['2021-05', '2025-10'],
  peluches: ['2023-10', '2024-12'],
  torneos: ['2021-04', '2023-09'],
};
// Meses de 2025-11 en adelante donde el sistema solo tiene Chinos: se agregan Zapata y Futbolin
// (si el sistema YA tiene esa categoria en ese mes, la guardia de abajo la descarta).
const EXTRA_MESES = ['2025-11', '2025-12', '2026-01', '2026-04'];
const PAGOS_HASTA = '2026-03'; // el sistema tiene pagos desde 2026-04

// Plays: dos filas del Excel traen fecha de FEBRERO dentro de la hoja de MAYO 2022
// (son typos: en esa hoja faltan justo el 17 y el 18 de mayo).
const CORRECCION_FECHAS_PLAY = { '2022-02-17|Mayo': '2022-05-17', '2022-02-18|Mayo': '2022-05-18' };

// Pagos: clase del Excel -> servicio del sistema.
const SERVICIO_DE_CLASE = {
  luz: 'Luz', agua: 'Agua', internet: 'Internet', patente: 'Patente',
  aseo: 'Mantenimiento General', chapia: 'Mantenimiento General',
  insumos_helados: 'Otros', personal_otros: 'Otros', pago_personas: 'Otros', otros: 'Otros',
};
// Pagos que NO se cargan porque la misma plata ya entra como ACTIVO (doble conteo).
const EXCLUIR_PAGOS = [
  { re: /^pantalla xiaomi$/i, motivo: 'Cuotas de la Pantalla Xiaomi 65" (placa 34): el activo ya existe en el sistema por ₡353.000 (2024-08-30). Cargarlas como pago sumaria la pantalla dos veces.' },
  { re: /^regleta general electric$/i, motivo: 'Es la compra de la "Regleta General Electric" (₡5.450), que se carga como ACTIVO (fila 84 del inventario, fecha 2025-05-15 tomada de este gasto). El Excel la clasificaba como "luz" por error.' },
];

// Activos a agregar: las 56 filas de la hoja Inventario sin pareja en el sistema.
const FILAS_ACTIVOS = [6, 7, 8, 9, 10, 11, 12, 13, 20, 21, 22, 23, 52, 53, 54, 68, 69, 70, 71, 77, 78, 79, 82, 84, 85,
  94, 95, 96, 97, 98, 99, 100, 101, 103, 104, 105, 106, 107, 110, 111,
  124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139];
// Filas dudosas: NO se cargan.
const ACTIVOS_DUDOSOS = {
  12: '"Disco play 5" (₡50.000, Play 5) no dice que juego es y tiene el mismo costo que "Fifa 2022" (fila 13, Play 5); en Compras solo hay UNA compra de ₡50.000 para un juego PS5 (2021-09, "Juego fifa 2022"). Probable renglon repetido. Confirmar con el dueno antes de cargarlo.',
};
// Juegos del inventario: a que ficha del catalogo va cada uno.
//   existente: nombre de la ficha que YA esta en el catalogo (se liga, no se crea ficha)
//   nueva:     nombre de la ficha que se crearia (el juego no esta en el catalogo)
const JUEGOS = {
  6:  { nueva: 'Dragon Ball FighterZ', formato: 'Juegos físicos', nota: 'El Excel dice "Dragon Fighter Z".' },
  7:  { existente: 'Marvel Spiderman', formato: 'Juegos físicos', nota: '"Spyder - Man" PS4 = el Marvel\'s Spider-Man original; la ficha del catalogo es "Marvel Spiderman".' },
  8:  { existente: 'GTA V', formato: 'Juegos físicos', nota: 'El sistema tiene GTA V DIGITAL (placa 64, ₡10.871); este es el DISCO (formato distinto).' },
  9:  { nueva: 'Call of Duty Black Ops', formato: 'Juegos físicos', nota: 'DUDA: sin numero. El catalogo tiene Call of Duty 2 (Black Ops 2), 3, 4 y 6; este disco podria ser el Black Ops 1 o el 3 (ya existe "Call of Duty 3" digital). Confirmar.' },
  10: { existente: 'Resident Evil Village', formato: 'Juegos físicos', nota: '"Resident evil (village)" = ficha "Resident Evil Village".' },
  11: { existente: 'Gran turismo Sport', formato: 'Juegos físicos', nota: 'Misma ficha.' },
  13: { nueva: 'FIFA 22', formato: 'Juegos físicos', nota: 'Fifa 2022, disco PS5 (Compras 2021-09, ₡50.000).' },
  20: { nueva: 'FIFA 24', formato: 'Juegos digitales', nota: 'Fifa 2024 (Compras 2023-11: "4 Juegos Fiffa 2024").' },
  21: { nueva: 'FIFA 23', formato: 'Juegos digitales', nota: 'Fifa 2023 (Compras 2022-12: "Fifa 2023 ps4", ₡18.500).' },
  22: { existente: 'Mortal Kombat 11', formato: 'Juegos digitales', nota: 'Mortal Combat PS5 (Compras 2021-11, ₡14.000). El sistema ya tiene un MK11 digital (placa 62) de ₡5.000 de 2023-12: costo y fecha NO se parecen, por eso se agrega como compra aparte. Revisar.' },
  23: { existente: 'Kimetsu no Yaiba', formato: 'Juegos digitales', nota: 'Compras: 2023-04 ₡16.500 + 2023-10 actualizacion ₡2.930 = ₡19.430. El sistema no tiene ningun activo de este juego (solo la ficha).' },
};
// Renglones de juegos del Excel que NO se cargan, para la tabla de juegos.
const JUEGOS_FUERA = [
  { fila: 14, excel: 'Fifa FC 25 (JUEGOS EN DISCO)', ficha: 'FIFA 25 (existente)', resultado: 'DESCARTADO', motivo: 'Renglon duplicado de la fila 17 (mismos datos: ₡33.500, 2024-11-20). Compras tiene UNA sola compra ("FC 2025 PS4 y PS5", 2024-11) y el sistema una sola (placa 54 FIFA 25, digital, ₡33.251, 2024-11-20). El real es el DIGITAL.' },
  { fila: 17, excel: 'Fifa FC 25 (JUEGOS DIGITALES)', ficha: 'FIFA 25 (existente)', resultado: 'YA EXISTE', motivo: 'Activo placa 54 FIFA 25, digital, ₡33.251 vs ₡33.500, mismo dia.' },
  { fila: 18, excel: 'Dragon ball (Sparking Zero)', ficha: 'Dragon Ball Sparking Zero (existente)', resultado: 'YA EXISTE', motivo: 'Activo placa 56, ₡36.400, 2024-10-09.' },
  { fila: 19, excel: 'Mapas call of duty 3', ficha: 'Mapas call of duty 3 (existente, complemento)', resultado: 'YA EXISTE', motivo: 'Activo placa 55, ₡7.500 vs ₡7.800, fecha 18 dias de diferencia.' },
  { fila: 24, excel: 'Gta V (digital)', ficha: 'GTA V (existente)', resultado: 'YA EXISTE', motivo: 'Activo placa 64, ₡10.871 vs ₡10.965, 2023-07.' },
  { fila: 12, excel: 'Disco play 5', ficha: '(sin juego)', resultado: 'NO SE CARGA (dudoso)', motivo: ACTIVOS_DUDOSOS[12] },
];
// Nombre fijo para renglones cuyo nombre del Excel es ambiguo.
const NOMBRE_OVERRIDE = { 84: 'Regleta General Electric' };
// Fecha de compra tomada de otro bloque del Excel (no viene en el inventario).
const FECHA_ACTIVO_OVERRIDE = { 84: { fecha: '2025-05-15', nota: 'Fecha APROXIMADA: el gasto "Regleta general electric" esta en la hoja de mayo 2025 (sin dia).' } };

// ─────────────────────────────────────────────────────────────
// Comparacion de nombres (activos y juegos)
// ─────────────────────────────────────────────────────────────
const ROMANOS = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
const ALIAS = [
  [/\bgran thef auto\b|\bgrand theft auto\b/g, 'gta'], [/\bfive\b/g, '5'], [/\bea sports fc\b|\bea fc\b|\bfifa fc\b|\bfc\b/g, 'fifa'],
  [/\bcod\b/g, 'call of duty'], [/\bspyder\b/g, 'spider'], [/\bspiderman\b/g, 'spider man'], [/\bcombat\b/g, 'kombat'],
  [/\bblacks ops\b|\bbo\b/g, 'black ops'], [/\bfighter z\b|\bfighterz\b/g, 'fighterz'],
];
const STOP = new Set(['de', 'del', 'la', 'el', 'y', 'the', 'digital', 'disco', 'juego', 'juegos', 'play', 'ps4', 'ps5', 'con', 'para', 'sin', 'un', 'una']);
const tokens = (nombre) => {
  let s = normalizarNombre(nombre);
  for (const [re, to] of ALIAS) s = s.replace(re, to);
  return new Set(s.split(' ').filter((t) => t && !STOP.has(t)).map((t) => ROMANOS[t] || t).map((t) => (t === 'ii' ? '2' : t)));
};
const jaccard = (a, b) => {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
};
const claveJuego = (nombre) => [...tokens(nombre)].sort().join(' ');

// ─────────────────────────────────────────────────────────────
// Construccion del plan (puro: solo con el JSON)
// ─────────────────────────────────────────────────────────────
const mesesEnRango = (ini, fin) => {
  const out = [];
  let [y, m] = ini.split('-').map(Number);
  const [yf, mf] = fin.split('-').map(Number);
  while (y < yf || (y === yf && m <= mf)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
};

const buildPlayDoc = (fecha, tipo, ingreso, control) => {
  const controlAdicional = Math.min(2, Math.round(control / 200));
  const total = ingreso + control;
  return {
    fecha: fechaCR(fecha),
    cliente: 'Histórico',
    atendio: 'Histórico',
    tiempoPagado: 0, tiempoPendiente: 0,
    horaInicio: '00:00', horaFinal: '00:00',
    lugarDeJuego: tipo === 'Play 5' ? 'Play 5 número 1' : 'Play 4 número 1',
    tipoPlay: tipo,
    juegosJugados: [],
    totalControles: control > 0 ? Math.min(4, 2 + controlAdicional) : 2,
    controlAdicional,
    subtotal: ingreso, costoControles: control, total, montoPagado: total,
    totalPlay4: tipo === 'Play 4' ? ingreso : 0,
    totalPlay5: tipo === 'Play 5' ? ingreso : 0,
    totalPingPong: 0,
    estadoPago: 'Completado',
    finProgramado: null, notificacionFinEnviada: true, // nunca dispara WhatsApp
    origen: ORIGEN,
  };
};

const construirPlan = (datos) => {
  const plan = { plays: [], ganancias: [], pagos: [], pagosExcluidos: [], pagosEnCero: 0, activos: [], activosDescartados: [], advertencias: [], playsPorMesHoja: {} };

  // 1) PLAYS: un registro por dia (si el dia trae PS4 y PS5, uno por consola).
  const porDia = new Map();
  for (const p of datos.plays) {
    const fecha = CORRECCION_FECHAS_PLAY[`${p.fecha}|${p.hoja}`] || p.fecha;
    const k = fecha;
    const e = porDia.get(k) || { fecha, mes_hoja: p.mes_hoja, ps4: 0, ps5: 0, ctrl: 0 };
    e.ps4 += p.ps4; e.ps5 += p.ps5; e.ctrl += p.ctrl;
    porDia.set(k, e);
    plan.playsPorMesHoja[p.mes_hoja] = (plan.playsPorMesHoja[p.mes_hoja] || 0) + p.ps4 + p.ps5 + p.ctrl;
  }
  let dias2 = 0;
  for (const e of [...porDia.values()].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    if (e.ps4 > 0 && e.ps5 > 0) {
      plan.plays.push(buildPlayDoc(e.fecha, 'Play 4', e.ps4, e.ctrl));
      plan.plays.push(buildPlayDoc(e.fecha, 'Play 5', e.ps5, 0));
      dias2++;
    } else if (e.ps5 > 0) plan.plays.push(buildPlayDoc(e.fecha, 'Play 5', e.ps5, e.ctrl));
    else plan.plays.push(buildPlayDoc(e.fecha, 'Play 4', e.ps4, e.ctrl)); // incluye "sin desglose" y solo controles
  }
  plan.diasConPlays = porDia.size;
  plan.diasConDosConsolas = dias2;

  // 2-3) GANANCIAS: un registro por mes y tipo.
  const G = (tipo, mes, monto, desc) => {
    if (monto > 0) plan.ganancias.push({ tipo, monto, descripcion: desc, fecha: fechaCR(`${mes}-01`), origen: ORIGEN, mes });
  };
  const rm = datos.resumen_mes;
  for (const mes of mesesEnRango(...RANGOS.monedas)) G('Maquinas Chinos', mes, rm[mes]?.monedas || 0, `Cierre del mes ${mes} (Excel contabilidad): máquinas de monedas`);
  for (const mes of mesesEnRango(...RANGOS.zapata)) G('Maquinas Zapata', mes, rm[mes]?.zapata || 0, `Cierre del mes ${mes} (Excel contabilidad): máquina Zapata`);
  for (const mes of mesesEnRango(...RANGOS.futbolin)) G('Futbolin', mes, rm[mes]?.futbolin || 0, `Cierre del mes ${mes} (Excel contabilidad): futbolín`);
  for (const mes of mesesEnRango(...RANGOS.peluches)) G('Peluches', mes, rm[mes]?.peluches || 0, `Cierre del mes ${mes} (Excel contabilidad): máquina de peluches`);
  for (const mes of mesesEnRango(...RANGOS.torneos)) G('Torneos', mes, rm[mes]?.torneos || 0, `Torneos del mes ${mes} (Excel contabilidad)`);
  for (const mes of EXTRA_MESES) {
    G('Maquinas Zapata', mes, rm[mes]?.zapata || 0, `Cierre del mes ${mes} (Excel contabilidad): máquina Zapata`);
    G('Futbolin', mes, rm[mes]?.futbolin || 0, `Cierre del mes ${mes} (Excel contabilidad): futbolín`);
  }

  // 4) PAGOS
  for (const g of datos.gastos) {
    if (g.mes_hoja > PAGOS_HASTA) continue;
    if (!(g.monto > 0)) { plan.pagosEnCero++; continue; } // renglones en 0 (el modelo exige monto >= 1)
    const excl = EXCLUIR_PAGOS.find((x) => x.re.test(g.concepto));
    if (excl) { plan.pagosExcluidos.push({ ...g, motivo: excl.motivo }); continue; }
    const servicio = SERVICIO_DE_CLASE[g.clase] || 'Otros';
    const extra = g.fecha_raw && !/^\d{4}-\d{2}-\d{2}$/.test(g.fecha_raw) ? ` · indicado: ${g.fecha_raw}` : '';
    const fueraDeMes = g.fecha_raw && /^\d{4}-\d{2}-\d{2}$/.test(g.fecha_raw) && g.fecha_raw !== g.fecha ? ` · fecha del Excel ${g.fecha_raw} (fuera de la hoja)` : '';
    plan.pagos.push({
      servicio, monto: g.monto, fecha: fechaCR(g.fecha), origen: ORIGEN, mes: g.mes_hoja, clase: g.clase, concepto: g.concepto,
      descripcion: `${g.concepto} (Excel contabilidad ${g.mes_hoja}${extra}${fueraDeMes})`,
    });
  }

  // 5) ACTIVOS
  const inv = new Map(datos.activos_inventario.map((a) => [a.fila, a]));
  const candidatos = FILAS_ACTIVOS.map((f) => inv.get(f));
  if (candidatos.some((c) => !c)) throw new Error('Falta alguna fila del inventario en el JSON.');
  const cuentaBase = new Map();
  const baseNombre = (it) => (JUEGOS[it.fila] ? (JUEGOS[it.fila].existente || JUEGOS[it.fila].nueva) + (JUEGOS[it.fila].formato === 'Juegos físicos' ? ' (disco)' : '') : it.nombre.replace(/\s+/g, ' ').trim());
  for (const it of candidatos) cuentaBase.set(baseNombre(it), (cuentaBase.get(baseNombre(it)) || 0) + 1);
  const usados = new Set();
  for (const it of candidatos) {
    if (ACTIVOS_DUDOSOS[it.fila]) { plan.activosDescartados.push({ ...it, motivo: ACTIVOS_DUDOSOS[it.fila] }); continue; }
    const j = JUEGOS[it.fila];
    let nombre = baseNombre(it);
    if (NOMBRE_OVERRIDE[it.fila]) nombre = NOMBRE_OVERRIDE[it.fila];
    else if (cuentaBase.get(nombre) > 1) {
      const enNombre = (x) => x && normalizarNombre(nombre).includes(normalizarNombre(String(x)));
      const sufijo = [it.marca, it.proveedor, enNombre(it.carac) ? null : it.carac, it.compra].find((x) => x && String(x).trim());
      nombre = sufijo ? `${nombre} (${String(sufijo).trim()})` : nombre;
    }
    // si aun asi se repite, se desambigua con la fila del Excel
    if (usados.has(nombre)) nombre = `${nombre} (fila ${it.fila})`;
    usados.add(nombre);
    const ov = FECHA_ACTIVO_OVERRIDE[it.fila];
    const fechaIso = ov?.fecha || it.compra || null;
    const categoria = j ? j.formato : 'Otros';
    const desc = [it.carac, it.notas, it.marca && `Marca: ${it.marca}`, it.proveedor && `Proveedor: ${it.proveedor}`, it.serie && `Serie: ${it.serie}`].filter(Boolean).map((x) => String(x).trim()).join(' · ') || null;
    plan.activos.push({
      fila: it.fila, seccion: it.seccion, nombreExcel: it.nombre, nombre, categoria, costo: it.costo,
      fechaIso, fechaCompra: fechaIso ? fechaCR(fechaIso) : null,
      descripcion: desc,
      notas: `Importado del Excel de contabilidad (hoja Inventario, fila ${it.fila}), nombre original: "${it.nombre}".${ov ? ' ' + ov.nota : ''}${j?.nota ? ' ' + j.nota : ''}`,
      juego: j || null, origen: ORIGEN,
    });
  }
  return plan;
};

// ─────────────────────────────────────────────────────────────
// Lecturas de la base (SOLO lectura)
// ─────────────────────────────────────────────────────────────
const leerBase = async () => {
  const db = mongoose.connection.db;
  const [plays, ganancias, pagos, activos, juegos, counter, estados] = await Promise.all([
    db.collection('plays').aggregate([{ $group: { _id: { o: '$origen', m: { $dateToString: { format: '%Y-%m', date: '$fecha', timezone: 'America/Costa_Rica' } } }, n: { $sum: 1 }, t: { $sum: '$montoPagado' } } }]).toArray(),
    db.collection('ganancias').find().toArray(),
    db.collection('pagoservicios').find().toArray(),
    db.collection('activosalas').find().toArray(),
    db.collection('juegos').find().toArray(),
    db.collection('counters').findOne({ _id: CONTADOR_PLACA }),
    db.collection('estadoresultados').find().toArray(),
  ]);
  return { plays, ganancias, pagos, activos, juegos, counter, estados };
};

// Aplica guardias contra la base: descarta lo que el sistema ya tiene y cuenta lo ya importado.
const aplicarGuardias = (plan, base) => {
  const res = {
    plays: { insertar: [], yaImportados: 0, descartados: [] },
    ganancias: { insertar: [], yaImportados: 0, descartados: [] },
    pagos: { insertar: [], yaImportados: 0, descartados: [] },
    activos: { insertar: [], yaImportados: 0, descartados: [], comparacion: [] },
    fichas: { tabla: [], nuevas: [] },
  };
  // plays: guardia por mes
  const playsMesReal = new Set(base.plays.filter((x) => x._id.o !== ORIGEN).map((x) => x._id.m));
  const playsMesOrigen = Object.fromEntries(base.plays.filter((x) => x._id.o === ORIGEN).map((x) => [x._id.m, x.n]));
  const mesesDescPlays = new Set();
  const cuentaMesPlan = {};
  for (const p of plan.plays) { const m = mesKeyCR(p.fecha); cuentaMesPlan[m] = (cuentaMesPlan[m] || 0) + 1; }
  for (const p of plan.plays) {
    const m = mesKeyCR(p.fecha);
    if (playsMesReal.has(m)) { mesesDescPlays.add(m); res.plays.descartados.push({ mes: m, motivo: 'el sistema ya tiene plays en ese mes' }); continue; }
    res.plays.insertar.push(p);
  }
  // idempotencia por mes: si el mes ya tiene docs de origen, se cuentan y no se repiten
  const insertarPlays = [];
  for (const p of res.plays.insertar) {
    const m = mesKeyCR(p.fecha);
    if ((playsMesOrigen[m] || 0) >= cuentaMesPlan[m]) { res.plays.yaImportados++; continue; }
    insertarPlays.push(p);
  }
  // si el mes esta parcialmente importado, no se mezcla: se avisa
  for (const m of Object.keys(playsMesOrigen)) if (playsMesOrigen[m] < (cuentaMesPlan[m] || 0)) plan.advertencias.push(`Plays ${m}: importacion parcial previa (${playsMesOrigen[m]} de ${cuentaMesPlan[m]}); correr rollback antes de cargar.`);
  res.plays.insertar = insertarPlays;

  // ganancias: guardia por tipo + mes
  const gReal = new Set(base.ganancias.filter((x) => x.origen !== ORIGEN).map((x) => `${x.tipo}|${mesKeyCR(x.fecha)}`));
  const gOrigen = new Set(base.ganancias.filter((x) => x.origen === ORIGEN).map((x) => `${x.tipo}|${mesKeyCR(x.fecha)}`));
  for (const g of plan.ganancias) {
    const k = `${g.tipo}|${g.mes}`;
    if (gReal.has(k)) { res.ganancias.descartados.push({ ...g, motivo: 'el sistema ya tiene ese tipo de ganancia en ese mes' }); continue; }
    if (gOrigen.has(k)) { res.ganancias.yaImportados++; continue; }
    res.ganancias.insertar.push(g);
  }
  // pagos: guardia por mes (cualquier pago real en el mes)
  const pReal = new Set(base.pagos.filter((x) => x.origen !== ORIGEN).map((x) => mesKeyCR(x.fecha)));
  const pOrigen = new Map();
  for (const x of base.pagos.filter((y) => y.origen === ORIGEN)) { const k = `${mesKeyCR(x.fecha)}|${x.servicio}|${x.monto}|${x.descripcion}`; pOrigen.set(k, (pOrigen.get(k) || 0) + 1); }
  for (const p of plan.pagos) {
    if (pReal.has(p.mes)) { res.pagos.descartados.push({ ...p, motivo: 'el sistema ya tiene pagos en ese mes' }); continue; }
    const k = `${mesKeyCR(p.fecha)}|${p.servicio}|${p.monto}|${p.descripcion}`;
    if ((pOrigen.get(k) || 0) > 0) { pOrigen.set(k, pOrigen.get(k) - 1); res.pagos.yaImportados++; continue; }
    res.pagos.insertar.push(p);
  }

  // ── fichas de juego + comparacion de activos ──
  const fichas = base.juegos;
  const fichaPorClave = new Map(fichas.filter((f) => !f.padre).map((f) => [f.clave, f]));
  const fichaPorNombre = (n) => fichaPorClave.get(normalizarNombre(n));
  const activosSis = base.activos;
  const fichasNuevasVistas = new Set();
  const activosExistentesPorJuego = new Map();
  for (const a of activosSis) if (a.juegoId) { const k = String(a.juegoId); (activosExistentesPorJuego.get(k) || activosExistentesPorJuego.set(k, []).get(k)).push(a); }

  for (const a of plan.activos) {
    let ficha = null; let fichaEstado = null;
    if (a.juego) {
      if (a.juego.existente) {
        ficha = fichaPorNombre(a.juego.existente);
        fichaEstado = ficha ? `ficha EXISTENTE "${ficha.nombre}"` : null;
        if (!ficha) { res.activos.descartados.push({ ...a, motivo: `la ficha existente "${a.juego.existente}" ya no esta en el catalogo` }); continue; }
      } else {
        const ya = fichaPorNombre(a.juego.nueva);
        if (ya) { ficha = ya; fichaEstado = `ficha EXISTENTE "${ya.nombre}" (apareció en el catálogo)`; }
        else { fichaEstado = `ficha NUEVA "${a.juego.nueva}"`; if (!fichasNuevasVistas.has(normalizarNombre(a.juego.nueva))) { fichasNuevasVistas.add(normalizarNombre(a.juego.nueva)); res.fichas.nuevas.push(a.juego.nueva); } }
      }
      // revision automatica: otras fichas parecidas que no son la elegida
      const posibles = fichas.filter((f) => !f.padre && (!ficha || String(f._id) !== String(ficha._id)) && jaccard(a.juego.existente || a.juego.nueva, f.nombre) >= 0.6).map((f) => f.nombre);
      a.posiblesFichas = posibles;
    }
    a.fichaEstado = fichaEstado; a.fichaId = ficha ? ficha._id : null;

    // comparacion renglon por renglon contra TODOS los activos del sistema
    let mejor = null;
    for (const s of activosSis) {
      const score = Math.max(jaccard(a.nombre, s.nombre), jaccard(a.nombreExcel, s.nombre));
      const mismaFicha = ficha && s.juegoId && String(s.juegoId) === String(ficha._id);
      const sc = mismaFicha ? Math.max(score, 0.7) : score;
      if (!mejor || sc > mejor.score) mejor = { s, score: sc, mismaFicha };
    }
    const cmp = { fila: a.fila, nombre: a.nombre, categoria: a.categoria, costo: a.costo, fecha: a.fechaIso, mejor: null, veredicto: 'NUEVO' };
    if (mejor && mejor.score >= 0.34) {
      const s = mejor.s;
      const difCosto = Math.abs(s.costo - a.costo) / Math.max(s.costo, a.costo);
      const difDias = a.fechaCompra && s.fechaCompra ? dias(a.fechaCompra, s.fechaCompra) : null;
      cmp.mejor = { placa: s.numeroPlaca, nombre: s.nombre, categoria: s.categoria, costo: s.costo, fecha: s.fechaCompra ? s.fechaCompra.toISOString().slice(0, 10) : null, factura: s.numeroFactura || null, score: Math.round(mejor.score * 100) / 100, difCosto: Math.round(difCosto * 100), difDias: difDias === null ? null : Math.round(difDias) };
      const mismoFormato = s.categoria === a.categoria;
      if (mejor.score >= 0.6 && mismoFormato && difCosto <= 0.15 && (difDias === null || difDias <= 45)) cmp.veredicto = 'DUPLICADO';
      else cmp.veredicto = 'NUEVO (parecido, revisar)';
    }
    res.activos.comparacion.push(cmp);
    if (cmp.veredicto === 'DUPLICADO') { res.activos.descartados.push({ ...a, motivo: `ya existe: placa ${cmp.mejor.placa} "${cmp.mejor.nombre}" (costo ${R(cmp.mejor.costo)}, ${cmp.mejor.fecha})` }); continue; }
    // idempotencia
    const yaImp = activosSis.find((s) => s.origen === ORIGEN && s.nombre === a.nombre && s.costo === a.costo);
    if (yaImp) { res.activos.yaImportados++; continue; }
    res.activos.insertar.push(a);
  }
  // placas que se asignarian
  const maxPlaca = Math.max(0, ...activosSis.map((s) => s.numeroPlaca || 0));
  const seq = base.counter?.seq || 0;
  let siguiente = Math.max(seq, maxPlaca) + 1;
  const usadas = new Set(activosSis.map((s) => s.numeroPlaca).filter(Boolean));
  res.placas = { seq, maxPlaca, primera: siguiente, asignadas: [], choques: [] };
  for (const a of res.activos.insertar) {
    a.placaPropuesta = siguiente;
    res.placas.asignadas.push([siguiente, a.nombre]);
    if (usadas.has(siguiente)) res.placas.choques.push(siguiente);
    usadas.add(siguiente);
    siguiente++;
  }
  // fichas tabla (todas las del inventario)
  for (const f of JUEGOS_FUERA) res.fichas.tabla.push({ fila: f.fila, excel: f.excel, ficha: f.ficha, resultado: f.resultado, motivo: f.motivo });
  for (const a of plan.activos) {
    if (!a.juego) continue;
    const desc = res.activos.descartados.find((d) => d.fila === a.fila);
    const ins = res.activos.insertar.find((d) => d.fila === a.fila);
    res.fichas.tabla.push({
      fila: a.fila, excel: `${a.nombreExcel} (${a.categoria === 'Juegos físicos' ? 'disco' : 'digital'}, ${R(a.costo)})`,
      ficha: a.fichaEstado || '(sin ficha)',
      resultado: desc ? 'DESCARTADO' : ins ? (a.fichaEstado?.startsWith('ficha NUEVA') ? 'ACTIVO NUEVO + ficha nueva' : 'ACTIVO NUEVO ligado a ficha existente') : 'YA IMPORTADO',
      motivo: desc ? desc.motivo : (a.juego.nota + (a.posiblesFichas?.length ? ` Otras fichas parecidas: ${a.posiblesFichas.join(', ')}.` : '')),
    });
  }
  res.fichas.tabla.sort((x, y) => x.fila - y.fila);
  return res;
};

// ─────────────────────────────────────────────────────────────
// Estado de resultados: actual vs como quedaria
// ─────────────────────────────────────────────────────────────
const proyectarEstados = (g, base) => {
  const delta = {}; // mes -> { ing, serv, inv, plays, gan }
  const D = (m) => (delta[m] ||= { plays: 0, gan: 0, serv: 0, inv: 0 });
  for (const p of g.plays.insertar) D(mesKeyCR(p.fecha)).plays += p.montoPagado;
  for (const x of g.ganancias.insertar) D(x.mes).gan += x.monto;
  for (const x of g.pagos.insertar) D(mesKeyCR(x.fecha)).serv += x.monto;
  for (const a of g.activos.insertar) if (a.fechaCompra) D(mesKeyCR(a.fechaCompra)).inv += a.costo;
  const porMes = new Map(base.estados.map((e) => [`${e.año}-${String(e.mes).padStart(2, '0')}`, e]));
  const filas = [];
  for (const m of Object.keys(delta).sort()) {
    const d = delta[m]; const e = porMes.get(m);
    const cur = { ing: e?.totalIngresos || 0, egr: e?.totalEgresos || 0, uop: e?.utilidadOperativa || 0, uneta: e?.utilidadNeta || 0 };
    const dIng = d.plays + d.gan; const dEgr = d.serv + d.inv;
    const nuevo = { ing: cur.ing + dIng, egr: cur.egr + dEgr, uop: cur.uop + dIng - d.serv, uneta: cur.uneta + dIng - dEgr };
    filas.push({ mes: m, existe: !!e, cur, nuevo, d, dIng, dEgr });
  }
  return filas;
};

// ─────────────────────────────────────────────────────────────
// Conexion
// ─────────────────────────────────────────────────────────────
const conectar = async () => {
  if (!process.env.MONGO_URI) { console.error('Falta MONGO_URI en el .env.'); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  console.log('Conectado a MongoDB.');
};
const desconectar = async () => { await mongoose.disconnect(); };
const leerDatos = () => JSON.parse(fs.readFileSync(RUTA_JSON, 'utf8'));

// ─────────────────────────────────────────────────────────────
// Cuadre contra los totales del analisis previo
// ─────────────────────────────────────────────────────────────
const cuadrar = (datos, plan) => {
  const filas = [];
  const T = (tipo) => sum(plan.ganancias.filter((x) => x.tipo === tipo && x.mes <= '2025-10'), (x) => x.monto);
  const totPlays = sum(plan.plays, (p) => p.montoPagado);
  filas.push(['Plays 2021-03..2024-02', totPlays, ESPERADO.plays]);
  filas.push(['Chinos/monedas 2021-04..2025-10', T('Maquinas Chinos'), ESPERADO.monedas]);
  filas.push(['Zapata 2024-07..2025-10', T('Maquinas Zapata'), ESPERADO.zapata]);
  filas.push(['Futbolin 2021-05..2025-10', T('Futbolin'), ESPERADO.futbolin]);
  filas.push(['Peluches 2023-10..2024-12', sum(plan.ganancias.filter((x) => x.tipo === 'Peluches'), (x) => x.monto), ESPERADO.peluches]);
  filas.push(['Torneos 2021-04..2023-09', sum(plan.ganancias.filter((x) => x.tipo === 'Torneos'), (x) => x.monto), ESPERADO.torneos]);
  // pagos: items vs total de bloque Gastos de cada hoja (resumen_mes.gastos_total)
  const mesesPagos = [...new Set(datos.gastos.filter((g) => g.mes_hoja <= PAGOS_HASTA).map((g) => g.mes_hoja))].sort();
  const totalGastosHojas = sum(mesesPagos, (m) => datos.resumen_mes[m]?.gastos_total || 0);
  const totalItems = sum(datos.gastos.filter((g) => g.mes_hoja <= PAGOS_HASTA), (g) => g.monto);
  filas.push(['Gastos 2022-11..2026-03 (renglones vs Total de cada hoja)', totalItems, totalGastosHojas]);
  const totalPagos = sum(plan.pagos, (p) => p.monto) + sum(plan.pagosExcluidos, (p) => p.monto);
  filas.push(['Pagos cargados + excluidos vs renglones del Excel', totalPagos, totalItems]);
  const invTot = sum(datos.activos_inventario, (a) => a.costo);
  filas.push(['Inventario Excel (105 renglones) vs total de la hoja', invTot, ESPERADO.activosInventarioTotal]);
  const cand = sum(FILAS_ACTIVOS.map((f) => datos.activos_inventario.find((a) => a.fila === f)), (a) => a.costo);
  filas.push(['Activos candidatos (56) vs informe previo', cand, ESPERADO.activosAgregarCandidatos]);
  // plays por mes de hoja vs CSV
  const difPlays = [];
  for (const [m, v] of Object.entries(plan.playsPorMesHoja)) { const e = datos.resumen_mes[m]?.plays_total || 0; if (Math.abs(e - v) > 0.5) difPlays.push(`${m}: ${R(v)} vs ${R(e)}`); }
  return { filas, difPlays, ok: filas.every(([, a, b]) => Math.abs(a - b) < 0.5) && !difPlays.length };
};

// ─────────────────────────────────────────────────────────────
// prueba (dry-run): SOLO LECTURAS
// ─────────────────────────────────────────────────────────────
const cmdPrueba = async () => {
  const datos = leerDatos();
  const plan = construirPlan(datos);
  const cuadre = cuadrar(datos, plan);
  const base = await leerBase();
  const g = aplicarGuardias(plan, base);
  const estados = proyectarEstados(g, base);

  // comparar la base con sistema_activos.csv
  let notaCsv = 'sistema_activos.csv no encontrado.';
  if (fs.existsSync(RUTA_SISTEMA_ACTIVOS_CSV)) {
    const filas = fs.readFileSync(RUTA_SISTEMA_ACTIVOS_CSV, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/).slice(1).map((l) => l.split(';'));
    const csvMap = new Map(filas.map((c) => [Number(c[0]), { nombre: c[1], costo: Number(c[3]), fecha: c[5] }]));
    const dif = [];
    for (const s of base.activos) {
      const c = csvMap.get(s.numeroPlaca);
      if (!c) dif.push(`placa ${s.numeroPlaca} "${s.nombre}" esta en la base y no en el CSV`);
      else if (Math.abs(c.costo - s.costo) > 1 || c.nombre.trim() !== s.nombre.trim()) dif.push(`placa ${s.numeroPlaca}: CSV "${c.nombre}" ${c.costo} vs base "${s.nombre}" ${s.costo}`);
    }
    for (const p of csvMap.keys()) if (!base.activos.find((s) => s.numeroPlaca === p)) dif.push(`placa ${p} esta en el CSV y no en la base`);
    notaCsv = dif.length ? `Diferencias CSV vs base (${dif.length}): ${dif.join(' | ')}` : `CSV y base coinciden (${csvMap.size} activos, mismos nombres y costos).`;
  }

  // ── resumen ──
  const L = [];
  const P = (s = '') => L.push(s);
  const tabla = (head, rows) => { P('| ' + head.join(' | ') + ' |'); P('|' + head.map(() => '---').join('|') + '|'); for (const r of rows) P('| ' + r.map((c) => String(c ?? '').replace(/\|/g, '/')).join(' | ') + ' |'); P(); };
  P('# Importación de contabilidad — PRUEBA (dry-run)');
  P();
  P(`Generado: ${new Date().toISOString()}. **No se escribió nada en la base**: solo lecturas (find/aggregate).`);
  P(`Fuente: ${RUTA_JSON}`);
  P();
  P('## 1. Qué se agregaría, por categoría');
  P();
  const catRows = [];
  const cnt = (arr, f) => [arr.length, sum(arr, f)];
  const gt = (tipo, arr = g.ganancias.insertar) => cnt(arr.filter((x) => x.tipo === tipo), (x) => x.monto);
  catRows.push(['Plays (mar-2021 a feb-2024)', ...cnt(g.plays.insertar, (p) => p.montoPagado), `${plan.diasConPlays} días con juego; ${plan.diasConDosConsolas} días traen PS4 y PS5 y generan 2 registros`]);
  for (const t of ['Maquinas Chinos', 'Maquinas Zapata', 'Futbolin', 'Peluches', 'Torneos']) catRows.push([`Ganancias ${t}`, ...gt(t), '']);
  const porServ = {}; for (const p of g.pagos.insertar) { (porServ[p.servicio] ||= []).push(p); }
  catRows.push(['Pagos (todos los servicios)', ...cnt(g.pagos.insertar, (p) => p.monto), `${plan.pagosExcluidos.length} renglones excluidos por doble conteo (${R(sum(plan.pagosExcluidos, (p) => p.monto))})`]);
  catRows.push(['Activos (inventario)', ...cnt(g.activos.insertar, (a) => a.costo), `${g.activos.descartados.length} descartados, ${plan.activosDescartados.length} dudosos sin cargar`]);
  catRows.push(['Fichas de juego NUEVAS', g.fichas.nuevas.length, '', g.fichas.nuevas.join(', ')]);
  tabla(['Categoría', 'Registros', 'Total ₡', 'Nota'], catRows.map((r) => [r[0], r[1], typeof r[2] === 'number' ? R(r[2]) : r[2], r[3] ?? '']));
  P(`Ya importados antes (idempotencia, no se duplican): plays ${g.plays.yaImportados}, ganancias ${g.ganancias.yaImportados}, pagos ${g.pagos.yaImportados}, activos ${g.activos.yaImportados}.`);
  P();
  P('## 2. Cuadre contra los totales del análisis previo');
  P();
  tabla(['Concepto', 'Importación', 'Esperado', 'Diferencia'], cuadre.filas.map(([n, a, b]) => [n, R(a), R(b), R(a - b)]));
  P(cuadre.ok ? '**Todo cuadra (diferencia 0).**' : '**HAY DIFERENCIAS** (ver arriba).');
  if (cuadre.difPlays.length) P(`Plays por mes con diferencia contra el CSV: ${cuadre.difPlays.join('; ')}`);
  else P('Plays: cada uno de los 36 meses suma exactamente lo mismo que `contabilidad_por_mes.csv`.');
  P();
  P('Notas del cuadre:');
  P('- Los renglones de Excel con fecha equivocada: dos días de la hoja "Mayo" 2022 traían fecha 17 y 18 de FEBRERO (en esa hoja faltan justo el 17 y el 18 de mayo); se cargaron como 2022-05-17 y 2022-05-18. Total del mes sin cambio.');
  P('- Pagos: algunos montos tienen centavos (₡20.767,83 patente) y se cargan tal cual están en el Excel.');
  P();
  P('## 3. Descartado por ya existir en el sistema (guardias contra la base)');
  P();
  const descG = g.ganancias.descartados;
  if (!g.plays.descartados.length && !descG.length && !g.pagos.descartados.length) P('Nada de plays/ganancias/pagos coincide con datos reales del sistema, salvo lo de abajo.');
  for (const d of descG) P(`- Ganancia ${d.tipo} ${d.mes} ${R(d.monto)}: ${d.motivo}.`);
  if (g.plays.descartados.length) P(`- Plays: ${g.plays.descartados.length} registros descartados (${[...new Set(g.plays.descartados.map((d) => d.mes))].join(', ')}).`);
  if (g.pagos.descartados.length) P(`- Pagos: ${g.pagos.descartados.length} descartados (el sistema ya tiene pagos en esos meses).`);
  P(`- Plays: la base tiene ${base.plays.filter((x) => x._id.o !== ORIGEN && x._id.m < '2024-03').reduce((s, x) => s + x.n, 0)} plays antes de 2024-03 (confirmado: ninguno).`);
  P();
  P('**Lo que NO se carga por decisión (ver contexto):** ventas 2021-2025, ahorro, mayo 2026 (copia de abril), ping pong (₡45.300 de 2024-12 a 2025-10: probablemente ya está dentro de plays), abril y mayo 2026 de pagos (el sistema ya tiene pagos desde 2026-04).');
  P();
  P('## 4. Tabla por mes (lo que se agrega)');
  P();
  const meses = new Set();
  const M = {};
  const add = (m, k, v) => { meses.add(m); (M[m] ||= {})[k] = (M[m][k] || 0) + v; };
  for (const p of g.plays.insertar) add(mesKeyCR(p.fecha), 'plays', p.montoPagado);
  for (const x of g.ganancias.insertar) add(x.mes, { 'Maquinas Chinos': 'chinos', 'Maquinas Zapata': 'zapata', Futbolin: 'futbolin', Peluches: 'peluches', Torneos: 'torneos' }[x.tipo], x.monto);
  for (const x of g.pagos.insertar) add(mesKeyCR(x.fecha), 'pagos', x.monto);
  for (const a of g.activos.insertar) if (a.fechaCompra) add(mesKeyCR(a.fechaCompra), 'activos', a.costo);
  const keys = ['plays', 'chinos', 'zapata', 'futbolin', 'peluches', 'torneos', 'pagos', 'activos'];
  tabla(['Mes', 'Plays', 'Chinos', 'Zapata', 'Futbolín', 'Peluches', 'Torneos', 'Pagos', 'Activos (por fecha de compra)'],
    [...meses].sort().map((m) => [m, ...keys.map((k) => (M[m][k] ? R(M[m][k]) : '·'))]));
  const tot = Object.fromEntries(keys.map((k) => [k, sum([...meses], (m) => M[m][k] || 0)]));
  P(`Totales: ${keys.map((k) => `${k} ${R(tot[k])}`).join(' | ')}`);
  P(`Activos sin fecha de compra (no entran a ningún mes del estado de resultados): ${g.activos.insertar.filter((a) => !a.fechaCompra).length} (${R(sum(g.activos.insertar.filter((a) => !a.fechaCompra), (a) => a.costo))}).`);
  P();
  P('## 5. Estado de resultados: ACTUAL vs como QUEDARÍA');
  P();
  P('Cómo entra cada cosa (estadoResultadosController): plays y ganancias → ingresos; pagos → egresoServicios (egreso operativo); activos por **fechaCompra** → inversionActivos (suma a totalEgresos y a utilidad neta, NO a utilidad operativa). "Actual" sale de la colección `estadoresultados` (lectura). Meses sin documento hoy figuran en cero y se crearían al regenerar.');
  P();
  tabla(['Mes', 'Doc hoy', 'Ingresos hoy → quedaría', 'Egresos hoy → quedaría', 'Util. operativa hoy → quedaría', 'Util. neta hoy → quedaría', 'Cambio'],
    estados.map((e) => [e.mes, e.existe ? 'SÍ (cambia)' : 'no (mes nuevo)', `${R(e.cur.ing)} → ${R(e.nuevo.ing)}`, `${R(e.cur.egr)} → ${R(e.nuevo.egr)}`, `${R(e.cur.uop)} → ${R(e.nuevo.uop)}`, `${R(e.cur.uneta)} → ${R(e.nuevo.uneta)}`, `ing +${R(e.dIng)}, pagos +${R(e.d.serv)}, activos +${R(e.d.inv)}`]));
  const cambian = estados.filter((e) => e.existe);
  P(`**Meses que YA tienen estado de resultados y cambiarían: ${cambian.length}.** ${cambian.map((e) => `${e.mes} (${e.dIng ? 'ing +' + R(e.dIng) : ''}${e.d.serv ? ' pagos +' + R(e.d.serv) : ''}${e.d.inv ? ' activos +' + R(e.d.inv) : ''})`).join('; ')}.`);
  P();
  P('## 6. Pagos agrupados por servicio');
  P();
  tabla(['Servicio', 'Registros', 'Total'], Object.entries(porServ).map(([s, a]) => [s, a.length, R(sum(a, (x) => x.monto))]));
  P(`Se omitieron ${plan.pagosEnCero} renglones del Excel con monto 0 (aparecen como etiqueta repetida sin plata; el modelo exige monto >= 1). No cambian ningún total.`);
  P();
  P('Mapeo: luz→Luz, internet→Internet, patente→Patente, aseo y chapia→Mantenimiento General, el resto (gelatinas/conos, planes, universidad, préstamos, pagos a personas, varios)→Otros, con la descripción original del Excel. Fecha: la del Excel cuando es un día dentro de la hoja; si el Excel trae solo el mes o un día fuera de la hoja, se usa el 15 del mes de la hoja (queda anotado en la descripción).');
  P();
  const porClase = {};
  for (const p of g.pagos.insertar) { porClase[p.clase] = (porClase[p.clase] || 0) + p.monto; }
  tabla(['Clase del Excel', 'Total'], Object.entries(porClase).sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, R(v)]));
  P('### Doble conteo con activos (excluido de pagos)');
  P();
  tabla(['Mes', 'Concepto', 'Monto', 'Motivo'], plan.pagosExcluidos.map((p) => [p.mes_hoja, p.concepto, R(p.monto), p.motivo]));
  P(`Total excluido: ${R(sum(plan.pagosExcluidos, (p) => p.monto))} (Pantalla Xiaomi ${R(sum(plan.pagosExcluidos.filter((p) => /xiaomi/i.test(p.concepto)), (p) => p.monto))}; son ${plan.pagosExcluidos.filter((p) => /xiaomi/i.test(p.concepto)).length} cuotas mensuales, 2024-10 a 2026-03). Si el dueño prefiere cargarlas igual, se quita la regla \`EXCLUIR_PAGOS\` del script.`);
  P();
  P('Otros renglones de gastos que PARECEN compra de cosas pero se cargan como pago porque no hay activo equivalente en la lista de 56 (revisar si se quiere distinto):');
  const sospechosos = plan.pagos.filter((p) => /cable|regleta|reparar|repar|mueble|llavin|rotulos|bombillo|lampara|globo|tela/i.test(p.concepto));
  tabla(['Mes', 'Concepto', 'Monto', 'Comentario'], sospechosos.map((p) => [p.mes, p.concepto, R(p.monto), /cable cargar ps4/i.test(p.concepto) ? 'El activo "Cable para cargar controles PS4" de ₡4.000 del Excel es de 2023-08 (otra compra); este es de 2024-10, queda como pago' : /^regleta$/i.test(p.concepto) ? '₡5.600, 2025-10: podría ser una regleta; el inventario no trae una de ese monto/fecha, queda como pago' : /repar/i.test(p.concepto) ? 'reparación (egreso), no activo' : 'gasto menor']));
  P('## 7. Juegos: Excel → ficha del catálogo');
  P();
  tabla(['Fila Excel', 'Juego en el Excel', 'Ficha', 'Resultado', 'Motivo'], g.fichas.tabla.map((t) => [t.fila, t.excel, t.ficha, t.resultado, t.motivo]));
  P(`Fichas NUEVAS que se crearían (${g.fichas.nuevas.length}): ${g.fichas.nuevas.join(', ') || 'ninguna'}. Se comparó por clave normalizada (sin tildes/mayúsculas) y además por equivalencias (romanos/arábigos, FC/FIFA, COD/Call of Duty, etc.); las "otras fichas parecidas" que aparecen en el motivo son las que la comparación automática vio y se descartaron.`);
  P();
  P('## 8. Los 56 activos candidatos: comparación renglón por renglón contra el sistema');
  P();
  P(`Base leída: ${base.activos.length} activos. ${notaCsv}`);
  P();
  tabla(['Fila', 'Nombre', 'Categoría', 'Costo', 'Fecha', 'Parecido en el sistema (placa, nombre, costo, fecha, factura, dif.)', 'Veredicto'],
    g.activos.comparacion.map((c) => [c.fila, c.nombre, c.categoria, R(c.costo), c.fecha || '—',
      c.mejor ? `#${c.mejor.placa} ${c.mejor.nombre} · ${c.mejor.categoria} · ${R(c.mejor.costo)} · ${c.mejor.fecha || '—'} · factura ${c.mejor.factura || '—'} · costo ${c.mejor.difCosto}% · fecha ${c.mejor.difDias === null ? 'n/a' : c.mejor.difDias + 'd'} · sim ${c.mejor.score}` : '— (nada parecido)',
      plan.activosDescartados.find((d) => d.fila === c.fila) ? 'NO SE CARGA (dudoso)' : g.activos.descartados.find((d) => d.fila === c.fila) ? 'DUPLICADO, descartado' : c.veredicto]));
  P('**A cargar (' + g.activos.insertar.length + ')**: nombre, categoría, costo, fecha de compra, placa propuesta.');
  P();
  tabla(['Placa', 'Fila', 'Nombre', 'Categoría', 'Costo', 'Fecha compra', 'Descripción'], g.activos.insertar.map((a) => [`PLACA-${String(a.placaPropuesta).padStart(4, '0')}`, a.fila, a.nombre, a.categoria, R(a.costo), a.fechaIso || '—', a.descripcion || '']));
  P('### Doble conteo activos vs pagos');
  P();
  P('- Regleta General Electric (fila 84, ₡5.450): el Excel la anota como gasto "luz" 2025-05 y como inventario. Va como **ACTIVO** (fecha aprox. 2025-05-15) y NO como pago: es un bien duradero, y así entra a inversionActivos y no a servicios.');
  P('- Pantalla Xiaomi 65" (activo placa 34 ya existe, ₡353.000, 2024-08-30): sus cuotas del Excel no se cargan como pagos.');
  P('- El resto de las compras de activos del bloque Compras del Excel NO se carga como pago en ningún caso (esa hoja no se importa), así que no hay otra duplicación.');
  P();
  P('### Totales de control de activos');
  P();
  const sisTot = sum(base.activos, (a) => a.costo);
  const aAgregar = sum(g.activos.insertar, (a) => a.costo);
  const excelUnico = ESPERADO.activosInventarioTotal - ESPERADO.activosInventarioDuplicado;
  const noCargados = sum(plan.activosDescartados, (a) => a.costo) + sum(g.activos.descartados, (a) => a.costo);
  const sistemaPosterior = sum(base.activos.filter((a) => a.fechaCompra && a.fechaCompra >= new Date('2025-11-01T00:00:00Z')), (a) => a.costo);
  tabla(['Concepto', 'Monto'], [
    ['Activos del sistema hoy (' + base.activos.length + ')', R(sisTot)],
    ['+ A agregar (' + g.activos.insertar.length + ')', R(aAgregar)],
    ['= Sistema después de cargar', R(sisTot + aAgregar)],
    ['Inventario del Excel (total de la hoja)', R(ESPERADO.activosInventarioTotal)],
    ['− Fifa FC 25 duplicado', R(-ESPERADO.activosInventarioDuplicado)],
    ['= Inventario del Excel sin duplicado', R(excelUnico)],
    ['Diferencia (sistema después − Excel sin duplicado)', R(sisTot + aAgregar - excelUnico)],
  ]);
  const PLACAS_SOLO_SISTEMA = [63, 62, 61, 57, 58, 59, 60, 53, 52, 51, 50, 13, 23, 22, 24, 25, 44, 45, 48, 49, 66];
  const soloSis = sum(base.activos.filter((a) => PLACAS_SOLO_SISTEMA.includes(a.numeroPlaca)), (a) => a.costo);
  const excelPareado = excelUnico - ESPERADO.activosAgregarCandidatos;
  const sisPareado = sisTot - soloSis;
  P('**Conciliación exacta** (los 21 activos "solo en el sistema" son los del informe previo, placas ' + PLACAS_SOLO_SISTEMA.join(', ') + '):');
  P();
  tabla(['Concepto', 'Monto'], [
    ['Sistema hoy = pareados con el Excel + solo en el sistema', R(sisPareado) + ' + ' + R(soloSis) + ' = ' + R(sisTot)],
    ['Excel sin duplicado = pareados/dudosos + los 56 candidatos', R(excelPareado) + ' + ' + R(ESPERADO.activosAgregarCandidatos) + ' = ' + R(excelUnico)],
    ['Diferencia de costo entre lo pareado (Excel − sistema): controles que el Excel tiene de más/otro precio, desfases de factura', R(excelPareado - sisPareado)],
    ['Candidatos que NO se cargan (fila 12 dudosa)', R(noCargados)],
    ['Diferencia final = solo en sistema − dif. de lo pareado − no cargados', R(soloSis) + ' − ' + R(excelPareado - sisPareado) + ' − ' + R(noCargados) + ' = ' + R(soloSis - (excelPareado - sisPareado) - noCargados)],
    ['Diferencia calculada arriba (sistema después − Excel sin duplicado)', R(sisTot + aAgregar - excelUnico)],
  ]);
  P('Es decir: lo que el sistema tiene de más son los activos que el Excel nunca tuvo (compras de 2023-2026 de juegos digitales, DLC, GTA 6, EA FC 27, PS5 "yandrick", etc.), menos lo que el Excel tiene de más en controles. Nada queda sin explicar.');
  P();
  P('### Placas');
  P();
  P(`Contador \`numeroPlacaActivo\` = ${g.placas.seq}; placa máxima existente = ${g.placas.maxPlaca}; activos con placa: ${base.activos.filter((a) => a.numeroPlaca).length} de ${base.activos.length}. Se asignarían las placas **${g.placas.asignadas[0]?.[0] ?? '—'} a ${g.placas.asignadas.at(-1)?.[0] ?? '—'}** (${g.placas.asignadas.length}, consecutivas, tomadas con el mismo contador atómico que usa el sistema al crear un activo). Choques con placas existentes: ${g.placas.choques.length ? g.placas.choques.join(', ') : 'NINGUNO'}.`);
  P();
  P('## 9. Dudas / avisos');
  P();
  for (const w of plan.advertencias) P(`- ${w}`);
  P('- Los plays de antes de 2023-10 no traen consola: se cargan como **Play 4** (lugar "Play 4 número 1"). Desde 2023-10 se respeta PS4/PS5 (un registro por consola ese día).');
  P('- Plays: cliente y atendió = "Histórico" (igual que la migración anterior, inserción cruda sin validar el enum de empleados).');
  P('- Zapata 2025-11: el sistema ya tiene ₡42.000 (el Excel dice ₡5.000), así que NO se agrega; de los 4 meses extra solo se agregan las que el sistema no tiene.');
  P(`- Ganancias "extra" que sí se agregan en 2025-11, 2025-12, 2026-01 y 2026-04: ${g.ganancias.insertar.filter((x) => EXTRA_MESES.includes(x.mes) || x.mes >= '2025-11').map((x) => `${x.tipo} ${x.mes} ${R(x.monto)}`).join('; ')}.`);
  P('- Fecha de los gastos: ver sección 6. Fecha de las ganancias: día 1 del mes a medianoche de Costa Rica, igual que los cierres ya cargados en el sistema.');
  P('- Activos con fecha de compra en el Excel entran a los meses 2023-04, 2023-08, 2023-11, 2023-12, 2025-05 y 2025-10 del estado de resultados (ver sección 5): solo cambia utilidad neta, no la operativa.');
  const out = L.join('\n');
  fs.writeFileSync(RUTA_RESUMEN, out, 'utf8');
  console.log(out);
  console.log(`\nResumen escrito en: ${RUTA_RESUMEN}`);
  console.log('PRUEBA: no se escribió nada en la base.');
  return cuadre.ok;
};

// ─────────────────────────────────────────────────────────────
// backup (lee la base y escribe un archivo local)
// ─────────────────────────────────────────────────────────────
const mesesTocados = (g) => {
  const s = new Set();
  for (const p of g.plays.insertar) s.add(mesKeyCR(p.fecha));
  for (const x of g.ganancias.insertar) s.add(x.mes);
  for (const x of g.pagos.insertar) s.add(mesKeyCR(x.fecha));
  for (const a of g.activos.insertar) if (a.fechaCompra) s.add(mesKeyCR(a.fechaCompra));
  return [...s].sort();
};
const mesesDelPlanCompleto = (plan) => {
  const s = new Set();
  for (const p of plan.plays) s.add(mesKeyCR(p.fecha));
  for (const x of plan.ganancias) s.add(x.mes);
  for (const x of plan.pagos) s.add(mesKeyCR(x.fecha));
  for (const a of plan.activos) if (a.fechaCompra) s.add(mesKeyCR(a.fechaCompra));
  return [...s].sort();
};
const cmdBackup = async (mesesOpt) => {
  const datos = leerDatos();
  const plan = construirPlan(datos);
  const meses = mesesOpt || mesesDelPlanCompleto(plan);
  const orQuery = meses.map((m) => ({ año: Number(m.slice(0, 4)), mes: Number(m.slice(5)) }));
  const [reportes, estados, activosReport] = await Promise.all([
    MonthlyReport.find({ $or: orQuery }).lean(), EstadoResultados.find({ $or: orQuery }).lean(),
    mongoose.connection.db.collection('activosreports').find().toArray(),
  ]);
  const counter = await Counter.findById(CONTADOR_PLACA).lean();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destino = path.join(__dirname, `backup-contabilidad-${stamp}.json`);
  fs.writeFileSync(destino, JSON.stringify({ generadoEn: new Date().toISOString(), nota: 'Respaldo de reportes ANTES de importar la contabilidad. Los datos reales no se tocan.', meses, counterPlaca: counter, monthlyReports: reportes, estadosResultados: estados, activosReports: activosReport }, null, 2), 'utf8');
  console.log(`Respaldo escrito en: ${destino}`);
  console.log(`MonthlyReport: ${reportes.length} | EstadoResultados: ${estados.length} | ActivosReport: ${activosReport.length}`);
};

const regenerar = async (meses, mesesPlays) => {
  for (const m of mesesPlays) await regenerarReporteDeFecha(fechaCR(`${m}-01`));
  for (const m of meses) await regenerarEstadoDeMes(Number(m.slice(0, 4)), Number(m.slice(5)));
  await regenerarReporteActivos();
  console.log(`Reportes regenerados: ${mesesPlays.length} meses de plays, ${meses.length} estados de resultados, reporte de activos.`);
};

// ─────────────────────────────────────────────────────────────
// cargar — ESCRIBE
// ─────────────────────────────────────────────────────────────
const cmdCargar = async () => {
  const datos = leerDatos();
  const plan = construirPlan(datos);
  const cuadre = cuadrar(datos, plan);
  if (!cuadre.ok) { console.error('ABORTADO: el cuadre no da diferencia 0. No se inserto nada.'); cuadre.filas.forEach(([n, a, b]) => console.error(` ${n}: ${R(a)} vs ${R(b)}`)); process.exit(1); }
  const base = await leerBase();
  const g = aplicarGuardias(plan, base);
  if (g.placas.choques.length) { console.error('ABORTADO: las placas propuestas chocan: ' + g.placas.choques.join(', ')); process.exit(1); }
  const meses = mesesTocados(g);
  console.log(`A insertar: plays ${g.plays.insertar.length}, ganancias ${g.ganancias.insertar.length}, pagos ${g.pagos.insertar.length}, activos ${g.activos.insertar.length}, fichas nuevas ${g.fichas.nuevas.length}`);
  await cmdBackup(meses);

  // plays: insercion cruda (enum de empleados), igual que la migracion anterior
  if (g.plays.insertar.length) { const r = await Play.collection.insertMany(g.plays.insertar.map((p) => ({ ...p, createdAt: p.fecha, updatedAt: p.fecha }))); console.log(`Plays insertados: ${r.insertedCount}`); }
  if (g.ganancias.insertar.length) { const r = await Ganancia.insertMany(g.ganancias.insertar.map(({ mes, ...x }) => x)); console.log(`Ganancias insertadas: ${r.length}`); }
  if (g.pagos.insertar.length) { const r = await PagoServicio.insertMany(g.pagos.insertar.map(({ mes, clase, concepto, ...x }) => x)); console.log(`Pagos insertados: ${r.length}`); }

  // fichas nuevas
  const fichaPorClave = new Map((await Juego.find({ padre: null }).lean()).map((f) => [f.clave, f]));
  for (const nombre of g.fichas.nuevas) {
    const clave = normalizarNombre(nombre);
    if (fichaPorClave.has(clave)) continue;
    const f = await Juego.create({ nombre, clave, padre: null, origen: ORIGEN, enVitrina: false });
    fichaPorClave.set(clave, f.toObject());
    console.log(`Ficha creada: ${nombre}`);
  }
  // activos: placa con el mismo contador atomico que usa el sistema
  const ultimo = await ActivoSala.findOne({ numeroPlaca: { $ne: null } }).sort({ numeroPlaca: -1 }).select('numeroPlaca').lean();
  await fijarSecuenciaMinima(CONTADOR_PLACA, ultimo?.numeroPlaca || 0);
  for (const a of g.activos.insertar) {
    const ficha = a.juego ? (a.fichaId ? { _id: a.fichaId } : fichaPorClave.get(normalizarNombre(a.juego.nueva))) : null;
    const doc = new ActivoSala({
      numeroPlaca: await siguienteSecuencia(CONTADOR_PLACA), nombre: a.nombre, categoria: a.categoria, costo: a.costo,
      estado: 'En uso', estadoOverride: null, juegoId: ficha?._id || null, descripcion: a.descripcion, notas: a.notas,
      fechaCompra: a.fechaCompra, reparaciones: [], origen: ORIGEN,
    });
    try { await doc.save(); } catch (err) {
      if (err?.code === 11000 && err?.keyPattern?.numeroPlaca) { const u = await ActivoSala.findOne({ numeroPlaca: { $ne: null } }).sort({ numeroPlaca: -1 }).select('numeroPlaca').lean(); await fijarSecuenciaMinima(CONTADOR_PLACA, u?.numeroPlaca || 0); doc.numeroPlaca = await siguienteSecuencia(CONTADOR_PLACA); await doc.save(); } else throw err;
    }
    console.log(`Activo #${doc.numeroPlaca}: ${a.nombre}`);
  }
  const mesesPlays = [...new Set(g.plays.insertar.map((p) => mesKeyCR(p.fecha)))].sort();
  await regenerar(meses, mesesPlays);
  await cmdVerificar();
};

// ─────────────────────────────────────────────────────────────
// verificar — totales importados vs esperados
// ─────────────────────────────────────────────────────────────
const cmdVerificar = async () => {
  const datos = leerDatos(); const plan = construirPlan(datos);
  const tot = async (M, campo, extra = {}) => { const [r] = await M.aggregate([{ $match: { origen: ORIGEN, ...extra } }, { $group: { _id: null, t: { $sum: `$${campo}` }, n: { $sum: 1 } } }]); return { t: r?.t || 0, n: r?.n || 0 }; };
  const rows = [];
  const p = await tot(Play, 'montoPagado'); rows.push(['Plays', p.n, p.t, sum(plan.plays, (x) => x.montoPagado)]);
  for (const t of ['Maquinas Chinos', 'Maquinas Zapata', 'Futbolin', 'Peluches', 'Torneos']) { const x = await tot(Ganancia, 'monto', { tipo: t }); rows.push([`Ganancias ${t}`, x.n, x.t, null]); }
  const pg = await tot(PagoServicio, 'monto'); rows.push(['Pagos', pg.n, pg.t, sum(plan.pagos, (x) => x.monto)]);
  const ac = await tot(ActivoSala, 'costo'); rows.push(['Activos', ac.n, ac.t, sum(plan.activos, (x) => x.costo)]);
  console.log('\nVERIFICACION (origen=excel_contabilidad):');
  for (const [n, c, t, e] of rows) console.log(` ${n}: ${c} registros, ${R(t)}${e !== null ? `  | plan ${R(e)} ${Math.abs(e - t) < 0.5 ? 'OK' : 'DIFIERE (puede ser por guardias: lo descartado no se inserta)'}` : ''}`);
};

// ─────────────────────────────────────────────────────────────
// rollback — borra SOLO origen 'excel_contabilidad'
// ─────────────────────────────────────────────────────────────
const cmdRollback = async () => {
  const datos = leerDatos(); const plan = construirPlan(datos);
  const meses = mesesDelPlanCompleto(plan);
  const mesesPlays = [...new Set(plan.plays.map((p) => mesKeyCR(p.fecha)))].sort();
  const a = await Play.collection.deleteMany({ origen: ORIGEN });
  const b = await Ganancia.deleteMany({ origen: ORIGEN });
  const c = await PagoServicio.deleteMany({ origen: ORIGEN });
  const d = await ActivoSala.deleteMany({ origen: ORIGEN });
  console.log(`Borrados: plays ${a.deletedCount}, ganancias ${b.deletedCount}, pagos ${c.deletedCount}, activos ${d.deletedCount}`);
  // fichas creadas por la importacion: solo si ningun activo (de cualquier origen) las usa
  let borradas = 0;
  for (const f of await Juego.find({ origen: ORIGEN }).lean()) {
    const usos = await ActivoSala.countDocuments({ juegoId: f._id });
    if (usos === 0) { await Juego.deleteOne({ _id: f._id }); borradas++; } else console.log(`Ficha "${f.nombre}" se conserva: la usan ${usos} activos.`);
  }
  console.log(`Fichas de juego borradas: ${borradas}`);
  console.log('Nota: el contador de placas no se baja (las placas quedan con huecos; es inocuo y evita choques).');
  await regenerar(meses, mesesPlays);
  console.log('Rollback completo.');
};

// ─────────────────────────────────────────────────────────────
const COMANDOS = { prueba: cmdPrueba, backup: () => cmdBackup(), verificar: cmdVerificar, cargar: cmdCargar, rollback: cmdRollback };

const run = async () => {
  const cmd = (process.argv[2] || '').toLowerCase();
  const fn = COMANDOS[cmd];
  if (!fn) { console.error('Uso: node scripts/importarContabilidadExcel.js <prueba|backup|verificar|cargar|rollback> [rutaJson] [rutaResumen.md]'); process.exit(1); }
  await conectar();
  try { await fn(); } finally { await desconectar(); }
};

run().catch((err) => { console.error('Error en la importacion:', err); process.exit(1); });
