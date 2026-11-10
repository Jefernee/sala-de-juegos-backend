// models/LimiteCategoriaPersonal.js
// Finanzas Personales — límite PROPIO de una categoría de gasto.
//
// Sin documento, la categoría usa "lo que solés gastar" (promedio de los
// últimos 3 meses, ver utils/limitesCategoria.js). Con documento, manda este
// monto hasta que el usuario lo quite ("usar ese" en la pantalla), que borra el
// documento. Uno por usuario y categoría.
import mongoose from 'mongoose';

const limiteCategoriaPersonalSchema = new mongoose.Schema(
  {
    // Dueño. Lo asigna el backend con el id del token.
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    categoria: { type: String, required: true, trim: true },
    monto: {
      type: Number,
      required: true,
      min: [1, 'El límite tiene que ser mayor que cero'],
    },
  },
  { timestamps: true }
);

limiteCategoriaPersonalSchema.index({ usuario: 1, categoria: 1 }, { unique: true });

export default mongoose.model('LimiteCategoriaPersonal', limiteCategoriaPersonalSchema);
