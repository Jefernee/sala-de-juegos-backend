// models/ActivoSala.js
// Hecho por Claude Code — Módulo de Administración: Activos de la Sala
// Equipo físico de la sala (controles, consolas, pantallas, otros).
//
// Cada activo guarda un HISTORIAL de reparaciones (arreglo `reparaciones`) en
// vez de una sola reparación en campos sueltos. El `estado` del activo se
// CALCULA automáticamente a partir de ese historial (ver derivarEstado), salvo
// que haya un override manual (`estadoOverride`).
import mongoose from 'mongoose';

export const ESTADOS_ACTIVO = ['En uso', 'En reparación', 'Reparado', 'Fuera de servicio', 'Almacenado'];
// Los dos estados que el usuario puede forzar a mano (los otros son automáticos).
export const ESTADOS_OVERRIDE = ['Fuera de servicio', 'Almacenado'];
export const CATEGORIAS_ACTIVO = ['Control PS4', 'Control PS5', 'Consola PS4', 'Consola PS5', 'Pantalla', 'Otros'];

// ============================================
// Regla de estado automático (recalcular en CADA escritura que toque reparaciones):
//   - estadoOverride != null                    → gana el override
//   - sin reparaciones                          → "En uso"
//   - alguna reparación con finalizada:false    → "En reparación"
//   - hay reparaciones y TODAS finalizada:true  → "Reparado"
// Exportada para reutilizar en el controlador y en la migración.
// ============================================
export const derivarEstado = (reparaciones = [], estadoOverride = null) => {
  if (estadoOverride) return estadoOverride;
  if (!reparaciones || reparaciones.length === 0) return 'En uso';
  const todasFinalizadas = reparaciones.every((r) => r.finalizada === true);
  return todasFinalizadas ? 'Reparado' : 'En reparación';
};

// Subdocumento: una reparación del historial. Mongoose le genera `_id` (que el
// frontend usa para editar/eliminar) y `createdAt` (sin updatedAt).
const reparacionSchema = new mongoose.Schema(
  {
    costo: {
      type: Number,
      required: [true, 'El costo de la reparación es obligatorio'],
      min: [1, 'El costo de la reparación debe ser mayor a 0'],
    },
    problemaTecnico: { type: String, default: null, trim: true },
    reparadoPor: { type: String, default: null, trim: true },
    // Fecha de ESA reparación (se guarda como Date; ver parseFecha en el controlador).
    fecha: { type: Date, default: null },
    // Factura de la reparación en Cloudinary (url + public_id para poder borrarla).
    facturaUrl: { type: String, default: null },
    facturaPublicId: { type: String, default: null },
    // false = abierta (En reparación) | true = lista (Reparado)
    finalizada: { type: Boolean, default: false },
  },
  { _id: true, timestamps: { createdAt: true, updatedAt: false } }
);

const activoSalaSchema = new mongoose.Schema(
  {
    // Número de placa: identificador consecutivo y único del activo.
    // Se asigna automáticamente al crear (ver controlador) y es INMUTABLE:
    // una vez puesto no se puede cambiar, para que sea estable y nunca se
    // dupliquen placas. En el frontend se muestra con formato (ej. "PLACA-0007").
    // sparse: permite que documentos antiguos sin placa convivan hasta el backfill.
    numeroPlaca: {
      type: Number,
      unique: true,
      sparse: true,
      immutable: true,
      min: [1, 'El número de placa debe ser mayor a 0'],
    },
    nombre: {
      type: String,
      required: [true, 'El nombre es obligatorio'],
      trim: true,
    },
    // Categoría para filtrar el panel de activos (chips). Se envía desde el
    // frontend; los activos viejos se clasifican con una migración por nombre.
    categoria: {
      type: String,
      enum: {
        values: CATEGORIAS_ACTIVO,
        message: 'Categoría inválida: {VALUE}',
      },
      default: 'Otros',
    },
    // Costo del producto/compra. NO se modifica al registrar reparaciones.
    costo: {
      type: Number,
      required: [true, 'El costo es obligatorio'],
      min: [1, 'El costo debe ser mayor a 0'],
    },
    // Estado del activo. Es CALCULADO por el backend (ver derivarEstado); el
    // frontend solo lo lee. Nunca se debe editar directamente desde el front.
    estado: {
      type: String,
      enum: {
        values: ESTADOS_ACTIVO,
        message: 'Estado inválido: {VALUE}',
      },
      default: 'En uso',
    },
    // Override manual del estado: si != null, gana sobre el estado automático.
    // "Fuera de servicio" = dañado, no sirve. "Almacenado" = sirve pero guardado.
    estadoOverride: {
      type: String,
      enum: {
        values: [...ESTADOS_OVERRIDE, null],
        message: 'estadoOverride inválido: {VALUE}',
      },
      default: null,
    },
    descripcion: { type: String, default: null, trim: true },
    numeroFactura: { type: String, default: null, trim: true },
    notas: { type: String, default: null, trim: true },
    // Fecha de COMPRA del producto (llega como "YYYY-MM-DD", se guarda como Date).
    // Separada de la fecha de reparación, que vive dentro de cada item de `reparaciones`.
    fechaCompra: { type: Date, default: null },
    // Historial de reparaciones (0, 1 o varias).
    reparaciones: { type: [reparacionSchema], default: [] },
    // URLs de Cloudinary (las imágenes llegan como base64 y se suben igual que inventario)
    imagenUrl: { type: String, default: null }, // foto del artículo
    imagenFacturaUrl: { type: String, default: null }, // factura de COMPRA del activo
  },
  { timestamps: true } // createdAt y updatedAt automáticos
);

// Índice para el listado ordenado por más reciente
activoSalaSchema.index({ createdAt: -1 });
// Índice para el filtro por categoría (chips del panel)
activoSalaSchema.index({ categoria: 1 });

export default mongoose.model('ActivoSala', activoSalaSchema);
