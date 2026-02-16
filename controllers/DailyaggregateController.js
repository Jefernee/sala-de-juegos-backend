// ============================================
// controllers/reportsController.js
// Reportes usando DailyAggregate como fuente principal
// ============================================
import DailyAggregate from '../models/Dailyaggregate.js';
import Pedido from '../models/Pedido.js';

// ==========================================
// RESUMEN GENERAL
// Usado por: GET /api/reports/resumen
// ==========================================
export const getResumenGeneral = async (req, res) => {
  try {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    
    // Mes actual
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 23, 59, 59, 999);

    // ==========================================
    // 1. VENTAS DE HOY (desde DailyAggregate)
    // ==========================================
    const ventasHoyData = await DailyAggregate.aggregate([
      {
        $match: {
          fecha: hoy,
          esVenta: true
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalVentas' },
          ganancias: { $sum: '$gananciaTotal' }
        }
      }
    ]);

    const ventasHoy = ventasHoyData[0] || { total: 0, ganancias: 0 };

    // ==========================================
    // 2. VENTAS DEL MES (desde DailyAggregate)
    // ==========================================
    const ventasMesData = await DailyAggregate.aggregate([
      {
        $match: {
          fecha: { $gte: inicioMes, $lte: finMes },
          esVenta: true
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalVentas' },
          ganancias: { $sum: '$gananciaTotal' }
        }
      }
    ]);

    const ventasMes = ventasMesData[0] || { total: 0, ganancias: 0 };

    // ==========================================
    // 3. INVENTARIO (snapshot más reciente en DailyAggregate)
    // ==========================================
    const ultimaFecha = await DailyAggregate.findOne()
      .sort({ fecha: -1 })
      .select('fecha')
      .lean();

    let inventarioTotal = { 
      totalProductos: 0, 
      totalUnidades: 0, 
      valorTotal: 0 
    };
    
    let inventarioVenta = { 
      totalProductos: 0, 
      totalUnidades: 0, 
      valorTotal: 0, 
      stockBajo: 0, 
      agotados: 0 
    };

    if (ultimaFecha) {
      const productos = await DailyAggregate.find({ 
        fecha: ultimaFecha.fecha 
      }).lean();

      // Inventario Total
      inventarioTotal = {
        totalProductos: productos.length,
        totalUnidades: productos.reduce((sum, p) => sum + p.stockFinal, 0),
        valorTotal: productos.reduce((sum, p) => sum + (p.stockFinal * p.precioPromedio), 0)
      };

      // Inventario de Venta
      const productosVenta = productos.filter(p => p.esVenta);
      inventarioVenta = {
        totalProductos: productosVenta.length,
        totalUnidades: productosVenta.reduce((sum, p) => sum + p.stockFinal, 0),
        valorTotal: productosVenta.reduce((sum, p) => sum + (p.stockFinal * p.precioPromedio), 0),
        stockBajo: productos.filter(p => p.estadoStock === 'bajo' && p.esVenta).length,
        agotados: productos.filter(p => p.estadoStock === 'agotado' && p.esVenta).length
      };
    }

    // ==========================================
    // 4. PEDIDOS PENDIENTES (colección Pedido)
    // ==========================================
    const pedidosPendientes = await Pedido.countDocuments({ 
      estado: 'pendiente' 
    });

    res.json({
      ventasHoy,
      ventasMes,
      inventarioTotal,
      inventarioVenta,
      pedidosPendientes
    });

  } catch (error) {
    console.error('❌ Error en getResumenGeneral:', error);
    res.status(500).json({ error: 'Error al obtener resumen general' });
  }
};

// ==========================================
// STOCK BAJO
// Usado por: GET /api/reports/stock-bajo
// ==========================================
export const getStockBajo = async (req, res) => {
  try {
    // Obtener snapshot más reciente
    const ultimaFecha = await DailyAggregate.findOne()
      .sort({ fecha: -1 })
      .select('fecha')
      .lean();

    if (!ultimaFecha) {
      return res.json({
        stockBajo: [],
        agotados: []
      });
    }

    // Productos con stock bajo
    const stockBajo = await DailyAggregate.find({
      fecha: ultimaFecha.fecha,
      esVenta: true,
      estadoStock: 'bajo'
    })
    .select('nombreProducto stockFinal')
    .lean();

    // Productos agotados
    const agotados = await DailyAggregate.find({
      fecha: ultimaFecha.fecha,
      esVenta: true,
      estadoStock: 'agotado'
    })
    .select('nombreProducto stockFinal')
    .lean();

    res.json({
      stockBajo: stockBajo.map(p => ({
        nombre: p.nombreProducto,
        cantidad: p.stockFinal
      })),
      agotados: agotados.map(p => ({
        nombre: p.nombreProducto,
        cantidad: p.stockFinal
      }))
    });

  } catch (error) {
    console.error('❌ Error en getStockBajo:', error);
    res.status(500).json({ error: 'Error al obtener stock bajo' });
  }
};

// ==========================================
// ESTADÍSTICAS DE PEDIDOS
// Usado por: GET /api/reports/pedidos-stats
// ==========================================
export const getPedidosStats = async (req, res) => {
  try {
    const estadisticas = await Pedido.aggregate([
      {
        $group: {
          _id: '$estado',
          cantidad: { $sum: 1 }
        }
      }
    ]);

    const stats = {
      total: 0,
      pendientes: 0,
      confirmados: 0,
      completados: 0,
      cancelados: 0
    };

    estadisticas.forEach(stat => {
      stats.total += stat.cantidad;
      stats[stat._id + 's'] = stat.cantidad;
    });

    // Pedidos recientes
    const recientes = await Pedido.find()
      .sort({ fecha: -1 })
      .limit(5)
      .populate('productoId', 'nombre imagen')
      .lean();

    res.json({
      estadisticas: stats,
      recientes
    });

  } catch (error) {
    console.error('❌ Error en getPedidosStats:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas de pedidos' });
  }
};
