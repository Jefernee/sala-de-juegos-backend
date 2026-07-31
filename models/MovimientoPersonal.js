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

// Tipos de movimiento.
//   ingreso       → entra plata nueva
//   egreso        → sale plata (incluye apartar ahorro: ver CATEGORIAS_AHORRO)
//   retiro_ahorro → se saca plata del ahorro para usarla. NO es ingreso (no es
//                   plata nueva) ni egreso (no se gastó todavía): es un TRASLADO
//                   del bolsillo "apartado" al bolsillo "a mano". Sube el saldo
//                   disponible y baja el ahorro acumulado, y deja el patrimonio
//                   total igual. Si después se gasta, eso se registra aparte como
//                   el egreso que sea.
export const TIPOS_MOVIMIENTO = ['ingreso', 'egreso', 'retiro_ahorro'];

// Categorías predefinidas (decisión del usuario: lista fija, no texto libre).
// Se pueden ampliar/cambiar cuando el usuario lo pida.
export const CATEGORIAS_INGRESO = [
  'Salario',
  'Salario MEP',
  'Salario CreAI',
  'Negocio',
  'Ventas/Extras',
  'Préstamos',
  'Otros',
];

// Van agrupadas por tema (comida/hogar, transporte, personales, ocasiones,
// compromisos, ahorro) para que el select del frontend se lea ordenado.
export const CATEGORIAS_EGRESO = [
  // Comida y hogar
  'Supermercado',
  'Comida preparada',
  'Snacks y antojos',
  'Comida de colegio',
  'Comida en Batán',
  'Vivienda/Alquiler',
  'Servicios',
  'Internet/Celular',
  // Transporte
  'Transporte',
  'Combustible',
  'Viajes a Batán',
  // Personales / día a día
  'Salud',
  'Peluqueada',
  'Ropa y calzado',
  'Compras personales',
  'Educación',
  'Entretenimiento',
  'Suscripciones',
  'Mascotas',
  // Ocasiones
  'Regalos',
  'Cumpleaños',
  'Rifas',
  // Compromisos financieros
  'Deudas/Préstamos',
  'Cuota banco (BCR)',
  'Seguros',
  // Ahorro (dinero apartado, NO gasto de consumo)
  'Ahorro',
  'Ahorro CreAI',
  'Ahorro MEP',
  'Otros',
];

// Categorías que son AHORRO (dinero que se aparta, algo bueno). Los mensajes
// inteligentes las tratan aparte del gasto de consumo para no sugerir
// "recortarlas". Se suman todas como el ahorro total del mes.
export const CATEGORIAS_AHORRO = ['Ahorro', 'Ahorro CreAI', 'Ahorro MEP'];

// Categorías que cuentan como DEUDA para el aviso de "peso de las deudas".
export const CATEGORIAS_DEUDA = ['Deudas/Préstamos', 'Cuota banco (BCR)'];

// Gastos FIJOS: los que llegan todos los meses casi igual y no se pueden
// recortar de un día para otro. Los mensajes inteligentes avisan cuando se
// llevan una parte muy grande del ingreso (poco margen ante un imprevisto).
export const CATEGORIAS_FIJAS = [
  'Vivienda/Alquiler',
  'Servicios',
  'Internet/Celular',
  'Suscripciones',
  'Seguros',
  'Cuota banco (BCR)',
];

// Gastos asociados a los viajes a Batán (comida allá + los viajes en sí).
// Se agrupan para poder decir cuánto cuesta Batán en total cada mes.
export const CATEGORIAS_BATAN = ['Comida en Batán', 'Viajes a Batán'];

// Helper: ¿esta categoría de egreso es ahorro?
export const esAhorro = (categoria) => CATEGORIAS_AHORRO.includes(categoria);

// Helper: ¿este movimiento es un retiro del ahorro?
export const esRetiroAhorro = (tipo) => tipo === 'retiro_ahorro';

// Helpers de grupo para los mensajes inteligentes.
export const esGastoFijo = (categoria) => CATEGORIAS_FIJAS.includes(categoria);
export const esDeBatan = (categoria) => CATEGORIAS_BATAN.includes(categoria);

// Monedas soportadas. El valor canónico SIEMPRE es `monto` en colones (CRC);
// USD solo guarda el origen del pago para referencia.
export const MONEDAS = ['CRC', 'USD'];

// Devuelve la lista de categorías válida según el tipo de movimiento. Un retiro
// se clasifica con la MISMA categoría de ahorro de la que salió la plata (así se
// sabe de qué bolsa se sacó: Ahorro, Ahorro CreAI o Ahorro MEP).
export const categoriasPorTipo = (tipo) => {
  if (tipo === 'ingreso') return CATEGORIAS_INGRESO;
  if (tipo === 'retiro_ahorro') return CATEGORIAS_AHORRO;
  return CATEGORIAS_EGRESO;
};

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
