// controllers/pagosServiciosController.js
// Hecho por Claude Code — Módulo de Administración: Pagos de Servicios
// CRUD completo: crear, listar por mes (con totalMes), ver, editar, eliminar.
import mongoose from 'mongoose';
import PagoServicio, { TIPOS_SERVICIO } from '../models/PagoServicio.js';
import { crearFiltroMes, crearFechaParaMes } from '../utils/dateUtils.js';
import { regenerarEstadoDeFecha } from './estadoResultadosController.js';

// Helper — Hecho por Claude Code:
// Resuelve la fecha a guardar según el mes/año elegido en el frontend.
// El frontend NUNCA envía fechas, solo mes y anio (opcionales: si no
// vienen, el registro queda en el mes actual con la fecha de ahora).
// Retorna: { fecha: Date } | { fecha: undefined } (no vinieron) | { error: string }
const resolverFechaDelMes = (mesRaw, anioRaw) => {
  if (mesRaw === undefined && anioRaw === undefined) return { fecha: undefined };

  const mes = parseInt(mesRaw);
  const anio = parseInt(anioRaw);

  if (!mes || !anio || mes < 1 || mes > 12 || anio < 2000 || anio > 2100) {
    return { error: 'mes (1-12) y anio deben enviarse juntos y ser válidos' };
  }

  const fecha = crearFechaParaMes(mes, anio);
  if (!fecha) {
    return { error: 'No se pueden registrar montos en meses futuros' };
  }

  return { fecha };
};

// ============================================
// POST /api/pagos-servicios — Registrar nuevo pago
// La fecha SIEMPRE la asigna el backend. El frontend puede enviar
// mes y anio (opcionales) para registrar el pago en el mes elegido;
// si no los envía, queda en el mes actual con la fecha de ahora.
// ============================================
export const addPagoServicio = async (req, res) => {
  try {
    const { servicio, monto, descripcion } = req.body;

    if (!servicio || !TIPOS_SERVICIO.includes(servicio)) {
      return res.status(400).json({
        message: `El servicio es obligatorio. Valores válidos: ${TIPOS_SERVICIO.join(', ')}`,
      });
    }

    const montoNum = Number(monto);
    if (monto === undefined || monto === null || isNaN(montoNum) || montoNum <= 0) {
      return res.status(400).json({ message: 'El monto es obligatorio y debe ser un número mayor a 0' });
    }

    // Mes elegido en el frontend (opcional) — la fecha la resuelve el backend
    const resultadoFecha = resolverFechaDelMes(req.body.mes, req.body.anio);
    if (resultadoFecha.error) {
      return res.status(400).json({ message: resultadoFecha.error });
    }

    const pago = await PagoServicio.create({
      servicio,
      monto: montoNum,
      descripcion: descripcion?.trim() || null,
      ...(resultadoFecha.fecha && { fecha: resultadoFecha.fecha }),
    });

    res.status(201).json({ message: 'Pago registrado', data: pago });

    // ✅ Regenerar estado de resultados del mes en background
    regenerarEstadoDeFecha(pago.fecha);
  } catch (error) {
    console.error('❌ Error al registrar pago de servicio:', error);
    res.status(500).json({ message: 'Error al registrar el pago', error: error.message });
  }
};

// ============================================
// GET /api/pagos-servicios?mes=6&anio=2026[&page=1&limit=12]
// Filtra por mes/año (zona horaria Costa Rica) y calcula totalMes.
// Paginación opcional: si viene "page" se pagina, si no, devuelve todo el mes.
// ============================================
export const getPagosServicios = async (req, res) => {
  try {
    const mes = parseInt(req.query.mes);
    const anio = parseInt(req.query.anio);

    if (!mes || !anio || mes < 1 || mes > 12 || anio < 2000 || anio > 2100) {
      return res.status(400).json({
        message: 'Los parámetros mes (1-12) y anio son obligatorios. Ej: /api/pagos-servicios?mes=6&anio=2026',
      });
    }

    const filtro = { fecha: crearFiltroMes(mes, anio) };

    // Paginación opcional
    const page = parseInt(req.query.page) || null;
    const limit = Math.min(parseInt(req.query.limit) || 12, 100);

    let consulta = PagoServicio.find(filtro).sort({ fecha: -1 });
    if (page) {
      consulta = consulta.skip((page - 1) * limit).limit(limit);
    }

    // totalMes con agregación (no se carga toda la colección en memoria)
    const [data, totalMesAgg, totalRegistrosMes] = await Promise.all([
      consulta.lean(),
      PagoServicio.aggregate([{ $match: filtro }, { $group: { _id: null, total: { $sum: '$monto' } } }]),
      PagoServicio.countDocuments(filtro),
    ]);

    const respuesta = {
      data,
      totalMes: totalMesAgg[0]?.total || 0,
    };

    if (page) {
      const totalPages = Math.ceil(totalRegistrosMes / limit);
      respuesta.pagination = {
        currentPage: page,
        totalPages,
        totalItems: totalRegistrosMes,
        itemsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      };
    }

    res.status(200).json(respuesta);
  } catch (error) {
    console.error('❌ Error al obtener pagos de servicios:', error);
    res.status(500).json({ message: 'Error al obtener los pagos', error: error.message });
  }
};

