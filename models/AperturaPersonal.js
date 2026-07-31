// models/AperturaPersonal.js
// Finanzas Personales — SALDO DE APERTURA (SOLO administrador).
//
// Problema que resuelve: cuando se empieza a usar el módulo ya se traía dinero
// de meses anteriores (ahorros y/o plata a mano) que NUNCA se registró como
// movimiento. Meterlo como un ingreso normal rompería el mes: los mensajes
// inteligentes calculan casi todo como % de los ingresos del mes y comparan
// contra el mes anterior, así que un ingreso gigante de una sola vez inflaría
// la tasa de ahorro, desinflaría el peso de los gastos fijos y al mes siguiente
// avisaría "tus ingresos bajaron 90%".
//
// Por eso el saldo de apertura vive en su PROPIA colección y NO es un
// movimiento: se excluye del resumen del mes, del desglose por categoría, de la
// lista de movimientos y de todas las comparaciones. Solo alimenta:
//   • el Saldo Inicial acumulado  (con `montoDisponible`)
//   • el Ahorro Acumulado         (con `montoAhorro`)
//
// Un solo registro por usuario (índice único): se edita, no se acumula.
import mongoose from 'mongoose';

const aperturaPersonalSchema = new mongoose.Schema(
  {
    // Dueño. Lo asigna el backend con el id del token; el frontend NUNCA lo envía.
    usuario: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // ya crea el índice: no hace falta index:true además
    },

    // Plata A MANO al momento del corte (lo que se podía gastar). Suma al
    // Saldo Inicial de todos los meses desde el mes de corte en adelante.
    montoDisponible: {
      type: Number,
      default: 0,
      min: [0, 'El monto disponible no puede ser negativo'],
    },

    // Plata YA APARTADA como ahorro al momento del corte. NO suma al saldo
    // disponible (es dinero apartado, igual que las categorías de Ahorro):
    // suma al Ahorro Acumulado.
    montoAhorro: {
      type: Number,
      default: 0,
      min: [0, 'El monto de ahorro no puede ser negativo'],
    },

    // Mes/año DESDE EL QUE aplica la apertura (el primer mes que se lleva en el
    // sistema). Se guarda desglosado para poder mostrar "vigente desde julio 2026".
    mesCorte: { type: Number, required: true, min: 1, max: 12 },
    anioCorte: { type: Number, required: true, min: 2000, max: 2100 },

    // Último instante ANTES del mes de corte (día 1 a medianoche CR menos 1 ms).
    // Se guarda ya calculado para comparar fechas sin recalcular.
    fechaCorte: { type: Date, required: true },

    descripcion: { type: String, default: null, trim: true },
  },
  { timestamps: true }
);

// Total declarado en la apertura (informativo para el frontend).
aperturaPersonalSchema.virtual('montoTotal').get(function () {
  return (this.montoDisponible || 0) + (this.montoAhorro || 0);
});

aperturaPersonalSchema.set('toJSON', { virtuals: true });
aperturaPersonalSchema.set('toObject', { virtuals: true });

export default mongoose.model('AperturaPersonal', aperturaPersonalSchema);
