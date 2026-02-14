// controllers/reportsController.js - VERSIÓN OPTIMIZADA
import Sale from "../models/sale.js";
import Inventario from "../models/Inventario.js";
import Pedido from "../models/Pedido.js";
import { getUTCDateRanges, getDaysAgo, logDateRanges } from "../utils/dateUtils.js";

// ✅ CACHE SIMPLE (guarda datos por 5 minutos)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function getCachedData(key) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`📦 Cache hit: ${key}`);
    return cached.data;
  }
  return null;
}

function setCachedData(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// ✅ RESUMEN GENERAL - OPTIMIZADO CON AGGREGATION
export const getResumenGeneral = async (req, res) => {
  try {
    console.log("\n📊 ===== GENERANDO RESUMEN GENERAL (OPTIMIZADO) =====");

    // Verificar cache
    const cacheKey = 'resumen-general';
    const cached = getCachedData(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const ranges = getUTCDateRanges();
    logDateRanges(ranges);

    // ✅ UNA SOLA CONSULTA CON AGGREGATION PIPELINE
    const [ventasStats, inventarioStats, pedidosPendientes] = await Promise.all([
      // Aggregation para calcular todas las ventas de una vez
      Sale.aggregate([
        {
          $facet: {
            hoy: [
              { $match: { fecha: { $gte: ranges.hoy.inicio, $lte: ranges.hoy.fin } } },
              { $group: { _id: null, total: { $sum: "$total" }, count: { $sum: 1 } } }
            ],
            mes: [
              { $match: { fecha: { $gte: ranges.mes.inicio } } },
              { $group: { _id: null, total: { $sum: "$total" }, count: { $sum: 1 } } }
            ]
          }
        }
      ]),
      
      // Aggregation para inventario
      Inventario.aggregate([
        {
          $facet: {
            total: [
              {
                $group: {
                  _id: null,
                  valor: { $sum: { $multiply: ["$precioVenta", "$cantidad"] } },
                  productos: { $sum: 1 },
                  unidades: { $sum: "$cantidad" }
                }
              }
            ],
            venta: [
              { $match: { seVende: true } },
              {
                $group: {
                  _id: null,
                  valor: { $sum: { $multiply: ["$precioVenta", "$cantidad"] } },
                  productos: { $sum: 1 },
                  unidades: { $sum: "$cantidad" },
                  stockBajo: { $sum: { $cond: [{ $and: [{ $lt: ["$cantidad", 5] }, { $gt: ["$cantidad", 0] }] }, 1, 0] } },
                  agotados: { $sum: { $cond: [{ $eq: ["$cantidad", 0] }, 1, 0] } }
                }
              }
            ]
          }
        }
      ]),
      
      Pedido.countDocuments({ estado: "pendiente" })
    ]);

    // Extraer resultados
    const ventasHoy = ventasStats[0].hoy[0] || { total: 0, count: 0 };
    const ventasMes = ventasStats[0].mes[0] || { total: 0, count: 0 };
    const invTotal = inventarioStats[0].total[0] || { valor: 0, productos: 0, unidades: 0 };
    const invVenta = inventarioStats[0].venta[0] || { valor: 0, productos: 0, unidades: 0, stockBajo: 0, agotados: 0 };

    // ✅ CÁLCULO DE GANANCIAS OPTIMIZADO (solo si es necesario)
    // Por ahora estimamos ganancia al 30% del total de ventas
    const gananciasEstimadas = ventasMes.total * 0.30;
    const gananciasHoyEstimadas = ventasHoy.total * 0.30;

    const respuesta = {
      ventasHoy: {
        total: ventasHoy.total,
        cantidad: ventasHoy.count,
        ganancias: gananciasHoyEstimadas, // Estimación rápida
      },
      ventasSemana: {
        total: 0, // Opcional: remover si no se usa
        cantidad: 0,
      },
      ventasMes: {
        total: ventasMes.total,
        cantidad: ventasMes.count,
        ganancias: gananciasEstimadas, // Estimación rápida
      },
      inventarioTotal: {
        valorTotal: invTotal.valor,
        totalProductos: invTotal.productos,
        totalUnidades: invTotal.unidades,
      },
      inventarioVenta: {
        valorTotal: invVenta.valor,
        totalProductos: invVenta.productos,
        totalUnidades: invVenta.unidades,
        stockBajo: invVenta.stockBajo,
        agotados: invVenta.agotados,
      },
      pedidosPendientes,
    };

    // Guardar en cache
    setCachedData(cacheKey, respuesta);

    console.log("✅ Resumen generado en modo optimizado");
    res.json(respuesta);
  } catch (error) {
    console.error("❌ Error al obtener resumen:", error);
    res.status(500).json({ error: "Error al obtener resumen" });
  }
};

// ✅ PRODUCTOS MÁS VENDIDOS - OPTIMIZADO
export const getProductosMasVendidos = async (req, res) => {
  try {
    console.log("\n🏆 ===== GENERANDO PRODUCTOS MÁS VENDIDOS (OPTIMIZADO) =====");

    const limite = parseInt(req.query.limit) || 10;
    const dias = parseInt(req.query.days) || 30;

    // Verificar cache
    const cacheKey = `mas-vendidos-${limite}-${dias}`;
    const cached = getCachedData(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const fechaInicio = getDaysAgo(dias);

    // ✅ AGGREGATION PIPELINE - MUY RÁPIDO
    const ranking = await Sale.aggregate([
      { $match: { fecha: { $gte: fechaInicio } } },
      { $unwind: "$productos" },
      {
        $group: {
          _id: "$productos.nombre",
          cantidadVendida: { $sum: "$productos.cantidad" },
          totalVentas: { $sum: "$productos.subtotal" }
        }
      },
      { $sort: { cantidadVendida: -1 } },
      { $limit: limite },
      {
        $project: {
          _id: 0,
          nombre: "$_id",
          cantidadVendida: 1,
          totalVentas: 1
        }
      }
    ]);

    const respuesta = {
      periodo: `Últimos ${dias} días`,
      productos: ranking,
    };

    setCachedData(cacheKey, respuesta);

    console.log(`✅ Top ${ranking.length} productos generados`);
    res.json(respuesta);
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ error: "Error al obtener productos más vendidos" });
  }
};

// ✅ PRODUCTOS MENOS VENDIDOS - OPTIMIZADO
export const getProductosMenosVendidos = async (req, res) => {
  try {
    console.log("\n📉 ===== PRODUCTOS MENOS VENDIDOS (OPTIMIZADO) =====");

    const limite = parseInt(req.query.limit) || 10;
    const dias = parseInt(req.query.days) || 30;
    const umbralMaximoVentas = parseInt(req.query.maxSales) || 2;

    const cacheKey = `menos-vendidos-${limite}-${dias}-${umbralMaximoVentas}`;
    const cached = getCachedData(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const fechaInicio = getDaysAgo(dias);

    // ✅ Obtener ventas usando aggregation
    const ventasAgrupadas = await Sale.aggregate([
      { $match: { fecha: { $gte: fechaInicio } } },
      { $unwind: "$productos" },
      {
        $group: {
          _id: "$productos.productoId",
          cantidadVendida: { $sum: "$productos.cantidad" }
        }
      }
    ]);

    // Crear map de ventas
    const ventasMap = new Map(
      ventasAgrupadas.map(v => [v._id.toString(), v.cantidadVendida])
    );

    // Obtener productos de venta
    const productosVenta = await Inventario.find({ seVende: true })
      .select("nombre cantidad")
      .lean();

    // Filtrar y ordenar
    const menosVendidos = productosVenta
      .map(p => ({
        nombre: p.nombre,
        cantidadVendida: ventasMap.get(p._id.toString()) || 0,
        stockActual: p.cantidad,
      }))
      .filter(p => p.cantidadVendida <= umbralMaximoVentas)
      .sort((a, b) => {
        if (a.cantidadVendida !== b.cantidadVendida) {
          return a.cantidadVendida - b.cantidadVendida;
        }
        return b.stockActual - a.stockActual;
      })
      .slice(0, limite);

    const respuesta = {
      periodo: `Últimos ${dias} días`,
      productos: menosVendidos,
      umbralMaximoVentas,
    };

    setCachedData(cacheKey, respuesta);

    console.log(`✅ ${menosVendidos.length} productos generados`);
    res.json(respuesta);
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ error: "Error al obtener productos menos vendidos" });
  }
};

