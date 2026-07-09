// models/ActivoSala.js
// Hecho por Claude Code — Módulo de Administración: Activos de la Sala
// Compras y reparaciones del equipo físico (máquinas, muebles, etc.)
import mongoose from 'mongoose';

export const TIPOS_REGISTRO = ['Nueva Compra', 'Reparación'];
export const ESTADOS_ACTIVO = ['En uso', 'En reparación', 'Reparado', 'Fuera de servicio', 'Almacenado'];
export const CATEGORIAS_ACTIVO = ['Control PS4', 'Control PS5', 'Consola PS4', 'Consola PS5', 'Pantalla', 'Otros'];

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
    tipoRegistro: {
      type: String,
      enum: {
        values: TIPOS_REGISTRO,
        message: 'Tipo de registro inválido: {VALUE}',
      },
      required: [true, 'El tipo de registro es obligatorio'],
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
    // Costo de la reparación, separado del costo del producto.
    // Solo aplica cuando tipoRegistro === "Reparación".
    costoReparacion: {
      type: Number,
      default: null,
      min: [1, 'El costo de reparación debe ser mayor a 0'],
    },
    estado: {
      type: String,
      enum: {
        values: ESTADOS_ACTIVO,
        message: 'Estado inválido: {VALUE}',
      },
      default: 'En uso',
    },
    descripcion: { type: String, default: null, trim: true },
    numeroFactura: { type: String, default: null, trim: true },
    notas: { type: String, default: null, trim: true },
    // Viene del frontend como "YYYY-MM-DD", se guarda como Date (puede ser null)
    fechaCompraReparacion: { type: Date, default: null },
    // Solo cuando tipoRegistro === "Reparación":
    problemaTecnico: { type: String, default: null, trim: true },
    reparadoPor: { type: String, default: null, trim: true },
    // URLs de Cloudinary (las imágenes llegan como base64 y se suben igual que inventario)
    imagenUrl: { type: String, default: null },
    // Factura de compra del activo (no se toca al registrar reparaciones)
    imagenFacturaUrl: { type: String, default: null },
    // Factura de la reparación, separada de la factura de compra.
    // Solo aplica cuando tipoRegistro === "Reparación".
    imagenFacturaReparacionUrl: { type: String, default: null },
  },
  { timestamps: true } // createdAt y updatedAt automáticos
);

// Índice para el listado ordenado por más reciente
activoSalaSchema.index({ createdAt: -1 });
// Índice para el filtro por categoría (chips del panel)
activoSalaSchema.index({ categoria: 1 });

export default mongoose.model('ActivoSala', activoSalaSchema);
