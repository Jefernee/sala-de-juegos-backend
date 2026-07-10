// scripts/migrarHistoricoExcel.js
// Hecho por Claude Code — Migración del histórico del Excel (mar 2024 – feb 2026).
//
// QUÉ HACE
//   Lee "Sala de juegos Oficial.xlsx" e inserta CADA sesión histórica como un
//   registro `Play` real, marcado con origen='excel_historico'. Con esto los
//   reportes de plays quedan 100% reales (sesiones, por día, por empleado,
//   juegos, ganancia por consola) y fluyen solos hacia el reporte mensual, el
//   comparativo anual y el estado de resultados, usando la MISMA lógica de
//   agregación que ya existe (no se toca ningún generador de reportes).
//
// DECISIONES APLICADAS (confirmadas con el dueño)
//   - Migración sesión por sesión (los datos del Excel lo permiten).
//   - Helados/gelatinas: OMITIDOS (no calzan en Play; son ventas sin costo).
//   - Los ₡4.500 reales de feb 2026 NO se tocan: feb 2026 queda en ₡104.350.
//   - Moneda: colones enteros.
//
// SEGURIDAD
//   - No modifica ni borra plays reales: solo AGREGA docs con el flag.
//   - `migrar` reconcilia CADA mes contra los totales auditados y ABORTA si algo
//     no cuadra (no importa datos que no sumen ₡3.516.535).
//   - Idempotente: `migrar` borra primero los excel_historico y re-inserta.
//   - `backup` respalda los reportes de los meses afectados; `rollback` borra
//     solo lo migrado y recalcula.
//
// USO (desde la raíz del proyecto):
//   node scripts/migrarHistoricoExcel.js parse       # lee el Excel y reconcilia (NO toca la base)
//   node scripts/migrarHistoricoExcel.js backup      # respaldo previo (necesita MONGO_URI)
//   node scripts/migrarHistoricoExcel.js verificar   # totales actuales vs checksum
//   node scripts/migrarHistoricoExcel.js migrar      # reconcilia + inserta + regenera + verifica
//   node scripts/migrarHistoricoExcel.js rollback    # borra lo migrado + regenera reportes
//
// Ruta del Excel: por defecto la raíz del proyecto. Se puede pasar otra como 2º arg.
// Requiere en el .env: MONGO_URI (para todo menos `parse`).

import dotenv from 'dotenv';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

// Algunos ISP/routers no resuelven registros SRV (mongodb+srv), lo que hace fallar
// la conexión a Atlas desde una máquina local con "querySrv ECONNREFUSED". Forzamos
// resolutores DNS públicos (Google/Cloudflare) y priorizamos IPv4 para evitarlo.
dns.setDefaultResultOrder('ipv4first');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* no crítico */ }

import Play from '../models/plays.js';
import MonthlyReport from '../models/Monthlyplaysreport.js';
import EstadoResultados from '../models/EstadoResultados.js';
import { regenerarReporteDeFecha } from '../controllers/playsController.js';
import { regenerarEstadoDeMes } from '../controllers/estadoResultadosController.js';
import { parseHistorico, CHECKSUM_PLAYS } from './parseHistoricoExcel.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ORIGEN = 'excel_historico';
const RUTA_XLSX = process.argv[3] || path.join(__dirname, '..', 'Sala de juegos Oficial.xlsx');

// Los 24 meses afectados (para regenerar reportes en migrar/rollback).
const MESES_AFECTADOS = [];
for (let m = 3; m <= 12; m++) MESES_AFECTADOS.push([2024, m]);
for (let m = 1; m <= 12; m++) MESES_AFECTADOS.push([2025, m]);
MESES_AFECTADOS.push([2026, 1], [2026, 2]);

// Día 1..31 del mes a medianoche de Costa Rica (06:00 UTC).
const fechaSesion = (año, mes, dia) => new Date(Date.UTC(año, mes - 1, dia, 6, 0, 0, 0));

// Convierte una sesión normalizada del parser en un doc Play listo para insertar.
// Reparto idéntico al del sistema: subtotal = ingreso por tiempo (va al bucket de
// la consola), costoControles = control (va a totalCostosControles), y
// total = montoPagado = ingreso + control.
const buildPlayDoc = (s) => {
  const fecha = fechaSesion(s.año, s.mes, s.dia);
  const lugarDeJuego = s.tipo === 'Ping Pong' ? 'Ping Pong' : `${s.tipo} número ${s.unit}`;
  const controlAdicional = Math.min(2, Math.round(s.control / 200)); // conteo estimado (0-2)
  const total = s.ingreso + s.control;
  return {
    fecha,
    cliente: s.cliente,
    atendio: s.atendio,
    tiempoPagado: s.minutos || 0,
    tiempoPendiente: 0,
    horaInicio: '00:00',
    horaFinal: '00:00',
    lugarDeJuego,
    tipoPlay: s.tipo,
    juegosJugados: s.juegos || [],
    totalControles: Math.min(4, 2 + controlAdicional),
    controlAdicional,
    subtotal: s.ingreso,
    costoControles: s.control,
    total,
    montoPagado: total,
    totalPlay4: s.tipo === 'Play 4' ? s.ingreso : 0,
    totalPlay5: s.tipo === 'Play 5' ? s.ingreso : 0,
    totalPingPong: s.tipo === 'Ping Pong' ? s.ingreso : 0,
    estadoPago: 'Completado',
    finProgramado: null,          // nunca dispara notificación de WhatsApp
    notificacionFinEnviada: true, // idem
    origen: ORIGEN,
    createdAt: fecha,
    updatedAt: fecha,
  };
};

