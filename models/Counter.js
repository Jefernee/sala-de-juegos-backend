// models/Counter.js
// Contador atómico genérico para secuencias.
// Se usa para asignar números consecutivos (ej. número de placa de activos)
// de forma segura ante concurrencia, usando $inc atómico de MongoDB.
import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema({
  // _id = nombre del contador, ej. "numeroPlacaActivo"
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model('Counter', counterSchema);

// Devuelve el siguiente número de la secuencia indicada (atómico).
// La primera vez crea el contador (upsert) empezando en 1.
export const siguienteSecuencia = async (nombre) => {
  const doc = await Counter.findByIdAndUpdate(
    nombre,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
};

// Devuelve el valor actual de la secuencia SIN incrementarla (solo lectura).
// Útil para previsualizar el próximo número. Devuelve 0 si no existe aún.
export const verSecuencia = async (nombre) => {
  const doc = await Counter.findById(nombre).lean();
  return doc?.seq || 0;
};

// Asegura que el contador quede al menos en "valor" (no lo baja si ya es mayor).
// Útil para sincronizar el contador con el máximo número de placa existente,
// por ejemplo después de un backfill o ante una colisión.
export const fijarSecuenciaMinima = async (nombre, valor) => {
  await Counter.findByIdAndUpdate(
    nombre,
    { $max: { seq: valor } },
    { upsert: true }
  );
};

export default Counter;
