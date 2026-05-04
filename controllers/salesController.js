// controllers/salesController.js
import Sale       from "../models/sale.js";
import Inventario from "../models/Inventario.js";
import SaleReport from "../models/Salereport.js";
import { crearFiltroFechas } from "../utils/dateUtils.js";

// ─────────────────────────────────────────────────────────────────
// Auto-regeneración del reporte mensual de ventas
// ─────────────────────────────────────────────────────────────────

const NOMBRES_MES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function rangoCR(año, mes) {
  return {
    inicio: new Date(Date.UTC(año, mes - 1, 1, 6, 0, 0, 0)),
    fin:    new Date(Date.UTC(año, mes,     1, 6, 0, 0, 0)),
  };
}

function diaCR(fechaUTC) {
  return new Date(fechaUTC.getTime() - 6 * 60 * 60 * 1000).getUTCDate();
}

async function buildMonthReport(año, mes) {
  const { inicio, fin } = rangoCR(año, mes);
  const ventas = await Sale.find({ fecha: { $gte: inicio, $lt: fin } }).lean();
  if (!ventas.length) return null;

  let totalRecaudado = 0, totalMontoPagado = 0, totalVuelto = 0;
  let totalUnidadesVendidas = 0, totalCosto = 0;

  const empleadoMap = new Map();
  const productoMap = new Map();
  const diaMap      = new Map();

  for (const venta of ventas) {
    const rec      = venta.total     || 0;
    const costo    = venta.totalCosto || 0;
    const ganancia = venta.ganancia  || rec - costo;

    totalRecaudado   += rec;
    totalMontoPagado += venta.montoPagado || 0;
    totalVuelto      += venta.vuelto      || 0;
    totalCosto       += costo;

    const empKey = venta.nombreUsuario || 'Desconocido';
    if (!empleadoMap.has(empKey)) {
      empleadoMap.set(empKey, { usuarioId: venta.usuario || null, nombre: empKey, email: venta.emailUsuario || '', totalVentas: 0, totalRecaudado: 0, totalCosto: 0, ganancia: 0 });
    }
    const emp = empleadoMap.get(empKey);
    emp.totalVentas++; emp.totalRecaudado += rec; emp.totalCosto += costo; emp.ganancia += ganancia;

    const dia = diaCR(new Date(venta.fecha));
    if (!diaMap.has(dia)) diaMap.set(dia, { dia, totalVentas: 0, totalRecaudado: 0, ganancia: 0 });
    const diaEntry = diaMap.get(dia);
    diaEntry.totalVentas++; diaEntry.totalRecaudado += rec; diaEntry.ganancia += ganancia;

    for (const item of venta.productos || []) {
      const pid          = item.productoId?.toString() || item.nombre;
      const uds          = item.cantidad      || 0;
      const sub          = item.subtotal      || 0;
      const costoItem    = item.costoSubtotal || 0;
      const gananciaItem = sub - costoItem;
      totalUnidadesVendidas += uds;

      if (!productoMap.has(pid)) productoMap.set(pid, { productoId: item.productoId || null, nombre: item.nombre || 'Sin nombre', totalVendido: 0, totalRecaudado: 0, totalCosto: 0, ganancia: 0, vecesEnVentas: 0 });
      const prod = productoMap.get(pid);
      prod.totalVendido += uds; prod.totalRecaudado += sub; prod.totalCosto += costoItem; prod.ganancia += gananciaItem; prod.vecesEnVentas++;
    }
  }

  const totalVentas    = ventas.length;
  const gananciaTotal  = totalRecaudado - totalCosto;
  const margenPromedio = totalRecaudado > 0 ? Math.round((gananciaTotal / totalRecaudado) * 100 * 10) / 10 : 0;
  const ticketPromedio = totalVentas > 0 ? totalRecaudado / totalVentas : 0;

  return {
    año, mes, nombreMes: NOMBRES_MES[mes],
    totalVentas, totalRecaudado, totalMontoPagado, totalVuelto,
    ticketPromedio, totalUnidadesVendidas, totalCosto, gananciaTotal, margenPromedio,
    porEmpleado: [...empleadoMap.values()].map((e) => ({ ...e, ticketPromedio: e.totalVentas > 0 ? e.totalRecaudado / e.totalVentas : 0 })).sort((a, b) => b.totalRecaudado - a.totalRecaudado),
    productosMasVendidos: [...productoMap.values()].sort((a, b) => b.totalVendido - a.totalVendido),
    porDia: [...diaMap.values()].sort((a, b) => a.dia - b.dia),
    ultimaActualizacion: new Date(),
    periodoInicio: inicio, periodoFin: fin, ventasIncluidas: totalVentas,
  };
}

