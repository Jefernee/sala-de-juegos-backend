// models/MovimientoPersonal.js
// Finanzas Personales (SOLO administrador).
//
// ⚠️ IMPORTANTE: Este módulo es TOTALMENTE APARTE de la sala de juegos.
// NO se cruza con ventas, plays, ganancias, pagos de servicios ni con el
// Estado de Resultados del negocio. Aquí solo viven los ingresos y gastos
// PERSONALES que el administrador registra a mano. Los números nunca se
// mezclan con los del negocio.
//
// Una sola colección guarda ingresos y egresos, distinguidos por `tipo`.
// Cada movimiento pertenece a un usuario (`usuario`) para que sea realmente
// personal y no se mezcle con nadie más.
import mongoose from 'mongoose';

// Tipos de movimiento
export const TIPOS_MOVIMIENTO = ['ingreso', 'egreso'];

// Categorías predefinidas (decisión del usuario: lista fija, no texto libre).
// Se pueden ampliar/cambiar cuando el usuario lo pida.
export const CATEGORIAS_INGRESO = [
  'Salario MEP',
  'Salario CreAI',
  'Negocio',
  'Ventas/Extras',
  'Préstamos',
  'Otros',
];

export const CATEGORIAS_EGRESO = [
  'Comida',
  'Transporte',
  'Vivienda/Alquiler',
  'Servicios',
  'Salud',
  'Entretenimiento',
  'Compras personales',
  'Educación',
  'Deudas/Préstamos',
  'Ahorro',
  'Otros',
];

// Monedas soportadas. El valor canónico SIEMPRE es `monto` en colones (CRC);
// USD solo guarda el origen del pago para referencia.
export const MONEDAS = ['CRC', 'USD'];

// Devuelve la lista de categorías válida según el tipo de movimiento.
export const categoriasPorTipo = (tipo) =>
  tipo === 'ingreso' ? CATEGORIAS_INGRESO : CATEGORIAS_EGRESO;

const movimientoPersonalSchema = new mongoose.Schema(
  {
    // Dueño del movimiento. Lo asigna el backend con el id del token; el
    // frontend NUNCA lo envía. Garantiza que las finanzas sean personales.
    usuario: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tipo: {
      type: String,
      enum: {
        values: TIPOS_MOVIMIENTO,
        message: 'Tipo inválido: {VALUE} (usar "ingreso" o "egreso")',
      },
      required: [true, 'El tipo es obligatorio'],
    },
    categoria: {
      type: String,
      required: [true, 'La categoría es obligatoria'],
      trim: true,
    },
    // Valor CANÓNICO: siempre en colones. Con esto se calculan todos los
    // totales y el resumen. Si el pago fue en USD, aquí va ya convertido.
    monto: {
      type: Number,
      required: [true, 'El monto es obligatorio'],
      min: [1, 'El monto debe ser mayor a 0'],
    },
    // Moneda en la que se hizo el pago (referencia). El total sigue siendo `monto`.
    moneda: {
      type: String,
      enum: {
        values: MONEDAS,
        message: 'Moneda inválida: {VALUE} (usar "CRC" o "USD")',
      },
      default: 'CRC',
    },
    // Monto en la moneda original. Si moneda='CRC' es igual a `monto`;
    // si moneda='USD' es el valor en dólares.
    montoOriginal: {
      type: Number,
      default: null,
    },
    // Colones por US$1 usado en la conversión (solo relevante si moneda='USD').
    tipoCambio: {
      type: Number,
      default: null,
    },
    descripcion: {
      type: String,
      default: null,
      trim: true,
    },
    // La fecha SIEMPRE la asigna el backend; el frontend solo elige mes/anio.
    fecha: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Índice para acelerar el filtro por usuario + mes/año.
movimientoPersonalSchema.index({ usuario: 1, fecha: 1 });

export default mongoose.model('MovimientoPersonal', movimientoPersonalSchema);
