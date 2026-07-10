// utils/migrarAhorroMovimientos.js
// Hecho por Claude Code — Migración idempotente del historial de ahorro.
//
// El fondo de ahorro existía como un único total corrido (Ahorro.totalAcumulado)
// sin historial. Para que `ahorroDelMes` del estado de resultados tenga de dónde
// salir, creamos UN movimiento inicial con ese saldo (fechado en la última
// actualización conocida). Idempotente: solo corre si aún NO hay movimientos.
import Ahorro from '../models/ahorro.js';
import AhorroMovimiento from '../models/AhorroMovimiento.js';

export const migrarAhorroMovimientos = async () => {
  const yaHay = await AhorroMovimiento.estimatedDocumentCount();
  if (yaHay > 0) return { creado: false };

  const ahorro = await Ahorro.findOne().lean();
  if (!ahorro || !ahorro.totalAcumulado || ahorro.totalAcumulado <= 0) {
    return { creado: false };
  }

  await AhorroMovimiento.create({
    monto: ahorro.totalAcumulado,
    descripcion: 'Saldo inicial (migración)',
    fecha: ahorro.ultimaActualizacion || new Date(),
  });

  return { creado: true, monto: ahorro.totalAcumulado };
};
