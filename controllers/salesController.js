// controllers/salesController.js
import Sale from '../models/sale.js';
import Inventario from '../models/Inventario.js';

// Registrar nueva venta
export const addSale = async (req, res) => {
  console.log("\n🚀 ===== INICIO DE PROCESO DE VENTA =====");
  console.log("📦 Body recibido:", JSON.stringify(req.body, null, 2));
  
  try {
    const { productos, total, montoPagado, vuelto, fecha } = req.body;

    console.log("\n✅ PASO 1: Validaciones básicas iniciales");
    
    // Validaciones básicas
    if (!productos || productos.length === 0) {
      console.log("❌ ERROR: No hay productos");
      return res.status(400).json({ error: 'Debe incluir productos en la venta' });
    }
    console.log(`✓ Productos recibidos: ${productos.length}`);

    if (!total || !montoPagado) {
      console.log("❌ ERROR: Faltan datos de pago");
      return res.status(400).json({ error: 'Faltan datos de pago' });
    }
    console.log(`✓ Total: ₡${total}, Monto pagado: ₡${montoPagado}`);

    if (total <= 0) {
      console.log("❌ ERROR: Total inválido");
      return res.status(400).json({ error: 'El total debe ser mayor a 0' });
    }

    if (montoPagado < total) {
      console.log("❌ ERROR: Pago insuficiente");
      return res.status(400).json({ 
        error: 'El monto pagado es insuficiente',
        detalles: {
          total,
          montoPagado,
          faltante: total - montoPagado
        }
      });
    }

    const vueltoCalculado = montoPagado - total;
    if (Math.abs(vuelto - vueltoCalculado) > 0.01) {
      console.log("❌ ERROR: Vuelto no coincide");
      return res.status(400).json({ 
        error: 'El vuelto calculado no coincide',
        vueltoRecibido: vuelto,
        vueltoEsperado: vueltoCalculado
      });
    }
    console.log(`✓ Vuelto correcto: ₡${vuelto}`);

    console.log("\n✅ PASO 2: Validando productos en base de datos");
    
    // Array para almacenar productos validados
    const productosValidados = [];
    
    // Validar cada producto
    for (let i = 0; i < productos.length; i++) {
      const item = productos[i];
      console.log(`\n📦 Validando producto ${i + 1}/${productos.length}: ${item.nombre}`);
      console.log(`   ID: ${item.productoId}`);
      console.log(`   Cantidad solicitada: ${item.cantidad}`);
      console.log(`   Precio: ₡${item.precioVenta}`);
      
      // Validaciones básicas del item
      if (!item.productoId || !item.nombre || !item.cantidad || item.cantidad <= 0) {
        console.log(`❌ ERROR: Datos inválidos del producto`);
        return res.status(400).json({ 
          error: 'Datos de producto inválidos',
          producto: item
        });
      }
      
      if (!item.precioVenta || item.precioVenta <= 0) {
        console.log(`❌ ERROR: Precio inválido`);
        return res.status(400).json({ 
          error: 'Precio de venta inválido',
          producto: item
        });
      }

      const subtotalCalculado = item.cantidad * item.precioVenta;
      if (Math.abs(item.subtotal - subtotalCalculado) > 0.01) {
        console.log(`❌ ERROR: Subtotal incorrecto`);
        return res.status(400).json({ 
          error: 'Subtotal incorrecto para el producto',
          producto: item.nombre,
          subtotalRecibido: item.subtotal,
          subtotalEsperado: subtotalCalculado
        });
      }

      // Buscar producto en base de datos
      console.log(`   🔍 Buscando en base de datos...`);
      const productoDB = await Inventario.findById(item.productoId);

      if (!productoDB) {
        console.log(`❌ ERROR: Producto no encontrado en BD`);
        return res.status(404).json({
          error: `Producto "${item.nombre}" no encontrado en el inventario`,
          producto: { nombre: item.nombre, id: item.productoId }
        });
      }
      console.log(`   ✓ Producto encontrado en BD`);
      console.log(`   Stock en BD: ${productoDB.cantidad}`);
      console.log(`   seVende: ${productoDB.seVende}`);

      // Verificar que esté disponible para venta
      if (!productoDB.seVende) {
        console.log(`❌ ERROR: Producto no disponible para venta`);
        return res.status(400).json({
          error: `El producto "${productoDB.nombre}" no está disponible para venta`,
          producto: { 
            nombre: productoDB.nombre, 
            seVende: false,
            mensaje: 'Este producto ha sido marcado como no disponible'
          }
        });
      }

      // Verificar stock suficiente
      if (productoDB.cantidad < item.cantidad) {
        console.log(`❌ ERROR: Stock insuficiente`);
        return res.status(400).json({
          error: `Stock insuficiente para "${productoDB.nombre}"`,
          producto: {
            nombre: productoDB.nombre,
            solicitado: item.cantidad,
            disponible: productoDB.cantidad,
            mensaje: `Solo hay ${productoDB.cantidad} unidad${productoDB.cantidad !== 1 ? 'es' : ''} disponible${productoDB.cantidad !== 1 ? 's' : ''}`
          }
        });
      }
      console.log(`   ✓ Stock suficiente`);

      // Verificar que el precio coincida
      if (Math.abs(productoDB.precioVenta - item.precioVenta) > 0.01) {
        console.log(`❌ ERROR: Precio ha cambiado`);
        return res.status(400).json({
          error: `El precio de "${productoDB.nombre}" ha cambiado`,
          producto: {
            nombre: productoDB.nombre,
            precioEnCarrito: item.precioVenta,
            precioActual: productoDB.precioVenta,
            mensaje: 'Por favor actualiza el carrito'
          }
        });
      }
      console.log(`   ✓ Precio correcto`);
      console.log(`   ✅ Producto validado exitosamente`);
      
      // Guardar producto validado para actualizar después
      productosValidados.push({
        id: productoDB._id,
        cantidadVendida: item.cantidad,
        cantidadActual: productoDB.cantidad
      });
    }

    console.log("\n✅ PASO 3: Validando total general");
    // Validar total
    const totalCalculado = productos.reduce((sum, item) => sum + item.subtotal, 0);
    console.log(`Total calculado: ₡${totalCalculado}`);
    console.log(`Total recibido: ₡${total}`);
    
    if (Math.abs(total - totalCalculado) > 0.01) {
      console.log("❌ ERROR: Total no coincide");
      return res.status(400).json({ 
        error: 'El total no coincide con la suma de subtotales',
        totalRecibido: total,
        totalCalculado: totalCalculado
      });
    }
    console.log("✓ Total correcto");

    console.log("\n✅ PASO 4: Creando venta en base de datos");
    // Crear nueva venta
    const ventaData = {
      productos,
      total,
      montoPagado,
      vuelto,
      fecha: fecha || new Date()
    };
    console.log("Datos a guardar:", JSON.stringify(ventaData, null, 2));

    const newSale = new Sale(ventaData);
    console.log("📝 Objeto Sale creado, guardando...");
    
    const ventaGuardada = await newSale.save();
    console.log("✅ Venta guardada exitosamente!");
    console.log("ID de venta:", ventaGuardada._id);

    // ✅ NUEVO: PASO 5 - Actualizar inventario
    console.log("\n✅ PASO 5: Actualizando inventario");
    for (const prod of productosValidados) {
      const nuevaCantidad = prod.cantidadActual - prod.cantidadVendida;
      console.log(`   📦 Actualizando producto ${prod.id}`);
      console.log(`      Cantidad anterior: ${prod.cantidadActual}`);
      console.log(`      Cantidad vendida: ${prod.cantidadVendida}`);
      console.log(`      Nueva cantidad: ${nuevaCantidad}`);
      
      await Inventario.findByIdAndUpdate(
        prod.id,
        { 
          cantidad: nuevaCantidad,
          updatedAt: new Date()
        }
      );
      
      console.log(`   ✅ Inventario actualizado`);
    }
    console.log("✅ Todo el inventario actualizado correctamente");

    console.log("\n✅ PASO 6: Enviando respuesta al frontend");
    const respuesta = {
      message: 'Venta registrada exitosamente',
      venta: ventaGuardada
    };
    console.log("Respuesta:", JSON.stringify(respuesta, null, 2));

    res.status(201).json(respuesta);
    
    console.log("🎉 ===== VENTA COMPLETADA EXITOSAMENTE =====\n");

  } catch (error) {
    console.error("\n❌ ===== ERROR EN PROCESO DE VENTA =====");
    console.error("Tipo de error:", error.name);
    console.error("Mensaje:", error.message);
    console.error("Stack:", error.stack);
    
    // Manejar diferentes tipos de errores
    if (error.name === 'ValidationError') {
      console.error("❌ Error de validación de Mongoose");
      const messages = Object.values(error.errors).map(err => err.message);
      console.error("Detalles:", messages);
      return res.status(400).json({ 
        error: 'Error de validación',
        detalles: messages.join(', '),
        mensaje: error.message
      });
    }
    
    if (error.name === 'CastError') {
      console.error("❌ Error de ID inválido");
      return res.status(400).json({ 
        error: 'ID de producto inválido',
        detalles: error.message,
        mensaje: `El ID "${error.value}" no es válido`
      });
    }

    // Error genérico
    console.error("❌ Error genérico del servidor");
    res.status(500).json({ 
      error: 'Error al registrar la venta',
      mensaje: error.message || 'Error interno del servidor',
      tipo: error.name
    });
    
    console.error("===== FIN DE ERROR =====\n");
  }
};