// ============================================
// GET /api/pagos-servicios/:id — Ver un pago
// ============================================
export const getPagoServicioById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'ID de pago inválido' });
    }

    const pago = await PagoServicio.findById(req.params.id).lean();
    if (!pago) {
      return res.status(404).json({ message: 'Pago no encontrado' });
    }

    res.status(200).json({ data: pago });
  } catch (error) {
    console.error('❌ Error al obtener pago de servicio:', error);
    res.status(500).json({ message: 'Error al obtener el pago', error: error.message });
  }
};

// ============================================
// PUT /api/pagos-servicios/:id — Editar pago
// Se pueden editar servicio, monto y descripcion. Además, si se envían
// mes y anio, el backend recalcula la fecha para mover el registro
// a ese mes (el frontend nunca envía fechas).
// ============================================
export const updatePagoServicio = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'ID de pago inválido' });
    }

    // Fecha anterior: para regenerar también el mes viejo si el registro se mueve.
    const pagoAnterior = await PagoServicio.findById(req.params.id).select('fecha').lean();

    const { servicio, monto, descripcion } = req.body;
    const $set = {};

    if (servicio !== undefined) {
      if (!TIPOS_SERVICIO.includes(servicio)) {
        return res.status(400).json({
          message: `Servicio inválido. Valores válidos: ${TIPOS_SERVICIO.join(', ')}`,
        });
      }
      $set.servicio = servicio;
    }

    if (monto !== undefined) {
      const montoNum = Number(monto);
      if (isNaN(montoNum) || montoNum <= 0) {
        return res.status(400).json({ message: 'El monto debe ser un número mayor a 0' });
      }
      $set.monto = montoNum;
    }

    if (descripcion !== undefined) {
      $set.descripcion = descripcion?.trim() || null;
    }

    // Mover el registro a otro mes: el backend recalcula la fecha
    if (req.body.mes !== undefined || req.body.anio !== undefined) {
      const resultadoFecha = resolverFechaDelMes(req.body.mes, req.body.anio);
      if (resultadoFecha.error) {
        return res.status(400).json({ message: resultadoFecha.error });
      }
      if (resultadoFecha.fecha) $set.fecha = resultadoFecha.fecha;
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ message: 'No se enviaron campos para actualizar' });
    }

    const pago = await PagoServicio.findByIdAndUpdate(
      req.params.id,
      { $set },
      { new: true, runValidators: true }
    );

    if (!pago) {
      return res.status(404).json({ message: 'Pago no encontrado' });
    }

    res.status(200).json({ message: 'Pago actualizado', data: pago });

    // ✅ Regenerar estado de resultados en background (mes viejo y nuevo)
    regenerarEstadoDeFecha(pagoAnterior?.fecha, pago.fecha);
  } catch (error) {
    console.error('❌ Error al actualizar pago de servicio:', error);
    res.status(500).json({ message: 'Error al actualizar el pago', error: error.message });
  }
};

// ============================================
// DELETE /api/pagos-servicios/:id — Eliminar pago
// ============================================
export const deletePagoServicio = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'ID de pago inválido' });
    }

    const pago = await PagoServicio.findByIdAndDelete(req.params.id);
    if (!pago) {
      return res.status(404).json({ message: 'Pago no encontrado' });
    }

    res.status(200).json({ message: 'Pago eliminado', id: req.params.id });

    // ✅ Regenerar estado de resultados del mes en background
    regenerarEstadoDeFecha(pago.fecha);
  } catch (error) {
    console.error('❌ Error al eliminar pago de servicio:', error);
    res.status(500).json({ message: 'Error al eliminar el pago', error: error.message });
  }
};