const conectar = async () => {
  if (!process.env.MONGO_URI) { console.error('❌ Falta MONGO_URI en el .env.'); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  console.log('✅ Conectado a MongoDB.');
};
const desconectar = async () => { await mongoose.disconnect(); };

const regenerarTodosLosMeses = async () => {
  for (const [año, mes] of MESES_AFECTADOS) {
    await regenerarReporteDeFecha(fechaSesion(año, mes, 1)); // reporte mensual / por consola
    await regenerarEstadoDeMes(año, mes);                    // estado de resultados
  }
  console.log(`🔁 Reportes regenerados para ${MESES_AFECTADOS.length} meses.`);
};

// Imprime la tabla de reconciliación del parser.
const imprimirReconciliacion = (rec) => {
  console.log('\nRECONCILIACIÓN (Excel vs auditado):');
  console.log('mes        sesiones  estado');
  for (const r of rec) {
    if (r.error) { console.log(`${r.key.padEnd(9)}      —     ✗ ${r.error}`); continue; }
    const detalle = r.ok ? '✓ OK' :
      `✗ DIF P4 ${r.sP4 - r.aP4} | P5 ${r.sP5 - r.aP5} | PP ${r.sPP - r.aPP} | Ctrl ${r.sCtrl - r.aCtrl}`;
    console.log(`${r.key.padEnd(9)} ${String(r.sesiones).padStart(6)}    ${detalle}`);
  }
};

// ─────────────────────────────────────────────────────────────
// parse — lee el Excel y reconcilia. NO toca la base.
// ─────────────────────────────────────────────────────────────
const cmdParse = async () => {
  console.log(`📖 Leyendo: ${RUTA_XLSX}`);
  const { ok, sesiones, reconciliacion, totalParseado } = parseHistorico(RUTA_XLSX);
  imprimirReconciliacion(reconciliacion);
  console.log(`\nSesiones totales: ${sesiones.length}`);
  console.log(`TOTAL parseado: ₡${totalParseado.toLocaleString('es-CR')}  |  checksum: ₡${CHECKSUM_PLAYS.toLocaleString('es-CR')}`);
  console.log(ok ? '✅ Todo cuadra. Listo para migrar.' : '❌ Hay meses que NO cuadran. La migración se abortaría.');
  return ok;
};

// ─────────────────────────────────────────────────────────────
// backup — respalda los reportes de los meses afectados.
// ─────────────────────────────────────────────────────────────
const cmdBackup = async () => {
  const orQuery = MESES_AFECTADOS.map(([año, mes]) => ({ año, mes }));
  const [reportesPlays, estados, conteoMigrados] = await Promise.all([
    MonthlyReport.find({ $or: orQuery }).lean(),
    EstadoResultados.find({ $or: orQuery }).lean(),
    Play.countDocuments({ origen: ORIGEN }),
  ]);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destino = path.join(__dirname, `backup-historico-${stamp}.json`);
  fs.writeFileSync(destino, JSON.stringify({
    generadoEn: new Date().toISOString(),
    nota: 'Respaldo de reportes de los 24 meses afectados ANTES de migrar. Los plays reales no se tocan.',
    plays_excel_historico_existentes: conteoMigrados,
    monthlyReports: reportesPlays,
    estadosResultados: estados,
  }, null, 2), 'utf8');
  console.log(`💾 Respaldo escrito en: ${destino}`);
  console.log(`   MonthlyReport: ${reportesPlays.length} | EstadoResultados: ${estados.length} | Plays excel_historico ya en BD: ${conteoMigrados}`);
};

// ─────────────────────────────────────────────────────────────
// migrar — reconcilia, inserta sesión por sesión, regenera, verifica.
// ─────────────────────────────────────────────────────────────
const cmdMigrar = async () => {
  console.log(`📖 Leyendo: ${RUTA_XLSX}`);
  const { ok, sesiones, reconciliacion } = parseHistorico(RUTA_XLSX);
  imprimirReconciliacion(reconciliacion);
  if (!ok) {
    console.error('\n❌ ABORTADO: hay meses que no cuadran contra los totales auditados. No se insertó nada.');
    process.exit(1);
  }
  console.log(`\n✅ Reconciliación OK — ${sesiones.length} sesiones listas.`);

  // Idempotencia: borrar cualquier excel_historico previo.
  const del = await Play.deleteMany({ origen: ORIGEN });
  if (del.deletedCount > 0) console.log(`♻️  Borrados ${del.deletedCount} plays excel_historico previos.`);

  // Insertar RAW (.collection) para saltar la validación de enums (empleados y
  // lugares históricos que no están en el enum actual). Mismo patrón que otras
  // migraciones del proyecto.
  const docs = sesiones.map(buildPlayDoc);
  const res = await Play.collection.insertMany(docs);
  console.log(`✅ Insertadas ${res.insertedCount} sesiones históricas.`);

  await regenerarTodosLosMeses();
  await cmdVerificar();
};

// ─────────────────────────────────────────────────────────────
// verificar — totales migrados por año vs checksum + lo que verá el sistema.
// ─────────────────────────────────────────────────────────────
const cmdVerificar = async () => {
  const porAnio = await Play.aggregate([
    { $match: { origen: ORIGEN } },
    { $group: {
        _id: { $year: { date: '$fecha', timezone: 'America/Costa_Rica' } },
        montoPagado: { $sum: '$montoPagado' },
        play4: { $sum: '$totalPlay4' }, play5: { $sum: '$totalPlay5' },
        pingpong: { $sum: '$totalPingPong' }, controles: { $sum: '$costoControles' },
        docs: { $sum: 1 },
    } },
    { $sort: { _id: 1 } },
  ]);
  console.log('\n📊 MIGRADO (origen=excel_historico) por año:');
  let granTotal = 0;
  for (const a of porAnio) {
    granTotal += a.montoPagado;
    console.log(`   ${a._id}: ₡${a.montoPagado.toLocaleString('es-CR')}  (P4 ₡${a.play4.toLocaleString('es-CR')} | P5 ₡${a.play5.toLocaleString('es-CR')} | PP ₡${a.pingpong.toLocaleString('es-CR')} | Ctrl ₡${a.controles.toLocaleString('es-CR')} | ${a.docs} sesiones)`);
  }
  console.log(`   ─────────────────────────────────`);
  console.log(`   TOTAL migrado: ₡${granTotal.toLocaleString('es-CR')}  |  checksum: ₡${CHECKSUM_PLAYS.toLocaleString('es-CR')}`);
  console.log(granTotal === CHECKSUM_PLAYS ? '   ✅ CHECKSUM OK.' : `   ❌ DIFERENCIA ₡${(granTotal - CHECKSUM_PLAYS).toLocaleString('es-CR')}.`);

  const años = [2024, 2025, 2026];
  console.log('\n📅 Reporte mensual de plays (lo que verá el sistema, incluye plays reales):');
  for (const año of años) {
    const reps = await MonthlyReport.find({ año }).select('mes totalRecaudado').sort({ mes: 1 }).lean();
    const totalAño = reps.reduce((s, r) => s + (r.totalRecaudado || 0), 0);
    console.log(`   ${año}: ₡${totalAño.toLocaleString('es-CR')} (${reps.length} meses con reporte)`);
  }
  const feb = await MonthlyReport.findOne({ año: 2026, mes: 2 }).select('totalRecaudado').lean();
  if (feb) console.log(`\n🔎 Febrero 2026 (esperado ₡104.350): ₡${(feb.totalRecaudado || 0).toLocaleString('es-CR')}`);
};

// ─────────────────────────────────────────────────────────────
// rollback — borra lo migrado y regenera reportes con datos reales.
// ─────────────────────────────────────────────────────────────
const cmdRollback = async () => {
  const del = await Play.deleteMany({ origen: ORIGEN });
  console.log(`🗑️  Borradas ${del.deletedCount} sesiones excel_historico.`);
  await regenerarTodosLosMeses();
  console.log('✅ Rollback completo. Los reportes quedan con los datos reales únicamente.');
};

// ─────────────────────────────────────────────────────────────
const COMANDOS = { parse: cmdParse, backup: cmdBackup, verificar: cmdVerificar, migrar: cmdMigrar, rollback: cmdRollback };
const SIN_DB = new Set(['parse']);

const run = async () => {
  const cmd = (process.argv[2] || '').toLowerCase();
  const fn = COMANDOS[cmd];
  if (!fn) {
    console.error('Uso: node scripts/migrarHistoricoExcel.js <parse|backup|verificar|migrar|rollback> [rutaExcel]');
    process.exit(1);
  }
  if (SIN_DB.has(cmd)) { await fn(); return; }
  await conectar();
  try { await fn(); } finally { await desconectar(); }
};

run().catch((err) => { console.error('❌ Error en la migración:', err); process.exit(1); });
