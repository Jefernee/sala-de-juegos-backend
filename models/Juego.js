// models/Juego.js
// Módulo de Juegos: el catálogo de lo que se puede jugar en la sala.
//
// POR QUÉ EXISTE
// Antes un juego vivía en tres lugares que no se conocían: la lista escrita a
// mano del selector de plays, el activo (si se había comprado) y la vitrina de
// la página pública. Cambiar uno dejaba a los otros dos desactualizados.
//
// Acá vive la IDENTIDAD del juego: cómo se llama, cómo se ve y si se muestra.
// La PLATA sigue viviendo donde siempre: en ActivoSala. Un juego comprado tiene
// su activo con placa, factura y fecha, y ese activo apunta acá con `juegoId`.
// Los reportes siguen leyendo activos y no saben que esta colección existe.
//
//   Juego gratis (PS Plus)  → ficha sin activo  → no toca ningún reporte
//   Juego comprado          → ficha + activo    → el activo va a los reportes
//   Complemento comprado    → ficha hija + activo (categoría Complementos)
//   Complemento gratis      → ficha hija sola
import mongoose from 'mongoose';

// Clave de comparación: sin tildes, sin mayúsculas y sin signos, para que
// "Pokémon" y "pokemon", o "GTA V" y "gta-v", sean el mismo juego.
export const normalizarNombre = (nombre) =>
  (nombre || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const juegoSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: [true, 'El nombre es obligatorio'],
      trim: true,
    },
    // Copia normalizada del nombre. Es lo que impide los duplicados de verdad
    // (ver el índice de abajo); se recalcula sola en cada guardado.
    clave: { type: String, required: true, index: true },

    // Si tiene padre, esto es un COMPLEMENTO (mapas, pase, monedas) de ese
    // juego. Los complementos no se ofrecen al cobrar ni salen en la página:
    // nadie juega "mapas", se juega el Call of Duty.
    padre: { type: mongoose.Schema.Types.ObjectId, ref: 'Juego', default: null },

    // Portada. Vive acá y no en el activo a propósito: la foto del activo es
    // del inventario (la caja, el recibo) y esta es la que ve el cliente.
    imagenUrl: { type: String, default: null },

    // Se muestra en la página pública. Sin portada no se puede activar: una
    // tarjeta sin foto se ve rota (la regla se repite en el controlador).
    enVitrina: { type: Boolean, default: false },
    link: { type: String, default: null, trim: true },

    // "Dejar de ofrecerlo": sale del selector y de la página, pero su activo
    // —si lo tiene— sigue contando en los reportes. Es la salida para los
    // juegos que se pagaron y ya no se usan: borrarlos le sacaría plata a un
    // mes ya cerrado.
    noSeOfrece: { type: Boolean, default: false },

    // De dónde salió. Solo para poder auditar la migración inicial.
    origen: {
      type: String,
      enum: ['catalogo', 'activo', 'vitrina', 'manual'],
      default: 'manual',
    },
  },
  { timestamps: true }
);

// La clave se calcula en el setter del nombre y no en un hook: así queda al
// día SIEMPRE, incluso en las validaciones síncronas, donde los hooks no
// corren. Si quedara sin calcular, el índice único no serviría de nada y se
// colarían nombres repetidos.
juegoSchema.path('nombre').set(function (valor) {
  this.clave = normalizarNombre(valor);
  return valor;
});

// Sin portada no hay vitrina: una tarjeta sin foto en la página se ve rota.
// Esto es la última línea; el formulario y el controlador ya lo impiden antes.
// Sin `next`: en esta versión de mongoose los hooks son de promesa, igual que
// los de models/Inventario.js. Con la firma vieja, TODO guardado fallaba.
juegoSchema.pre('validate', function () {
  if (!this.clave) this.clave = normalizarNombre(this.nombre);
  if (!this.imagenUrl) this.enVitrina = false;
});

// No se repite un nombre ENTRE JUEGOS, ni entre los complementos de un mismo
// juego. Dos juegos distintos sí pueden tener su propio "Pase de temporada".
juegoSchema.index({ padre: 1, clave: 1 }, { unique: true });
// La página pública pide solo los de la vitrina.
juegoSchema.index({ enVitrina: 1 });

export default mongoose.model('Juego', juegoSchema);