/**
 * Regenera el reporte del mes al que pertenece la fecha dada.
 * Se llama en background tras crear/editar/eliminar una venta.
 */
const regenerarReporteDeVenta = async (fechaVenta) => {
  try {
    const fecha = new Date(fechaVenta);
    const crDate = new Date(fecha.getTime() - 6 * 60 * 60 * 1000);
    const año = crDate.getUTCFullYear();
    const mes = crDate.getUTCMonth() + 1;

    const datos = await buildMonthReport(año, mes);
    if (!datos) {
      // No hay ventas en el mes → eliminar reporte si existía
      await SaleReport.deleteOne({ año, mes });
      console.log(`🗑️ Reporte ${NOMBRES_MES[mes]} ${año} eliminado (sin ventas)`);
      return;
    }

    await SaleReport.findOneAndUpdate(
      { año, mes },
      datos,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`✅ Reporte ventas ${NOMBRES_MES[mes]} ${año} actualizado automáticamente (${datos.totalVentas} ventas)`);
  } catch (err) {
    console.error('⚠️ Error al regenerar reporte de ventas automáticamente:', err.message);
  }
};

// ─────────────────────────────────────────────────────────────────
// POST /api/sales  — Registrar nueva venta
// ─────────────────────────────────────────────────────────────────
export const addSale = async (req, res) => {
  console.log("\n🚀 ===== INICIO DE PROCESO DE VENTA =====");

  try {
    const { productos, total, montoPagado, vuelto, fecha } = req.body;

    if (!productos || productos.length === 0) return res.status(400).json({ error: "Debe incluir productos en la venta" });
    if (!total || !montoPagado)              return res.status(400).json({ error: "Faltan datos de pago" });
    if (total <= 0)                          return res.status(400).json({ error: "El total debe ser mayor a 0" });
    if (montoPagado < total)                 return res.status(400).json({ error: "El monto pagado es insuficiente", detalles: { total, montoPagado, faltante: total - montoPagado } });

    const vueltoCalculado = montoPagado - total;
    if (Math.abs(vuelto - vueltoCalculado) > 0.01) return res.status(400).json({ error: "El vuelto calculado no coincide", vueltoRecibido: vuelto, vueltoEsperado: vueltoCalculado });

    const productosValidados = [];
    const productosConCosto  = [];

    for (let i = 0; i < productos.length; i++) {
      const item = productos[i];
      if (!item.productoId || !item.nombre || !item.cantidad || item.cantidad <= 0) return res.status(400).json({ error: "Datos de producto inválidos", producto: item });
      if (!item.precioVenta || item.precioVenta <= 0) return res.status(400).json({ error: "Precio de venta inválido", producto: item });

      const subtotalCalculado = item.cantidad * item.precioVenta;
      if (Math.abs(item.subtotal - subtotalCalculado) > 0.01) return res.status(400).json({ error: "Subtotal incorrecto", producto: item.nombre, subtotalRecibido: item.subtotal, subtotalEsperado: subtotalCalculado });

      const productoDB = await Inventario.findById(item.productoId);
      if (!productoDB)          return res.status(404).json({ error: `Producto "${item.nombre}" no encontrado` });
      if (!productoDB.seVende)  return res.status(400).json({ error: `"${productoDB.nombre}" no está disponible para venta` });
      if (productoDB.cantidad < item.cantidad) return res.status(400).json({ error: `Stock insuficiente para "${productoDB.nombre}"`, producto: { nombre: productoDB.nombre, solicitado: item.cantidad, disponible: productoDB.cantidad } });
      if (Math.abs(productoDB.precioVenta - item.precioVenta) > 0.01) return res.status(400).json({ error: `El precio de "${productoDB.nombre}" ha cambiado`, producto: { nombre: productoDB.nombre, precioEnCarrito: item.precioVenta, precioActual: productoDB.precioVenta } });

      const costoUnitario = productoDB.precioCompra || 0;
      const costoSubtotal = costoUnitario * item.cantidad;

      productosConCosto.push({ productoId: item.productoId, nombre: item.nombre, cantidad: item.cantidad, precioVenta: item.precioVenta, subtotal: item.subtotal, costoUnitario, costoSubtotal });
      productosValidados.push({ id: productoDB._id, cantidadVendida: item.cantidad, cantidadActual: productoDB.cantidad });
    }

    const totalCalculado = productos.reduce((sum, item) => sum + item.subtotal, 0);
    if (Math.abs(total - totalCalculado) > 0.01) return res.status(400).json({ error: "El total no coincide con la suma de subtotales", totalRecibido: total, totalCalculado });

    const totalCosto = productosConCosto.reduce((s, p) => s + p.costoSubtotal, 0);
    const ganancia   = total - totalCosto;

    const fechaVenta = fecha || new Date();

    const newSale       = new Sale({ productos: productosConCosto, total, montoPagado, vuelto, totalCosto, ganancia, fecha: fechaVenta, usuario: req.user.id, nombreUsuario: req.user.nombre, emailUsuario: req.user.email });
    const ventaGuardada = await newSale.save();

    for (const prod of productosValidados) {
      await Inventario.findByIdAndUpdate(prod.id, { cantidad: prod.cantidadActual - prod.cantidadVendida, updatedAt: new Date() });
    }

    res.status(201).json({ message: "Venta registrada exitosamente", venta: ventaGuardada });

    // ✅ Regenerar reporte en background
    regenerarReporteDeVenta(fechaVenta);

  } catch (error) {
    console.error("❌ ERROR EN PROCESO DE VENTA:", error.message);
    if (error.name === "ValidationError") return res.status(400).json({ error: "Error de validación", detalles: Object.values(error.errors).map((e) => e.message).join(", ") });
    if (error.name === "CastError")       return res.status(400).json({ error: "ID de producto inválido", detalles: error.message });
    res.status(500).json({ error: "Error al registrar la venta", mensaje: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/sales
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
    res.json({ ventas, pagination: { totalVentas, totalPages: Math.ceil(totalVentas / limit), currentPage: page, hasNextPage: page < Math.ceil(totalVentas / limit), hasPrevPage: page > 1 } });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener ventas', mensaje: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/sales/:id
// ─────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────
// GET /api/sales/stats
// ─────────────────────────────────────────────────────────────────
export const getSalesStats = async (req, res) => {
  try {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const ventasHoy     = await Sale.find({ fecha: { $gte: hoy } });
    const inicioMes     = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const ventasMes     = await Sale.find({ fecha: { $gte: inicioMes } });
    res.json({
      hoy: { total: ventasHoy.reduce((s,v)=>s+v.total,0),    ganancia: ventasHoy.reduce((s,v)=>s+v.ganancia,0),  cantidad: ventasHoy.length },
      mes: { total: ventasMes.reduce((s,v)=>s+v.total,0),    ganancia: ventasMes.reduce((s,v)=>s+v.ganancia,0),  cantidad: ventasMes.length },
    });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener estadísticas", mensaje: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// PUT /api/sales/:id  — regenera reporte en background
// ─────────────────────────────────────────────────────────────────
export const updateSale = async (req, res) => {
  try {
    const ventaExistente = await Sale.findById(req.params.id);
    if (!ventaExistente) return res.status(404).json({ error: "Venta no encontrada" });

    const ventaActualizada = await Sale.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    res.json({ message: "Venta actualizada exitosamente", venta: ventaActualizada });

    // ✅ Regenerar reporte en background
    regenerarReporteDeVenta(ventaExistente.fecha);
  } catch (error) {
    if (error.name === "ValidationError") return res.status(400).json({ error: "Error de validación", detalles: Object.values(error.errors).map(e=>e.message).join(", ") });
    res.status(500).json({ error: "Error al actualizar la venta", mensaje: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// DELETE /api/sales/:id  — regenera reporte en background
// ─────────────────────────────────────────────────────────────────
export const deleteSale = async (req, res) => {
  try {
    const ventaExistente = await Sale.findById(req.params.id);
    if (!ventaExistente) return res.status(404).json({ error: "Venta no encontrada" });

    const fechaVenta = ventaExistente.fecha;
    await Sale.findByIdAndDelete(req.params.id);
    res.json({ message: "Venta eliminada exitosamente", ventaEliminada: { id: ventaExistente._id, total: ventaExistente.total, fecha: ventaExistente.fecha } });

    // ✅ Regenerar reporte en background
    regenerarReporteDeVenta(fechaVenta);
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar la venta", mensaje: error.message });
  }
};