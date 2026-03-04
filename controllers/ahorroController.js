import Ahorro from '../models/ahorro.js';
import { getUTCDateRanges } from '../utils/dateUtils.js';

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

    const { hoy } = getUTCDateRanges();

    ahorro.totalAcumulado += Number(monto);
    ahorro.ultimaActualizacion = hoy.inicio;

    await ahorro.save();

    res.status(200).json({ success: true, message: 'Ahorro actualizado exitosamente', data: ahorro });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al agregar ahorro', error: error.message });
  }
};