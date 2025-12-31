// controllers/reportsController.js
import Sale from '../models/Sale.js';
import Inventario from '../models/Inventario.js';
import Pedido from '../models/Pedido.js';

// Obtener resumen general
export const getResumenGeneral = async (req, res) => {
  try {
    console.log("\n📊 ===== GENERANDO RESUMEN GENERAL =====");
    
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const inicioSemana = new Date(hoy);
    inicioSemana.setDate(hoy.getDate() - hoy.getDay());

    // Ventas de hoy, semana y mes
    const [ventasHoy, ventasSemana, ventasMes, todosProductos, productosVenta, pedidosPendientes] = await Promise.all([
      Sale.find({ fecha: { $gte: hoy } }),
      Sale.find({ fecha: { $gte: inicioSemana } }),
      Sale.find({ fecha: { $gte: inicioMes } }),
      Inventario.find().select('nombre cantidad precioCompra precioVenta seVende'),
      Inventario.find({ seVende: true }).select('nombre cantidad precioCompra precioVenta'),
      Pedido.countDocuments({ estado: 'pendiente' })
    ]);

    console.log(`✓ Total productos en BD: ${todosProductos.length}`);
    console.log(`✓ Productos con seVende=true: ${productosVenta.length}`);

    // Calcular totales de ventas
    const totalVentasHoy = ventasHoy.reduce((sum, v) => sum + v.total, 0);
    const totalVentasSemana = ventasSemana.reduce((sum, v) => sum + v.total, 0);
    const totalVentasMes = ventasMes.reduce((sum, v) => sum + v.total, 0);

    // Calcular ganancias (precio venta - precio compra)
    let gananciasTotales = 0;
    ventasMes.forEach(venta => {
      venta.productos.forEach(item => {
        const producto = todosProductos.find(p => p._id.toString() === item.productoId?.toString());
        if (producto) {
          const ganancia = (item.precioVenta - producto.precioCompra) * item.cantidad;
          gananciasTotales += ganancia;
        }
      });
    });

    // ✅ INVENTARIO TOTAL (todos los productos de la sala)
    const valorInventarioTotal = todosProductos.reduce((sum, p) => {
      return sum + (p.precioVenta * p.cantidad);
    }, 0);

    const cantidadInventarioTotal = todosProductos.reduce((sum, p) => {
      return sum + p.cantidad;
    }, 0);

    // ✅ INVENTARIO DE VENTA (solo productos con seVende: true)
    const valorInventarioVenta = productosVenta.reduce((sum, p) => {
      return sum + (p.precioVenta * p.cantidad);
    }, 0);

    const cantidadInventarioVenta = productosVenta.reduce((sum, p) => {
      return sum + p.cantidad;
    }, 0);

    console.log(`💰 Valor inventario venta calculado: ₡${valorInventarioVenta}`);
    console.log("📦 Desglose:");
    productosVenta.forEach(p => {
      const valor = p.precioVenta * p.cantidad;
      console.log(`   - ${p.nombre}: ${p.cantidad} × ₡${p.precioVenta} = ₡${valor}`);
    });

    // ✅ Productos con stock bajo - SOLO LOS QUE SE VENDEN
    const productosStockBajo = productosVenta.filter(p => p.cantidad < 5 && p.cantidad > 0);
    const productosAgotados = productosVenta.filter(p => p.cantidad === 0);

    console.log(`✓ Stock bajo (seVende=true): ${productosStockBajo.length}`);
    console.log(`✓ Agotados (seVende=true): ${productosAgotados.length}`);

    const respuesta = {
      ventasHoy: {
        total: totalVentasHoy,
        cantidad: ventasHoy.length
      },
      ventasSemana: {
        total: totalVentasSemana,
        cantidad: ventasSemana.length
      },
      ventasMes: {
        total: totalVentasMes,
        cantidad: ventasMes.length,
        ganancias: gananciasTotales
      },
      inventarioTotal: {
        valorTotal: valorInventarioTotal,
        totalProductos: todosProductos.length,
        totalUnidades: cantidadInventarioTotal
      },
      inventarioVenta: {
        valorTotal: valorInventarioVenta,
        totalProductos: productosVenta.length,
        totalUnidades: cantidadInventarioVenta,
        stockBajo: productosStockBajo.length,
        agotados: productosAgotados.length
      },
      pedidosPendientes
    };

    console.log("✅ Resumen generado exitosamente");
    res.json(respuesta);

  } catch (error) {
    console.error('❌ Error al obtener resumen:', error);
    res.status(500).json({ error: 'Error al obtener resumen' });
  }
};

