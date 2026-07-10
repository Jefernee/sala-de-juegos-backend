import Ahorro from '../models/ahorro.js';
import AhorroMovimiento from '../models/AhorroMovimiento.js';
import { getUTCDateRanges, crearFechaParaMes } from '../utils/dateUtils.js';

// GET - Obtener el ahorro acumulado
export const getAhorro = async (req, res) => {
  try {
    let ahorro = await Ahorro.findOne();

    if (!ahorro) {
      ahorro = await Ahorro.create({ totalAcumulado: 0, ultimaActualizacion: null });
    }

    res.status(200).json({ success: true, data: ahorro });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al obtener el ahorro', error: error.message });
  }
};

// POST - Agregar monto al ahorro
export const agregarAhorro = async (req, res) => {
  try {
    const { monto } = req.body;

    if (!monto || monto <= 0) {
      return res.status(400).json({ success: false, message: 'El monto debe ser mayor a 0' });
    }

    let ahorro = await Ahorro.findOne();

    if (!ahorro) {
      ahorro = await Ahorro.create({ totalAcumulado: 0, ultimaActualizacion: null });
    }

    // Fecha del movimiento: mes/anio opcionales (como ganancias/pagos); si no
    // vienen, queda con la fecha de hoy (medianoche CR).
    let fecha;
    if (req.body.mes !== undefined || req.body.anio !== undefined) {
      fecha = crearFechaParaMes(parseInt(req.body.mes), parseInt(req.body.anio));
      if (!fecha) {
        return res.status(400).json({ success: false, message: 'mes (1-12) y anio deben ser válidos y no futuros' });
      }
    } else {
      fecha = getUTCDateRanges().hoy.inicio;
    }

    ahorro.totalAcumulado += Number(monto);
    ahorro.ultimaActualizacion = fecha;
    await ahorro.save();

    // Registrar el movimiento para el historial (permite calcular ahorroDelMes).
    await AhorroMovimiento.create({
      monto: Number(monto),
      descripcion: req.body.descripcion?.trim() || null,
      fecha,
    });

    res.status(200).json({ success: true, message: 'Ahorro actualizado exitosamente', data: ahorro });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al agregar ahorro', error: error.message });
  }
};