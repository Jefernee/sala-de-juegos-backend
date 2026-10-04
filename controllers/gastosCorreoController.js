// controllers/gastosCorreoController.js
// Gastos automáticos desde el correo del BCR (Finanzas Personales).
//
// Cuando el administrador paga con la tarjeta BCR, el banco le manda el correo
// "Notificación de Transacciones BCR" a su Gmail. Un Google Apps Script en ese
// Gmail le reenvía el HTML del correo a este endpoint, y acá se anota como
// egreso del mes — igual que si lo hubiera anotado a mano.
//
// No usa el token de sesión (el script no inicia sesión): se protege con una
// clave compartida en el header `x-clave-correo` = CORREO_BCR_CLAVE. El dueño de
// los gastos es el usuario cuyo email es CORREO_BCR_USUARIO_EMAIL.
//
// Qué se ignora (ver utils/correoBCR.js): retiros de efectivo en cajero y
// transacciones no aprobadas (ej. "Negada").
import crypto from 'node:crypto';
import MovimientoPersonal from '../models/MovimientoPersonal.js';
import User from '../models/User.js';
import { leerTransacciones, decidir } from '../utils/correoBCR.js';
import { obtenerTipoCambio, regenerarResumenDeFecha } from './finanzasPersonalesController.js';

// Comparación en tiempo constante para no filtrar la clave por tiempos.
const claveValida = (recibida) => {
  const esperada = process.env.CORREO_BCR_CLAVE;
  if (!esperada || typeof recibida !== 'string') return false;
  const a = Buffer.from(recibida);
  const b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// ============================================
// POST /api/gastos-correo/bcr
// Header: x-clave-correo: <CORREO_BCR_CLAVE>
// Body:   { html, prueba? }
//   html   → el cuerpo HTML del correo tal cual.
//   prueba → true: responde qué haría con cada transacción SIN guardar nada.
// Responde { resultados: [{ comercio, monto, moneda, fecha, accion, motivo?,
// categoria?, id? }] } donde accion es 'anotado' | 'repetido' | 'ignorado' |
// 'anotaria' (en prueba). El script de Gmail usa esto para etiquetar el correo.
// ============================================
export const recibirCorreoBCR = async (req, res) => {
  if (!process.env.CORREO_BCR_CLAVE) {
    console.error('❌ CORREO_BCR_CLAVE no está configurada');
    return res.status(503).json({ message: 'Gastos desde el correo no está configurado' });
  }
  if (!claveValida(req.get('x-clave-correo'))) {
    return res.status(401).json({ message: 'Clave inválida' });
  }

  const { html, prueba } = req.body || {};
  if (typeof html !== 'string' || !html.trim()) {
    return res.status(400).json({ message: 'Falta el HTML del correo (html)' });
  }

  try {
    const email = String(process.env.CORREO_BCR_USUARIO_EMAIL || '').trim().toLowerCase();
    const usuario = email ? await User.findOne({ email }).select('_id').lean() : null;
    if (!usuario) {
      console.error('❌ CORREO_BCR_USUARIO_EMAIL no corresponde a ningún usuario:', email);
      return res.status(503).json({ message: 'El dueño de los gastos no está configurado' });
    }

    const transacciones = leerTransacciones(html);
    if (transacciones.length === 0) {
      return res.status(422).json({ message: 'No se encontró ninguna transacción en el correo' });
    }

    const resultados = [];
    const fechasTocadas = [];

    for (const tx of transacciones) {
      const base = {
        comercio: tx.comercio,
        monto: tx.monto,
        moneda: tx.moneda,
        fecha: tx.fechaTexto,
        referencia: tx.referencia,
      };
      const decision = decidir(tx);

      if (decision.accion === 'ignorar') {
        resultados.push({ ...base, accion: 'ignorado', motivo: decision.motivo, retiro: !!decision.retiro });
        continue;
      }

      const referenciaBanco = `${tx.autorizacion}-${tx.referencia}`;
      const yaEsta = await MovimientoPersonal.findOne({ usuario: usuario._id, referenciaBanco })
        .select('_id')
        .lean();
      if (yaEsta) {
        resultados.push({ ...base, accion: 'repetido', id: yaEsta._id });
        continue;
      }

      // Colones: tal cual. Dólares: a colones con el tipo de cambio de VENTA
      // (lo que cuesta comprar dólares), igual que un gasto en USD anotado a mano.
      let dinero = { monto: tx.monto, moneda: 'CRC', montoOriginal: tx.monto, tipoCambio: null };
      if (tx.moneda === 'USD') {
        const tc = await obtenerTipoCambio();
        dinero = {
          monto: Math.round(tx.monto * tc.venta),
          moneda: 'USD',
          montoOriginal: tx.monto,
          tipoCambio: tc.venta,
        };
      }

      if (prueba) {
        resultados.push({ ...base, accion: 'anotaria', categoria: decision.categoria, montoColones: dinero.monto });
        continue;
      }

      try {
        const mov = await MovimientoPersonal.create({
          usuario: usuario._id,
          tipo: 'egreso',
          categoria: decision.categoria,
          fondo: 'mes',
          ...dinero,
          descripcion: tx.comercio,
          fecha: tx.fecha,
          origen: 'correo_bcr',
          referenciaBanco,
        });
        fechasTocadas.push(mov.fecha);
        resultados.push({ ...base, accion: 'anotado', categoria: decision.categoria, montoColones: dinero.monto, id: mov._id });
      } catch (error) {
        // Dos correos iguales procesados al mismo tiempo: el índice único frena
        // al segundo. No es un error, es el mismo gasto.
        if (error?.code === 11000) {
          resultados.push({ ...base, accion: 'repetido' });
          continue;
        }
        throw error;
      }
    }

    if (fechasTocadas.length) {
      await regenerarResumenDeFecha(usuario._id, ...fechasTocadas);
    }

    return res.status(200).json({ prueba: !!prueba, resultados });
  } catch (error) {
    console.error('❌ Error al procesar el correo del BCR:', error);
    return res.status(500).json({ message: 'Error al procesar el correo', error: error.message });
  }
};
