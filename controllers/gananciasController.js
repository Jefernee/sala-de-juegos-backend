// controllers/gananciasController.js
// Módulo de Administración: Ganancias
// CRUD completo: crear, listar por mes (con totales), ver, editar, eliminar.
import mongoose from 'mongoose';
import Ganancia, { TIPOS_GANANCIA } from '../models/Ganancia.js';
import { crearFiltroMes, crearFechaParaMes } from '../utils/dateUtils.js';
import { regenerarEstadoDeFecha } from './estadoResultadosController.js';

// Helper:
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
// POST /api/ganancias — Registrar nueva ganancia
// La fecha SIEMPRE la asigna el backend. El frontend puede enviar
// mes y anio (opcionales) para registrar el monto en el mes elegido;
// si no los envía, queda en el mes actual con la fecha de ahora.
// ============================================
export const addGanancia = async (req, res) => {
  try {
    const { tipo, monto, descripcion } = req.body;

    if (!tipo || !TIPOS_GANANCIA.includes(tipo)) {
      return res.status(400).json({
        message: `El tipo es obligatorio. Valores válidos: ${TIPOS_GANANCIA.join(', ')}`,
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

    const ganancia = await Ganancia.create({
      tipo,
      monto: montoNum,
      descripcion: descripcion?.trim() || null,
      ...(resultadoFecha.fecha && { fecha: resultadoFecha.fecha }),
    });

    res.status(201).json({ message: 'Ganancia registrada', data: ganancia });

    // ✅ Regenerar estado de resultados del mes en background
    regenerarEstadoDeFecha(ganancia.fecha);
  } catch (error) {
    console.error('❌ Error al registrar ganancia:', error);
    res.status(500).json({ message: 'Error al registrar la ganancia', error: error.message });
  }
};

// ============================================
// GET /api/ganancias?mes=6&anio=2026[&page=1&limit=12]
// Filtra por mes/año (zona horaria Costa Rica) y calcula:
//   - totalMes:     suma de montos del mes filtrado (agregación)
//   - totalGeneral: suma de TODOS los registros (agregación)
// Paginación opcional: si viene "page" se pagina, si no, devuelve todo el mes.
// ============================================
export const getGanancias = async (req, res) => {
  try {
    const mes = parseInt(req.query.mes);
    const anio = parseInt(req.query.anio);

    if (!mes || !anio || mes < 1 || mes > 12 || anio < 2000 || anio > 2100) {
      return res.status(400).json({
        message: 'Los parámetros mes (1-12) y anio son obligatorios. Ej: /api/ganancias?mes=6&anio=2026',
      });
    }

    const filtro = { fecha: crearFiltroMes(mes, anio) };

    // Paginación opcional
    const page = parseInt(req.query.page) || null;
    const limit = Math.min(parseInt(req.query.limit) || 12, 100);

    let consulta = Ganancia.find(filtro).sort({ fecha: -1 });
    if (page) {
      consulta = consulta.skip((page - 1) * limit).limit(limit);
    }

    // Totales con agregación (no se carga toda la colección en memoria)
    const [data, totalMesAgg, totalGeneralAgg, totalRegistrosMes] = await Promise.all([
      consulta.lean(),
      Ganancia.aggregate([{ $match: filtro }, { $group: { _id: null, total: { $sum: '$monto' } } }]),
      Ganancia.aggregate([{ $group: { _id: null, total: { $sum: '$monto' } } }]),
      Ganancia.countDocuments(filtro),
    ]);

    const respuesta = {
      data,
      totalMes: totalMesAgg[0]?.total || 0,
      totalGeneral: totalGeneralAgg[0]?.total || 0,
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
    console.error('❌ Error al obtener ganancias:', error);
    res.status(500).json({ message: 'Error al obtener las ganancias', error: error.message });
  }
};

// ============================================
// GET /api/ganancias/:id — Ver una ganancia
// ============================================
export const getGananciaById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'ID de ganancia inválido' });
    }

    const ganancia = await Ganancia.findById(req.params.id).lean();
    if (!ganancia) {
      return res.status(404).json({ message: 'Ganancia no encontrada' });
    }

    res.status(200).json({ data: ganancia });
  } catch (error) {
    console.error('❌ Error al obtener ganancia:', error);
    res.status(500).json({ message: 'Error al obtener la ganancia', error: error.message });
  }
};

// ============================================
// PUT /api/ganancias/:id — Editar ganancia
// Se pueden editar tipo, monto y descripcion. Además, si se envían
// mes y anio, el backend recalcula la fecha para mover el registro
// a ese mes (el frontend nunca envía fechas).
// ============================================
export const updateGanancia = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'ID de ganancia inválido' });
    }

    // Fecha anterior: para regenerar también el mes viejo si el registro se mueve.
    const gananciaAnterior = await Ganancia.findById(req.params.id).select('fecha').lean();

    const { tipo, monto, descripcion } = req.body;
    const $set = {};

    if (tipo !== undefined) {
      if (!TIPOS_GANANCIA.includes(tipo)) {
        return res.status(400).json({
          message: `Tipo inválido. Valores válidos: ${TIPOS_GANANCIA.join(', ')}`,
        });
      }
      $set.tipo = tipo;
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

    const ganancia = await Ganancia.findByIdAndUpdate(
      req.params.id,
      { $set },
      { new: true, runValidators: true }
    );

    if (!ganancia) {
      return res.status(404).json({ message: 'Ganancia no encontrada' });
    }

    res.status(200).json({ message: 'Ganancia actualizada', data: ganancia });

    // ✅ Regenerar estado de resultados en background (mes viejo y nuevo)
    regenerarEstadoDeFecha(gananciaAnterior?.fecha, ganancia.fecha);
  } catch (error) {
    console.error('❌ Error al actualizar ganancia:', error);
    res.status(500).json({ message: 'Error al actualizar la ganancia', error: error.message });
  }
};

// ============================================
// DELETE /api/ganancias/:id — Eliminar ganancia
// ============================================
export const deleteGanancia = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'ID de ganancia inválido' });
    }

    const ganancia = await Ganancia.findByIdAndDelete(req.params.id);
    if (!ganancia) {
      return res.status(404).json({ message: 'Ganancia no encontrada' });
    }

    res.status(200).json({ message: 'Ganancia eliminada', id: req.params.id });

    // ✅ Regenerar estado de resultados del mes en background
    regenerarEstadoDeFecha(ganancia.fecha);
  } catch (error) {
    console.error('❌ Error al eliminar ganancia:', error);
    res.status(500).json({ message: 'Error al eliminar la ganancia', error: error.message });
  }
};
