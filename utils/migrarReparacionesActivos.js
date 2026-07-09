// utils/migrarReparacionesActivos.js
// Hecho por Claude Code — Migración idempotente al modelo nuevo de Activos:
//   - Los campos sueltos de reparación pasan a un item dentro de `reparaciones[]`.
//   - `fechaCompraReparacion` → `fechaCompra`.
//   - Los estados manuales viejos ("Fuera de servicio"/"Almacenado") → `estadoOverride`.
//   - `estado` se recalcula con la regla nueva (derivarEstado).
//   - Se eliminan los campos viejos (tipoRegistro, costoReparacion, problemaTecnico,
//     reparadoPor, imagenFacturaReparacionUrl, fechaCompraReparacion).
//
// Se corre al arrancar el servidor. Idempotente: solo toca los documentos que
// todavía tienen forma vieja (algún campo viejo presente o sin `reparaciones`).
//
// IMPORTANTE: escribe con el driver NATIVO (.collection) porque (a) los campos
// viejos ya no están en el schema y Mongoose los ignoraría, y (b) hay que hacer
// $unset. Asume que la conexión a MongoDB ya está abierta.
import mongoose from 'mongoose';
import ActivoSala, { derivarEstado, ESTADOS_OVERRIDE } from '../models/ActivoSala.js';
import { extraerPublicId } from './cloudinaryUtils.js';

// Documento que todavía tiene forma vieja: tiene algún campo viejo o le falta `reparaciones`.
const filtroPendientes = {
  $or: [
    { tipoRegistro: { $exists: true } },
    { costoReparacion: { $exists: true } },
    { problemaTecnico: { $exists: true } },
    { reparadoPor: { $exists: true } },
    { imagenFacturaReparacionUrl: { $exists: true } },
    { fechaCompraReparacion: { $exists: true } },
    { reparaciones: { $exists: false } },
  ],
};

const CAMPOS_VIEJOS = {
  tipoRegistro: '',
  costoReparacion: '',
  problemaTecnico: '',
  reparadoPor: '',
  imagenFacturaReparacionUrl: '',
  fechaCompraReparacion: '',
};

export const migrarReparacionesActivos = async () => {
  // Leemos con el driver nativo para conservar los campos viejos (el schema ya no los tiene).
  const pendientes = await ActivoSala.collection.find(filtroPendientes).toArray();

  let migrados = 0;
  for (const doc of pendientes) {
    const reparaciones = [];

    // ¿Tenía una reparación registrada a la vieja usanza?
    const costoRep = Number(doc.costoReparacion);
    const teniaReparacion = doc.tipoRegistro === 'Reparación' || (doc.costoReparacion != null && !isNaN(costoRep));
    if (teniaReparacion && !isNaN(costoRep) && costoRep > 0) {
      const facturaUrl = doc.imagenFacturaReparacionUrl || null;
      reparaciones.push({
        _id: new mongoose.Types.ObjectId(),
        costo: costoRep,
        problemaTecnico: doc.problemaTecnico || null,
        reparadoPor: doc.reparadoPor || null,
        fecha: doc.fechaCompraReparacion || null,
        facturaUrl,
        facturaPublicId: facturaUrl ? extraerPublicId(facturaUrl) : null,
        // Si el activo estaba "Reparado", la reparación vieja se da por finalizada.
        finalizada: doc.estado === 'Reparado',
        createdAt: doc.createdAt || doc.fechaCompraReparacion || null,
      });
    }

    // Estados manuales viejos → override; el resto queda automático.
    const estadoOverride = ESTADOS_OVERRIDE.includes(doc.estado) ? doc.estado : null;
    const estado = derivarEstado(reparaciones, estadoOverride);

    await ActivoSala.collection.updateOne(
      { _id: doc._id },
      {
        $set: {
          reparaciones,
          estadoOverride,
          estado,
          // Mover la fecha vieja (doble uso) a fecha de compra. null si no había.
          fechaCompra: doc.fechaCompraReparacion || null,
        },
        $unset: CAMPOS_VIEJOS,
      }
    );
    migrados++;
  }

  return { migrados, total: pendientes.length };
};
