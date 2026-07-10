// scripts/migrarHistoricoExcel.js
// Hecho por Claude Code — Migración del histórico mensual del Excel (mar 2024 – feb 2026).
//
// QUÉ HACE
//   Inserta los cierres mensuales históricos como registros `Play` sintéticos
//   marcados con origen='excel_historico' (uno por rubro/mes: Play 4, Play 5,
//   Ping Pong y Controles). Estos plays NO son sesiones reales: son agregados
//   del mes. Fluyen solos hacia el reporte mensual de plays, la ganancia por
//   consola, el comparativo anual y el estado de resultados, usando la MISMA
//   lógica de agregación que ya existe (no se toca ningún generador de reportes).
//
// DECISIONES APLICADAS (confirmadas con el dueño)
//   - Se migran totales por rubro, no sesión por sesión.
//   - Helados/gelatinas: OMITIDOS (no calzan en Play ni en Ganancia).
//   - Los ₡4.500 reales de feb 2026 NO se tocan: feb 2026 queda en ₡104.350.
//   - Moneda: colones enteros.
//
// SEGURIDAD
//   - No modifica ni borra plays reales: solo AGREGA docs con el flag.
//   - Idempotente: `migrar` borra primero los excel_historico de esos meses y
//     los re-inserta, así correrlo dos veces nunca duplica.
//   - `backup` guarda los reportes existentes de los meses afectados antes de
//     regenerarlos, y `rollback` borra solo lo migrado y recalcula.
//
// USO (desde la raíz del proyecto, con el .env que apunta a la base):
//   node scripts/migrarHistoricoExcel.js backup      # respaldo previo (SIEMPRE primero)
//   node scripts/migrarHistoricoExcel.js verificar   # ver totales actuales vs checksums
//   node scripts/migrarHistoricoExcel.js migrar      # inserta + regenera reportes + verifica
//   node scripts/migrarHistoricoExcel.js rollback    # borra lo migrado + regenera reportes
//
// Requiere en el .env: MONGO_URI.

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

import Play from '../models/plays.js';
import MonthlyReport from '../models/Monthlyplaysreport.js';
import EstadoResultados from '../models/EstadoResultados.js';
import { regenerarReporteDeFecha } from '../controllers/playsController.js';
import { regenerarEstadoDeMes } from '../controllers/estadoResultadosController.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────
// Constantes de la migración
// ─────────────────────────────────────────────────────────────
const ORIGEN   = 'excel_historico';
const ATENDIO  = 'Histórico';                 // agrupa todo lo migrado en un solo "empleado"
const CLIENTE  = 'Cierre mensual (Excel)';
const CONTROL_PRECIO = 200;                   // ₡ por control cobrado (para estimar el conteo)

// Checksum de la migración (suma de plays de mar 2024 – feb 2026, sin helados).
const CHECKSUM_PLAYS = 3516535;