// Obtener productos más vendidos
export const getProductosMasVendidos = async (req, res) => {
  try {
    console.log("\n🏆 ===== GENERANDO PRODUCTOS MÁS VENDIDOS =====");
    
    const limite = parseInt(req.query.limit) || 10;
    const dias = parseInt(req.query.days) || 30;

    const fechaInicio = new Date();
    fechaInicio.setDate(fechaInicio.getDate() - dias);

    // Obtener ventas Y productos con seVende: true
    const [ventas, productosVenta] = await Promise.all([
      Sale.find({ fecha: { $gte: fechaInicio } }),
      Inventario.find({ seVende: true }).select('_id nombre')
    ]);

    console.log(`✓ Ventas encontradas: ${ventas.length}`);
    console.log(`✓ Productos con seVende=true: ${productosVenta.length}`);

    // Crear Set con IDs de productos que se venden
    const idsProductosVenta = new Set(
      productosVenta.map(p => p._id.toString())
    );

    // ✅ AGRUPAR POR NOMBRE para evitar duplicados
    const productosVendidosPorNombre = {};

    ventas.forEach(venta => {
      venta.productos.forEach(item => {
        const id = item.productoId?.toString();
        
        // Solo productos que están en seVende: true
        if (!id || !idsProductosVenta.has(id)) {
          return;
        }

        const nombre = item.nombre.trim().toLowerCase();
        
        if (!productosVendidosPorNombre[nombre]) {
          productosVendidosPorNombre[nombre] = {
            nombre: item.nombre, // Usar el nombre original
            cantidadVendida: 0,
            totalVentas: 0
          };
        }
        
        productosVendidosPorNombre[nombre].cantidadVendida += item.cantidad;
        productosVendidosPorNombre[nombre].totalVentas += item.subtotal;
      });
    });

    console.log(`✓ Productos únicos vendidos (por nombre): ${Object.keys(productosVendidosPorNombre).length}`);

    // Convertir a array y ordenar
    const ranking = Object.values(productosVendidosPorNombre)
      .sort((a, b) => b.cantidadVendida - a.cantidadVendida)
      .slice(0, limite);

    console.log("📊 Top productos:");
    ranking.forEach((p, i) => {
      console.log(`   #${i + 1} ${p.nombre}: ${p.cantidadVendida} unidades - ₡${p.totalVentas}`);
    });

    res.json({
      periodo: `Últimos ${dias} días`,
      productos: ranking
    });

  } catch (error) {
    console.error('❌ Error al obtener productos más vendidos:', error);
    res.status(500).json({ error: 'Error al obtener productos más vendidos' });
  }
};

// Obtener productos menos vendidos
export const getProductosMenosVendidos = async (req, res) => {
  try {
    console.log("\n📉 ===== GENERANDO PRODUCTOS MENOS VENDIDOS =====");
    
    const limite = parseInt(req.query.limit) || 10;
    const dias = parseInt(req.query.days) || 30;
    const umbralMaximoVentas = parseInt(req.query.maxSales) || 2; // ✅ Solo productos con 0-2 ventas

    const fechaInicio = new Date();
    fechaInicio.setDate(fechaInicio.getDate() - dias);

    const [ventas, productosVenta] = await Promise.all([
      Sale.find({ fecha: { $gte: fechaInicio } }),
      Inventario.find({ seVende: true }).select('nombre cantidad')
    ]);

    console.log(`✓ Productos con seVende=true: ${productosVenta.length}`);

    // Agrupar ventas por producto
    const ventasPorProducto = {};
    ventas.forEach(venta => {
      venta.productos.forEach(item => {
        const id = item.productoId?.toString();
        if (id) {
          ventasPorProducto[id] = (ventasPorProducto[id] || 0) + item.cantidad;
        }
      });
    });

    // ✅ FILTRAR: solo productos con ventas <= umbralMaximoVentas
    const menosVendidos = productosVenta
      .map(producto => {
        const cantidadVendida = ventasPorProducto[producto._id.toString()] || 0;
        return {
          _id: producto._id,
          nombre: producto.nombre,
          cantidadVendida: cantidadVendida,
          stockActual: producto.cantidad
        };
      })
      .filter(p => p.cantidadVendida <= umbralMaximoVentas) // ✅ Solo los menos vendidos
      .sort((a, b) => {
        // Primero por cantidad vendida (menor a mayor)
        if (a.cantidadVendida !== b.cantidadVendida) {
          return a.cantidadVendida - b.cantidadVendida;
        }
        // Luego por stock (mayor a menor)
        return b.stockActual - a.stockActual;
      })
      .slice(0, limite);

    console.log(`✅ Menos vendidos generados: ${menosVendidos.length} (máximo ${umbralMaximoVentas} ventas)`);
    menosVendidos.forEach(p => {
      console.log(`   - ${p.nombre}: ${p.cantidadVendida} vendidas, stock: ${p.stockActual}`);
    });

    res.json({
      periodo: `Últimos ${dias} días`,
      productos: menosVendidos,
      umbralMaximoVentas: umbralMaximoVentas
    });

  } catch (error) {
    console.error('❌ Error al obtener productos menos vendidos:', error);
    res.status(500).json({ error: 'Error al obtener productos menos vendidos' });
  }
};