// Obtener todas las ventas (con paginación)
export const getSales = async (req, res) => {
  console.log("\n📋 Obteniendo lista de ventas");
  
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    console.log(`Página: ${page}, Límite: ${limit}`);

    const ventas = await Sale.find()
      .sort({ fecha: -1 })
      .skip(skip)
      .limit(limit);

    const totalVentas = await Sale.countDocuments();

    console.log(`✅ ${ventas.length} ventas obtenidas (Total: ${totalVentas})`);

    res.json({
      ventas,
      pagination: {
        totalVentas,
        totalPages: Math.ceil(totalVentas / limit),
        currentPage: page,
        hasNextPage: page < Math.ceil(totalVentas / limit),
        hasPrevPage: page > 1
      }
    });

  } catch (error) {
    console.error("❌ Error al obtener ventas:", error);
    res.status(500).json({ 
      error: 'Error al obtener ventas',
      mensaje: error.message 
    });
  }
};

// Obtener venta por ID
export const getSaleById = async (req, res) => {
  console.log(`\n🔍 Buscando venta ID: ${req.params.id}`);
  
  try {
    const venta = await Sale.findById(req.params.id);
    
    if (!venta) {
      console.log("❌ Venta no encontrada");
      return res.status(404).json({ error: 'Venta no encontrada' });
    }

    console.log("✅ Venta encontrada");
    res.json(venta);

  } catch (error) {
    console.error("❌ Error al obtener venta:", error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({ 
        error: 'ID de venta inválido',
        mensaje: error.message 
      });
    }
    
    res.status(500).json({ 
      error: 'Error al obtener la venta',
      mensaje: error.message 
    });
  }
};

// Obtener estadísticas de ventas
export const getSalesStats = async (req, res) => {
  console.log("\n📊 Calculando estadísticas de ventas");
  
  try {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const ventasHoy = await Sale.find({ fecha: { $gte: hoy } });
    
    const totalVentasHoy = ventasHoy.reduce((sum, venta) => sum + venta.total, 0);
    const cantidadVentasHoy = ventasHoy.length;

    // Estadísticas del mes
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const ventasMes = await Sale.find({ fecha: { $gte: inicioMes } });
    const totalVentasMes = ventasMes.reduce((sum, venta) => sum + venta.total, 0);

    console.log(`Ventas hoy: ${cantidadVentasHoy} (₡${totalVentasHoy})`);
    console.log(`Ventas mes: ${ventasMes.length} (₡${totalVentasMes})`);

    res.json({
      hoy: {
        total: totalVentasHoy,
        cantidad: cantidadVentasHoy
      },
      mes: {
        total: totalVentasMes,
        cantidad: ventasMes.length
      }
    });

  } catch (error) {
    console.error("❌ Error al obtener estadísticas:", error);
    res.status(500).json({ 
      error: 'Error al obtener estadísticas',
      mensaje: error.message 
    });
  }
};