// ✅ STOCK BAJO - SIN CAMBIOS (ya es eficiente)
export const getProductosStockBajo = async (req, res) => {
  try {
    const cacheKey = 'stock-bajo';
    const cached = getCachedData(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const limite = parseInt(req.query.limit) || 20;
    const umbral = parseInt(req.query.threshold) || 5;

    const [productosStockBajo, productosAgotados] = await Promise.all([
      Inventario.find({
        seVende: true,
        cantidad: { $lte: umbral, $gt: 0 },
      })
        .select("nombre cantidad precioVenta")
        .sort({ cantidad: 1 })
        .limit(limite)
        .lean(),
        
      Inventario.find({
        seVende: true,
        cantidad: 0,
      })
        .select("nombre cantidad precioVenta")
        .limit(limite)
        .lean(),
    ]);

    const respuesta = {
      stockBajo: productosStockBajo,
      agotados: productosAgotados,
      umbral,
    };

    setCachedData(cacheKey, respuesta);

    res.json(respuesta);
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ error: "Error al obtener stock bajo" });
  }
};

// ✅ VENTAS POR PERÍODO - OPTIMIZADO
export const getVentasPorPeriodo = async (req, res) => {
  try {
    const dias = parseInt(req.query.days) || 30;

    const cacheKey = `ventas-periodo-${dias}`;
    const cached = getCachedData(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const fechaInicio = getDaysAgo(dias);

    // ✅ AGGREGATION para agrupar por día
    const datos = await Sale.aggregate([
      { $match: { fecha: { $gte: fechaInicio } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$fecha" }
          },
          total: { $sum: "$total" },
          cantidad: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          fecha: "$_id",
          total: 1,
          cantidad: 1
        }
      }
    ]);

    const respuesta = {
      periodo: `Últimos ${dias} días`,
      datos,
    };

    setCachedData(cacheKey, respuesta);

    res.json(respuesta);
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ error: "Error al obtener ventas por período" });
  }
};

