// models/ResumenPersonalMes.js
// Finanzas Personales — SNAPSHOT MENSUAL (Patrón A: "genera y guarda").
//
// Mismo patrón que EstadoResultados / SaleReport / MonthlyReport del negocio:
// los totales del mes se calculan UNA vez (al crear/editar/borrar un movimiento)
// y se guardan ya sumados acá. Los GET solo LEEN.
//
// ¿Por qué? El reporte anual necesita los 12 meses, el saldo acumulado de todos
// los meses previos y la comparación con el año anterior. Calculando en vivo eso
// serían decenas de recorridos sobre los movimientos en cada carga, y crece
// para siempre. Leyendo snapshots, el reporte anual es UNA consulta que trae
// como máximo 24 documentos chiquitos (el año y el anterior) — costo plano,
// sin importar cuántos movimientos haya.
//
// IMPORTANTE — qué NO se guarda acá:
//   • Saldo Inicial / Saldo Final / Ahorro Acumulado: son ACUMULADOS. Si se
//     guardaran, editar marzo dejaría mal abril hasta diciembre (habría que
//     regenerar en cascada). Se derivan al leer, sumando estos snapshots (son
//     12 por año, no miles de movimientos).
//   • El saldo de apertura ([[AperturaPersonal]]): no pertenece a ningún mes.
import mongoose from 'mongoose';

export const NOMBRES_MES_PERSONAL = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// Fila del desglose por categoría (el mismo shape que ya consumía el frontend).
const filaCategoriaSchema = new mongoose.Schema(
  {
    categoria: { type: String, required: true },
    total: { type: Number, default: 0 },
    cantidad: { type: Number, default: 0 },
  },
  { _id: false }
);

const resumenPersonalMesSchema = new mongoose.Schema(
  {
    // Snapshot POR USUARIO: las finanzas personales nunca se mezclan.
    usuario: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    anio: { type: Number, required: true, min: 2000, max: 2100 },
    mes: { type: Number, required: true, min: 1, max: 12 },
    nombreMes: { type: String, required: true },

    // Versión del formato. Si un snapshot guardado tiene una versión menor a la
    // actual (SCHEMA_VERSION en el controller), se regenera solo al leerlo, para
    // que tome los campos nuevos sin apretar "Regenerar" a mano.
    schemaVersion: { type: Number, default: 0 },

    // ── Totales del mes (solo de ESTE mes, sin acumulados) ──
    totalIngresos: { type: Number, default: 0 }, // ingresos propios del mes
    totalGastos: { type: Number, default: 0 },   // egresos SIN ahorro (consumo)
    totalAhorro: { type: Number, default: 0 },   // apartado en el mes (BRUTO)
    totalEgresos: { type: Number, default: 0 },  // gastos + ahorro (sin lo pagado con ahorro)
    // Plata sacada DEL ahorro en el mes (tipo 'retiro_ahorro'). No es ingreso ni
    // egreso: sube el saldo a mano y baja el ahorro acumulado.
    totalRetiroAhorro: { type: Number, default: 0 },
    // Gasto pagado DIRECTO con el ahorro (egresos con fondo='ahorro'). Va APARTE
    // de totalGastos/totalEgresos a propósito: esa plata nunca pasó por el
    // bolsillo del mes, así que no puede mover el saldo final ni "Puedo gastar
    // hasta". Lo único que hace es bajar el ahorro acumulado (y el patrimonio,
    // que es lo correcto: la plata se consumió).
    totalGastoDesdeAhorro: { type: Number, default: 0 },
    // Flujo propio del mes: ingresos − egresos. NO incluye los retiros (un retiro
    // no es plata que el mes generó). El movimiento del saldo a mano es
    // balanceMes + totalRetiroAhorro.
    balanceMes: { type: Number, default: 0 },

    // ── Desglose por categoría ──
    desgloseIngreso: { type: [filaCategoriaSchema], default: [] },
    desgloseEgreso: { type: [filaCategoriaSchema], default: [] },
    // Retiros por categoría de ahorro. APARTE de desgloseEgreso a propósito: si
    // fueran egresos, la dona de gastos contaría como consumo plata que solo
    // cambió de bolsillo.
    desgloseRetiro: { type: [filaCategoriaSchema], default: [] },
    // Gasto pagado con ahorro, visto de dos formas: EN QUÉ se fue (categoría de
    // egreso: Compras personales, Salud…) y DE CUÁL bolsa salió (Ahorro MEP…).
    // Aparte de desgloseEgreso para no mezclarlo con el gasto del mes, pero
    // guardado igual para que se vea en qué se gastó el ahorro.
    desgloseGastoAhorro: { type: [filaCategoriaSchema], default: [] },
    desgloseGastoAhorroPorBolsa: { type: [filaCategoriaSchema], default: [] },

    // Conteo de movimientos del mes (informativo y para saber si el mes está vacío).
    movimientos: { type: Number, default: 0 },

    ultimaActualizacion: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Un snapshot por usuario/mes. El índice único evita duplicados en carreras
// (dos guardados a la vez usan upsert sobre la misma llave) y, por ser compuesto
// en ese orden, ya sirve para todas las consultas del módulo: por usuario, por
// usuario+año (reporte anual) y por usuario+año+mes (un mes puntual).
resumenPersonalMesSchema.index({ usuario: 1, anio: 1, mes: 1 }, { unique: true });

export default mongoose.model('ResumenPersonalMes', resumenPersonalMesSchema);