// Datos auditados del Excel. total_plays = adicional + play4 + play5 + pingpong.
const DATA = [
  { mes: '2024-03', adicional: 3600,  play4: 76050,  play5: 0,     pingpong: 0,    total_plays: 79650 },
  { mes: '2024-04', adicional: 4800,  play4: 98450,  play5: 0,     pingpong: 0,    total_plays: 103250 },
  { mes: '2024-05', adicional: 12100, play4: 156485, play5: 0,     pingpong: 0,    total_plays: 168585 },
  { mes: '2024-06', adicional: 8200,  play4: 136600, play5: 0,     pingpong: 0,    total_plays: 144800 },
  { mes: '2024-07', adicional: 11150, play4: 229700, play5: 0,     pingpong: 0,    total_plays: 240850 },
  { mes: '2024-08', adicional: 16600, play4: 248550, play5: 0,     pingpong: 0,    total_plays: 265150 },
  { mes: '2024-09', adicional: 13200, play4: 191750, play5: 0,     pingpong: 0,    total_plays: 204950 },
  { mes: '2024-10', adicional: 12200, play4: 213000, play5: 0,     pingpong: 0,    total_plays: 225200 },
  { mes: '2024-11', adicional: 11000, play4: 207800, play5: 0,     pingpong: 0,    total_plays: 218800 },
  { mes: '2024-12', adicional: 6400,  play4: 113800, play5: 28500, pingpong: 3000, total_plays: 151700 },
  { mes: '2025-01', adicional: 3200,  play4: 130300, play5: 26400, pingpong: 10100,total_plays: 170000 },
  { mes: '2025-02', adicional: 4600,  play4: 96200,  play5: 25900, pingpong: 6700, total_plays: 133400 },
  { mes: '2025-03', adicional: 7600,  play4: 102050, play5: 44500, pingpong: 6000, total_plays: 160150 },
  { mes: '2025-04', adicional: 4200,  play4: 72800,  play5: 33600, pingpong: 1400, total_plays: 112000 },
  { mes: '2025-05', adicional: 5400,  play4: 79600,  play5: 45100, pingpong: 1600, total_plays: 131700 },
  { mes: '2025-06', adicional: 2600,  play4: 99750,  play5: 39800, pingpong: 3300, total_plays: 145450 },
  { mes: '2025-07', adicional: 4200,  play4: 73650,  play5: 32200, pingpong: 0,    total_plays: 110050 },
  { mes: '2025-08', adicional: 1600,  play4: 52600,  play5: 25050, pingpong: 7600, total_plays: 86850 },
  { mes: '2025-09', adicional: 1200,  play4: 71000,  play5: 35000, pingpong: 3800, total_plays: 111000 },
  { mes: '2025-10', adicional: 2600,  play4: 70500,  play5: 65300, pingpong: 2200, total_plays: 140600 },
  { mes: '2025-11', adicional: 2400,  play4: 37100,  play5: 96150, pingpong: 2800, total_plays: 138450 },
  { mes: '2025-12', adicional: 2800,  play4: 36500,  play5: 52950, pingpong: 2050, total_plays: 94300 },
  { mes: '2026-01', adicional: 2400,  play4: 26900,  play5: 48900, pingpong: 1600, total_plays: 79800 },
  { mes: '2026-02', adicional: 3600,  play4: 54800,  play5: 39700, pingpong: 1750, total_plays: 99850 },
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

// Día 1 del mes a medianoche de Costa Rica (06:00 UTC) — misma convención que
// dateUtils.crearFechaParaMes para meses pasados. Cae dentro del filtro del mes
// en AMBOS generadores de reportes.
const fechaDelMes = (anio, mes) => new Date(Date.UTC(anio, mes - 1, 1, 6, 0, 0, 0));

const parseMes = (clave) => clave.split('-').map(Number); // '2024-03' → [2024, 3]

// Plantilla común de un play sintético.
const basePlay = (fecha) => ({
  fecha,
  cliente: CLIENTE,
  atendio: ATENDIO,
  tiempoPagado: 0,
  tiempoPendiente: 0,
  horaInicio: '00:00',
  horaFinal: '00:00',
  juegosJugados: [],
  estadoPago: 'Completado',
  finProgramado: null,          // nunca dispara notificación
  notificacionFinEnviada: true, // idem
  origen: ORIGEN,
  createdAt: fecha,
  updatedAt: fecha,
});

// Construye los docs Play de un mes (uno por rubro con monto > 0).
// Reparto de montos que garantiza que los reportes cuadren:
//   - Cada rubro de consola: subtotal = total = montoPagado = monto del rubro,
//     y su bucket (totalPlay4/5/PingPong) = ese monto. costoControles = 0.
//   - Controles: costoControles = total = montoPagado = adicional, subtotal = 0
//     y buckets = 0 (así NO entra en totalPlay4/5/PingPong, pero SÍ en
//     totalRecaudado y en totalCostosControles). El conteo controlAdicional es
//     estimado (adicional / 200) — es solo un número informativo; la plata exacta
//     vive en costoControles.
const buildPlaysDelMes = (row) => {
  const [anio, mes] = parseMes(row.mes);
  const fecha = fechaDelMes(anio, mes);
  const docs = [];

  if (row.play4 > 0) {
    docs.push({
      ...basePlay(fecha),
      lugarDeJuego: 'Play 4 número 1', tipoPlay: 'Play 4',
      totalControles: 2, controlAdicional: 0,
      subtotal: row.play4, costoControles: 0, total: row.play4, montoPagado: row.play4,
      totalPlay4: row.play4, totalPlay5: 0, totalPingPong: 0,
    });
  }
  if (row.play5 > 0) {
    docs.push({
      ...basePlay(fecha),
      lugarDeJuego: 'Play 5 número 1', tipoPlay: 'Play 5',
      totalControles: 2, controlAdicional: 0,
      subtotal: row.play5, costoControles: 0, total: row.play5, montoPagado: row.play5,
      totalPlay4: 0, totalPlay5: row.play5, totalPingPong: 0,
    });
  }
  if (row.pingpong > 0) {
    docs.push({
      ...basePlay(fecha),
      lugarDeJuego: 'Ping Pong', tipoPlay: 'Ping Pong',
      totalControles: 2, controlAdicional: 0,
      subtotal: row.pingpong, costoControles: 0, total: row.pingpong, montoPagado: row.pingpong,
      totalPlay4: 0, totalPlay5: 0, totalPingPong: row.pingpong,
    });
  }
  if (row.adicional > 0) {
    const conteoEstimado = Math.round(row.adicional / CONTROL_PRECIO);
    docs.push({
      ...basePlay(fecha),
      lugarDeJuego: 'Play 4 número 1', tipoPlay: 'Play 4',
      totalControles: 2, controlAdicional: conteoEstimado, // conteo informativo (estimado)
      subtotal: 0, costoControles: row.adicional, total: row.adicional, montoPagado: row.adicional,
      totalPlay4: 0, totalPlay5: 0, totalPingPong: 0,      // los controles no van a los buckets
    });
  }
  return docs;
};

const conectar = async () => {
  if (!process.env.MONGO_URI) {
    console.error('❌ Falta MONGO_URI en el .env.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  console.log('✅ Conectado a MongoDB.');
};

const desconectar = async () => { await mongoose.disconnect(); };

// Regenera AMBOS reportes (plays + estado de resultados) de cada mes de la data.
const regenerarTodosLosMeses = async () => {
  for (const row of DATA) {
    const [anio, mes] = parseMes(row.mes);
    const fecha = fechaDelMes(anio, mes);
    await regenerarReporteDeFecha(fecha);   // reporte mensual de plays / ganancia por consola
    await regenerarEstadoDeMes(anio, mes);  // estado de resultados
  }
  console.log(`🔁 Reportes regenerados para ${DATA.length} meses.`);
};

// ─────────────────────────────────────────────────────────────
// Comando: backup
// ─────────────────────────────────────────────────────────────
const cmdBackup = async () => {
  const meses = DATA.map((r) => {
    const [año, mes] = parseMes(r.mes);
    return { año, mes };
  });
  const orQuery = meses.map((m) => ({ año: m.año, mes: m.mes }));

  const [reportesPlays, estados, conteoMigrados] = await Promise.all([
    MonthlyReport.find({ $or: orQuery }).lean(),
    EstadoResultados.find({ $or: orQuery }).lean(),
    Play.countDocuments({ origen: ORIGEN }),
  ]);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destino = path.join(__dirname, `backup-historico-${stamp}.json`);
  const payload = {
    generadoEn: new Date().toISOString(),
    nota: 'Respaldo de reportes de los 24 meses afectados ANTES de migrar. Los plays reales no se tocan; para restaurar reportes, reinsertar estos docs o correr rollback.',
    plays_excel_historico_existentes: conteoMigrados,
    monthlyReports: reportesPlays,
    estadosResultados: estados,
  };
  fs.writeFileSync(destino, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`💾 Respaldo escrito en: ${destino}`);
  console.log(`   MonthlyReport respaldados:      ${reportesPlays.length}`);
  console.log(`   EstadoResultados respaldados:   ${estados.length}`);
  console.log(`   Plays excel_historico ya en BD: ${conteoMigrados}`);
};

// ─────────────────────────────────────────────────────────────
// Comando: migrar
// ─────────────────────────────────────────────────────────────
const cmdMigrar = async () => {
  // 1) Idempotencia: borrar cualquier excel_historico previo de esos meses.
  const del = await Play.deleteMany({ origen: ORIGEN });
  if (del.deletedCount > 0) {
    console.log(`♻️  Borrados ${del.deletedCount} plays excel_historico previos (re-migración limpia).`);
  }

  // 2) Insertar los sintéticos. Insert RAW (.collection) para saltar la
  //    validación de enums de Mongoose (atendio='Histórico', etc.), igual que
  //    el patrón usado en otras migraciones del proyecto.
  const docs = DATA.flatMap(buildPlaysDelMes);
  const res = await Play.collection.insertMany(docs);
  console.log(`✅ Insertados ${res.insertedCount} plays sintéticos (${DATA.length} meses).`);

  // 3) Regenerar reportes de los 24 meses.
  await regenerarTodosLosMeses();

  // 4) Verificación.
  await cmdVerificar();
};

// ─────────────────────────────────────────────────────────────
// Comando: verificar
// ─────────────────────────────────────────────────────────────
const cmdVerificar = async () => {
  // Totales de lo MIGRADO (por año y gran total) vs checksum.
  const porAnio = await Play.aggregate([
    { $match: { origen: ORIGEN } },
    { $group: {
        _id: { $year: { date: '$fecha', timezone: 'America/Costa_Rica' } },
        montoPagado: { $sum: '$montoPagado' },
        play4: { $sum: '$totalPlay4' },
        play5: { $sum: '$totalPlay5' },
        pingpong: { $sum: '$totalPingPong' },
        controles: { $sum: '$costoControles' },
        docs: { $sum: 1 },
    } },
    { $sort: { _id: 1 } },
  ]);

  console.log('\n📊 MIGRADO (origen=excel_historico) por año:');
  let granTotal = 0;
  for (const a of porAnio) {
    granTotal += a.montoPagado;
    console.log(
      `   ${a._id}: ₡${a.montoPagado.toLocaleString('es-CR')}  ` +
      `(P4 ₡${a.play4.toLocaleString('es-CR')} | P5 ₡${a.play5.toLocaleString('es-CR')} | ` +
      `PP ₡${a.pingpong.toLocaleString('es-CR')} | Ctrl ₡${a.controles.toLocaleString('es-CR')} | ${a.docs} docs)`
    );
  }
  console.log(`   ─────────────────────────────────`);
  console.log(`   TOTAL migrado: ₡${granTotal.toLocaleString('es-CR')}`);
  console.log(`   Checksum esp.: ₡${CHECKSUM_PLAYS.toLocaleString('es-CR')}`);
  console.log(granTotal === CHECKSUM_PLAYS
    ? '   ✅ CHECKSUM OK — coincide exacto.'
    : `   ❌ CHECKSUM NO COINCIDE (diferencia ₡${(granTotal - CHECKSUM_PLAYS).toLocaleString('es-CR')}).`);

  // Muestra el total que verá el sistema en el reporte mensual por año (incluye
  // plays reales — feb 2026 debe dar ₡104.350 = 99.850 migrados + 4.500 reales).
  const años = [...new Set(DATA.map((r) => parseMes(r.mes)[0]))];
  console.log('\n📅 Reporte mensual de plays (lo que verá el sistema, incluye plays reales):');
  for (const año of años) {
    const reps = await MonthlyReport.find({ año }).select('mes totalRecaudado').sort({ mes: 1 }).lean();
    const totalAño = reps.reduce((s, r) => s + (r.totalRecaudado || 0), 0);
    console.log(`   ${año}: ₡${totalAño.toLocaleString('es-CR')} (${reps.length} meses con reporte)`);
  }

  // Verificación puntual de feb 2026 (el caso especial de los ₡4.500).
  const feb2026 = await MonthlyReport.findOne({ año: 2026, mes: 2 }).select('totalRecaudado').lean();
  if (feb2026) {
    console.log(`\n🔎 Febrero 2026 (esperado ₡104.350): ₡${(feb2026.totalRecaudado || 0).toLocaleString('es-CR')}`);
  }
};

// ─────────────────────────────────────────────────────────────
// Comando: rollback
// ─────────────────────────────────────────────────────────────
const cmdRollback = async () => {
  const del = await Play.deleteMany({ origen: ORIGEN });
  console.log(`🗑️  Borrados ${del.deletedCount} plays excel_historico.`);

  // Regenerar reportes de los 24 meses para que reflejen SOLO los datos reales.
  await regenerarTodosLosMeses();
  console.log('✅ Rollback completo. Los reportes quedan con los datos reales únicamente.');
};

// ─────────────────────────────────────────────────────────────
// Entrada
// ─────────────────────────────────────────────────────────────
const COMANDOS = { backup: cmdBackup, migrar: cmdMigrar, verificar: cmdVerificar, rollback: cmdRollback };

const run = async () => {
  const cmd = (process.argv[2] || '').toLowerCase();
  const fn = COMANDOS[cmd];
  if (!fn) {
    console.error('Uso: node scripts/migrarHistoricoExcel.js <backup|verificar|migrar|rollback>');
    process.exit(1);
  }
  await conectar();
  try {
    await fn();
  } finally {
    await desconectar();
  }
};

run().catch((err) => {
  console.error('❌ Error en la migración:', err);
  process.exit(1);
});