// Obtener productos con stock bajo
export const getProductosStockBajo = async (req, res) => {
  try {
    console.log("\n⚠️ ===== GENERANDO PRODUCTOS CON STOCK BAJO =====");
    
    const limite = parseInt(req.query.limit) || 20;
    const umbral = parseInt(req.query.threshold) || 5;

    // SOLO PRODUCTOS CON seVende: true
    const productosStockBajo = await Inventario.find({
      seVende: true,
      cantidad: { $lte: umbral, $gt: 0 }
    })
    .select('nombre cantidad precioVenta')
    .sort({ cantidad: 1 })
    .limit(limite);

    const productosAgotados = await Inventario.find({ 
      seVende: true,
      cantidad: 0 
    })
      .select('nombre cantidad precioVenta')
      .limit(limite);

    console.log(`✓ Stock bajo encontrados: ${productosStockBajo.length}`);
    console.log(`✓ Agotados encontrados: ${productosAgotados.length}`);

    if (productosStockBajo.length > 0) {
      console.log("📋 Stock bajo:");
      productosStockBajo.forEach(p => {
        console.log(`   - ${p.nombre}: ${p.cantidad} unidades`);
      });
    }

    if (productosAgotados.length > 0) {
      console.log("📋 Agotados:");
      productosAgotados.forEach(p => {
        console.log(`   - ${p.nombre}: ${p.cantidad} unidades`);
      });
    }

    res.json({
      stockBajo: productosStockBajo,
      agotados: productosAgotados,
      umbral
    });

  } catch (error) {
    console.error('❌ Error al obtener stock bajo:', error);
    res.status(500).json({ error: 'Error al obtener stock bajo' });
  }
};

// Obtener ventas por período (para gráficas)
export const getVentasPorPeriodo = async (req, res) => {
  try {
    const dias = parseInt(req.query.days) || 30;
    
    const fechaInicio = new Date();
    fechaInicio.setDate(fechaInicio.getDate() - dias);
    fechaInicio.setHours(0, 0, 0, 0);

    const ventas = await Sale.find({ fecha: { $gte: fechaInicio } })
      .sort({ fecha: 1 });

    // Agrupar por día
    const ventasPorDia = {};
    
    ventas.forEach(venta => {
      const fecha = new Date(venta.fecha);
      const key = fecha.toISOString().split('T')[0];
      
      if (!ventasPorDia[key]) {
        ventasPorDia[key] = {
          fecha: key,
          total: 0,
          cantidad: 0
        };
      }
      
      ventasPorDia[key].total += venta.total;
      ventasPorDia[key].cantidad += 1;
    });

    const datos = Object.values(ventasPorDia).sort((a, b) => 
      new Date(a.fecha) - new Date(b.fecha)
    );

    res.json({
      periodo: `Últimos ${dias} días`,
      datos
    });

  } catch (error) {
    console.error('❌ Error al obtener ventas por período:', error);
    res.status(500).json({ error: 'Error al obtener ventas por período' });
  }
};

// Obtener estadísticas de pedidos
export const getEstadisticasPedidos = async (req, res) => {
  try {
    const [pendientes, confirmados, completados, cancelados, total] = await Promise.all([
      Pedido.countDocuments({ estado: 'pendiente' }),
      Pedido.countDocuments({ estado: 'confirmado' }),
      Pedido.countDocuments({ estado: 'completado' }),
      Pedido.countDocuments({ estado: 'cancelado' }),
      Pedido.countDocuments()
    ]);

    // Pedidos recientes
    const pedidosRecientes = await Pedido.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('productoId', 'nombre imagen');

    res.json({
      estadisticas: {
        pendientes,
        confirmados,
        completados,
        cancelados,
        total
      },
      recientes: pedidosRecientes
    });

  } catch (error) {
    console.error('❌ Error al obtener estadísticas de pedidos:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
};