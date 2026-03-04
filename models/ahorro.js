import mongoose from 'mongoose';

const ahorroSchema = new mongoose.Schema({
  totalAcumulado: {
    type: Number,
    default: 0
  },
  ultimaActualizacion: {
    type: Date,
    default: null
  }
}, { timestamps: true });

export default mongoose.model('Ahorro', ahorroSchema);