// models/AhorroMovimiento.js
// Historial de movimientos del fondo de ahorro.
//
// El modelo Ahorro guarda solo el total corrido (totalAcumulado). Para poder
// saber cuánto se ahorró EN UN MES (ahorroDelMes del estado de resultados) se
// registra además cada depósito acá, con su fecha y monto. Append-only.
import mongoose from 'mongoose';

const ahorroMovimientoSchema = new mongoose.Schema(
  {
    monto: {
      type: Number,
      required: [true, 'El monto es obligatorio'],
      min: [1, 'El monto debe ser mayor a 0'],
    },
    descripcion: { type: String, default: null, trim: true },
    // Fecha del depósito (zona CR). La resuelve el backend.
    fecha: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ahorroMovimientoSchema.index({ fecha: 1 });

export default mongoose.model('AhorroMovimiento', ahorroMovimientoSchema);