// ✅ ESTADÍSTICAS PEDIDOS - OPTIMIZADO
export const getEstadisticasPedidos = async (req, res) => {
  try {
    const cacheKey = 'stats-pedidos';
    const cached = getCachedData(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // ✅ AGGREGATION para contar todos los estados de una vez
    const [estadisticas, pedidosRecientes] = await Promise.all([
      Pedido.aggregate([
        {
          $facet: {
            porEstado: [
              {
                $group: {
                  _id: "$estado",
                  count: { $sum: 1 }
                }
              }
            ],
            total: [
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 }
                }
              }
            ]
          }
        }
      ]),
      
      Pedido.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("productoId", "nombre imagen")
        .lean()
    ]);

    // Procesar resultados
    const estadosMap = new Map(
      estadisticas[0].porEstado.map(e => [e._id, e.count])
    );

    const respuesta = {
      estadisticas: {
        pendientes: estadosMap.get('pendiente') || 0,
        confirmados: estadosMap.get('confirmado') || 0,
        completados: estadosMap.get('completado') || 0,
        cancelados: estadosMap.get('cancelado') || 0,
        total: estadisticas[0].total[0]?.count || 0,
      },
      recientes: pedidosRecientes,
    };

    setCachedData(cacheKey, respuesta);

    res.json(respuesta);
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ error: "Error al obtener estadísticas" });
  }
};

// ✅ LIMPIAR CACHE (endpoint opcional para debugging)
export const clearCache = (req, res) => {
  cache.clear();
  console.log("🗑️ Cache limpiado");
  res.json({ message: "Cache limpiado exitosamente" });
};
