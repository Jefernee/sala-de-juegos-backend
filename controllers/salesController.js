// controllers/salesController.js
// ─────────────────────────────────────────────────────────────────
// Solo se muestra la función addSale modificada.
// El resto del archivo (getSales, getSaleById, getSalesStats,
// updateSale, deleteSale) queda idéntico — no tocar.
// ─────────────────────────────────────────────────────────────────
import Sale       from "../models/sale.js";
import Inventario from "../models/Inventario.js";
import { crearFiltroFechas, formatCostaRicaTime } from "../utils/dateUtils.js";

// Registrar nueva venta
export const addSale = async (req, res) => {
  console.log("\n🚀 ===== INICIO DE PROCESO DE VENTA =====");
  console.log("📦 Body recibido:", JSON.stringify(req.body, null, 2));

  try {
    const { productos, total, montoPagado, vuelto, fecha } = req.body;

    console.log("\n✅ PASO 1: Validaciones básicas iniciales");

    if (!productos || productos.length === 0) {
      return res.status(400).json({ error: "Debe incluir productos en la venta" });
    }
    if (!total || !montoPagado) {
      return res.status(400).json({ error: "Faltan datos de pago" });
    }
    if (total <= 0) {
      return res.status(400).json({ error: "El total debe ser mayor a 0" });
    }
    if (montoPagado < total) {
      return res.status(400).json({
        error: "El monto pagado es insuficiente",
        detalles: { total, montoPagado, faltante: total - montoPagado },
      });
    }

    const vueltoCalculado = montoPagado - total;
    if (Math.abs(vuelto - vueltoCalculado) > 0.01) {
      return res.status(400).json({
        error: "El vuelto calculado no coincide",
        vueltoRecibido: vuelto,
        vueltoEsperado: vueltoCalculado,
      });
    }

    console.log("\n✅ PASO 2: Validando productos en base de datos");

    const productosValidados = [];   // para actualizar stock después
    const productosConCosto  = [];   // productos enriquecidos con costo

    for (let i = 0; i < productos.length; i++) {
      const item = productos[i];
      console.log(`\n📦 Validando producto ${i + 1}/${productos.length}: ${item.nombre}`);

      if (!item.productoId || !item.nombre || !item.cantidad || item.cantidad <= 0) {
        return res.status(400).json({ error: "Datos de producto inválidos", producto: item });
      }
      if (!item.precioVenta || item.precioVenta <= 0) {
        return res.status(400).json({ error: "Precio de venta inválido", producto: item });
      }

      const subtotalCalculado = item.cantidad * item.precioVenta;
      if (Math.abs(item.subtotal - subtotalCalculado) > 0.01) {
        return res.status(400).json({
          error: "Subtotal incorrecto para el producto",
          producto: item.nombre,
          subtotalRecibido: item.subtotal,
          subtotalEsperado: subtotalCalculado,
        });
      }

      const productoDB = await Inventario.findById(item.productoId);

      if (!productoDB) {
        return res.status(404).json({
          error: `Producto "${item.nombre}" no encontrado en el inventario`,
        });
      }
      if (!productoDB.seVende) {
        return res.status(400).json({
          error: `El producto "${productoDB.nombre}" no está disponible para venta`,
        });
      }
      if (productoDB.cantidad < item.cantidad) {
        return res.status(400).json({
          error: `Stock insuficiente para "${productoDB.nombre}"`,
          producto: {
            nombre: productoDB.nombre,
            solicitado: item.cantidad,
            disponible: productoDB.cantidad,
          },
        });
      }
      if (Math.abs(productoDB.precioVenta - item.precioVenta) > 0.01) {
        return res.status(400).json({
          error: `El precio de "${productoDB.nombre}" ha cambiado`,
          producto: {
            nombre: productoDB.nombre,
            precioEnCarrito: item.precioVenta,
            precioActual: productoDB.precioVenta,
            mensaje: "Por favor actualiza el carrito",
          },
        });
      }

      // ── Capturar el costo en este momento ──────────────────────
      const costoUnitario = productoDB.precioCompra || 0;
      const costoSubtotal = costoUnitario * item.cantidad;

      productosConCosto.push({
        productoId:   item.productoId,
        nombre:       item.nombre,
        cantidad:     item.cantidad,
        precioVenta:  item.precioVenta,
        subtotal:     item.subtotal,
        costoUnitario,
        costoSubtotal,
      });

      productosValidados.push({
        id:              productoDB._id,
        cantidadVendida: item.cantidad,
        cantidadActual:  productoDB.cantidad,
      });

      console.log(`   ✅ costo capturado: ₡${costoUnitario} × ${item.cantidad} = ₡${costoSubtotal}`);
    }

    console.log("\n✅ PASO 3: Validando total general");
    const totalCalculado = productos.reduce((sum, item) => sum + item.subtotal, 0);
    if (Math.abs(total - totalCalculado) > 0.01) {
      return res.status(400).json({
        error: "El total no coincide con la suma de subtotales",
        totalRecibido: total,
        totalCalculado,
      });
    }

    // ── Calcular costo y ganancia totales de la venta ──────────────
    const totalCosto = productosConCosto.reduce((s, p) => s + p.costoSubtotal, 0);
    const ganancia   = total - totalCosto;

    console.log(`\n💰 Ganancia de la venta: ₡${ganancia} (venta ₡${total} - costo ₡${totalCosto})`);

    console.log("\n✅ PASO 4: Creando venta en base de datos");
    const ventaData = {
      productos: productosConCosto,   // ahora incluye costoUnitario y costoSubtotal
      total,
      montoPagado,
      vuelto,
      totalCosto,
      ganancia,
      fecha: fecha || new Date(),
      usuario:       req.user.id,
      nombreUsuario: req.user.nombre,
      emailUsuario:  req.user.email,
    };

    const newSale      = new Sale(ventaData);
    const ventaGuardada = await newSale.save();
    console.log("✅ Venta guardada. ID:", ventaGuardada._id);

    console.log("\n✅ PASO 5: Actualizando inventario");
    for (const prod of productosValidados) {
      await Inventario.findByIdAndUpdate(prod.id, {
        cantidad:  prod.cantidadActual - prod.cantidadVendida,
        updatedAt: new Date(),
      });
    }
    console.log("✅ Inventario actualizado");

    res.status(201).json({
      message: "Venta registrada exitosamente",
      venta: ventaGuardada,
    });

    console.log("🎉 ===== VENTA COMPLETADA EXITOSAMENTE =====\n");
  } catch (error) {
    console.error("\n❌ ERROR EN PROCESO DE VENTA:", error.message);

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ error: "Error de validación", detalles: messages.join(", ") });
    }
    if (error.name === "CastError") {
      return res.status(400).json({ error: "ID de producto inválido", detalles: error.message });
    }

    res.status(500).json({ error: "Error al registrar la venta", mensaje: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// El resto de funciones van aquí sin cambios:
// getSales, getSaleById, getSalesStats, updateSale, deleteSale
// ─────────────────────────────────────────────────────────────────

export const getSales = async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip  = (page - 1) * limit;
    const filtro = {};

    if (req.query.fechaInicio || req.query.fechaFin) {
      filtro.fecha = crearFiltroFechas(req.query.fechaInicio, req.query.fechaFin);
    }

    const ventas      = await Sale.find(filtro).populate('usuario', 'nombre email').sort({ fecha: -1 }).skip(skip).limit(limit);
    const totalVentas = await Sale.countDocuments(filtro);

    res.json({
      ventas,
      pagination: {
        totalVentas,
        totalPages:  Math.ceil(totalVentas / limit),
        currentPage: page,
        hasNextPage: page < Math.ceil(totalVentas / limit),
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener ventas', mensaje: error.message });
  }
};

export const getSaleById = async (req, res) => {
  try {
    const venta = await Sale.findById(req.params.id);
    if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
    res.json(venta);
  } catch (error) {
    if (error.name === "CastError") return res.status(400).json({ error: "ID de venta inválido" });
    res.status(500).json({ error: "Error al obtener la venta", mensaje: error.message });
  }
};

export const getSalesStats = async (req, res) => {
  try {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const ventasHoy = await Sale.find({ fecha: { $gte: hoy } });
    const totalVentasHoy    = ventasHoy.reduce((s, v) => s + v.total,    0);
    const totalGananciaHoy  = ventasHoy.reduce((s, v) => s + v.ganancia, 0);

    const inicioMes  = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const ventasMes  = await Sale.find({ fecha: { $gte: inicioMes } });
    const totalVentasMes   = ventasMes.reduce((s, v) => s + v.total,    0);
    const totalGananciaMes = ventasMes.reduce((s, v) => s + v.ganancia, 0);

    res.json({
      hoy: { total: totalVentasHoy,   ganancia: totalGananciaHoy,  cantidad: ventasHoy.length },
      mes: { total: totalVentasMes,   ganancia: totalGananciaMes,  cantidad: ventasMes.length },
    });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener estadísticas", mensaje: error.message });
  }
};

export const updateSale = async (req, res) => {
  try {
    const ventaExistente = await Sale.findById(req.params.id);
    if (!ventaExistente) return res.status(404).json({ error: "Venta no encontrada" });

    const ventaActualizada = await Sale.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    res.json({ message: "Venta actualizada exitosamente", venta: ventaActualizada });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ error: "Error de validación", detalles: Object.values(error.errors).map(e => e.message).join(", ") });
    }
    res.status(500).json({ error: "Error al actualizar la venta", mensaje: error.message });
  }
};

export const deleteSale = async (req, res) => {
  try {
    const ventaExistente = await Sale.findById(req.params.id);
    if (!ventaExistente) return res.status(404).json({ error: "Venta no encontrada" });

    await Sale.findByIdAndDelete(req.params.id);
    res.json({
      message: "Venta eliminada exitosamente",
      ventaEliminada: { id: ventaExistente._id, total: ventaExistente.total, fecha: ventaExistente.fecha },
    });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar la venta", mensaje: error.message });
  }
};