// controllers/salesController.js
import Sale       from "../models/sale.js";
import Inventario from "../models/Inventario.js";
import SaleReport from "../models/Salereport.js";
import { crearFiltroFechas } from "../utils/dateUtils.js";
import { regenerarEstadoDeFecha } from "./estadoResultadosController.js";

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

    const productosConCosto = [];

    // ─────────────────────────────────────────────────────────────────
    // Mapa unificado de descuentos de inventario.
    // Consolida los descuentos de productos simples Y de ingredientes de
    // recetas en un solo lugar, para aplicarlos atómicamente al final.
    // Esto evita problemas si el mismo ingrediente aparece en varias
    // recetas vendidas en la misma transacción (ej. helado en cono y gelatina).
    // Clave: id del ítem en Inventario | Valor: { nombre, cantidad } a descontar.
    // El nombre se guarda junto con la venta (descuentosInventario) para poder
    // devolver EXACTAMENTE esto si algún día se borra, sin depender de que la
    // receta siga igual.
    // ─────────────────────────────────────────────────────────────────
    const decrementMap = new Map();

    // Suma al mapa sin pisar lo ya acumulado para ese mismo ítem.
    const acumularDescuento = (id, nombre, cantidad) => {
      const previo = decrementMap.get(id);
      decrementMap.set(id, { nombre, cantidad: (previo?.cantidad || 0) + cantidad });
    };

    for (let i = 0; i < productos.length; i++) {
      const item = productos[i];
      if (!item.productoId || !item.nombre || !item.cantidad || item.cantidad <= 0) return res.status(400).json({ error: "Datos de producto inválidos", producto: item });
      if (!item.precioVenta || item.precioVenta <= 0) return res.status(400).json({ error: "Precio de venta inválido", producto: item });

      const subtotalCalculado = item.cantidad * item.precioVenta;
      if (Math.abs(item.subtotal - subtotalCalculado) > 0.01) return res.status(400).json({ error: "Subtotal incorrecto", producto: item.nombre, subtotalRecibido: item.subtotal, subtotalEsperado: subtotalCalculado });

      // Para recetas necesitamos los ingredientes poblados
      const productoDB = await Inventario.findById(item.productoId)
        .populate('receta.ingredienteId', 'nombre cantidad precioCompra tipo');

      if (!productoDB)         return res.status(404).json({ error: `Producto "${item.nombre}" no encontrado` });
      if (!productoDB.seVende) return res.status(400).json({ error: `"${productoDB.nombre}" no está disponible para venta` });
      if (Math.abs(productoDB.precioVenta - item.precioVenta) > 0.01) return res.status(400).json({ error: `El precio de "${productoDB.nombre}" ha cambiado`, producto: { nombre: productoDB.nombre, precioEnCarrito: item.precioVenta, precioActual: productoDB.precioVenta } });

      let costoUnitario;
      let costoSubtotal;

      if (productoDB.tipo === 'receta') {
        // ─────────────────────────────────────────────────────────────
        // Lógica de venta para RECETAS.
        // En lugar de descontar el stock de la receta misma (que no existe),
        // se descuenta cada ingrediente individualmente.
        // El costo se calcula en tiempo real sumando precioCompra de ingredientes.
        // ─────────────────────────────────────────────────────────────
        if (!productoDB.receta || productoDB.receta.length === 0) {
          return res.status(400).json({ error: `La receta "${productoDB.nombre}" no tiene ingredientes configurados. Configúrela antes de vender.` });
        }

        costoUnitario = 0;

        for (const comp of productoDB.receta) {
          const ing = comp.ingredienteId;
          if (!ing) {
            return res.status(400).json({ error: `Un ingrediente de la receta "${productoDB.nombre}" ya no existe en inventario. Actualice la receta.` });
          }

          const cantidadNecesaria = comp.cantidad * item.cantidad;
          const claveIng = ing._id.toString();

          // Considerar lo ya planificado para descontar en esta misma venta
          const yaDescontado = decrementMap.get(claveIng)?.cantidad || 0;
          const stockReal = ing.cantidad - yaDescontado;

          if (stockReal < cantidadNecesaria) {
            return res.status(400).json({
              error: `Stock insuficiente de "${ing.nombre}" para preparar "${productoDB.nombre}"`,
              producto: {
                receta: productoDB.nombre,
                ingrediente: ing.nombre,
                necesario: cantidadNecesaria,
                disponible: stockReal,
              },
            });
          }

          acumularDescuento(claveIng, ing.nombre, cantidadNecesaria);
          costoUnitario += (ing.precioCompra || 0) * comp.cantidad;
        }

        costoSubtotal = costoUnitario * item.cantidad;

      } else {
        // ─────────────────────────────────────────────────────────────
        // Lógica original para PRODUCTOS SIMPLES
        // ─────────────────────────────────────────────────────────────
        const claveProducto = productoDB._id.toString();
        const yaDescontado = decrementMap.get(claveProducto)?.cantidad || 0;
        const stockReal = productoDB.cantidad - yaDescontado;

        if (stockReal < item.cantidad) {
          return res.status(400).json({ error: `Stock insuficiente para "${productoDB.nombre}"`, producto: { nombre: productoDB.nombre, solicitado: item.cantidad, disponible: stockReal } });
        }

        acumularDescuento(claveProducto, productoDB.nombre, item.cantidad);
        costoUnitario = productoDB.precioCompra || 0;
        costoSubtotal = costoUnitario * item.cantidad;
      }

      productosConCosto.push({ productoId: item.productoId, nombre: item.nombre, cantidad: item.cantidad, precioVenta: item.precioVenta, subtotal: item.subtotal, costoUnitario, costoSubtotal });
    }

    const totalCalculado = productos.reduce((sum, item) => sum + item.subtotal, 0);
    if (Math.abs(total - totalCalculado) > 0.01) return res.status(400).json({ error: "El total no coincide con la suma de subtotales", totalRecibido: total, totalCalculado });

    const totalCosto = productosConCosto.reduce((s, p) => s + p.costoSubtotal, 0);
    const ganancia   = total - totalCosto;

    const fechaVenta = fecha || new Date();

    // Se guarda el movimiento de inventario JUNTO con la venta: es lo que
    // permite devolver exactamente esto si después se borra.
    const descuentosInventario = [...decrementMap].map(([itemId, { nombre, cantidad }]) => ({ itemId, nombre, cantidad }));

    const newSale       = new Sale({ productos: productosConCosto, total, montoPagado, vuelto, totalCosto, ganancia, fecha: fechaVenta, usuario: req.user.id, nombreUsuario: req.user.nombre, emailUsuario: req.user.email, descuentosInventario });
    const ventaGuardada = await newSale.save();

    // Descontar inventario con $inc atómico para todos los ítems
    // (tanto productos simples como ingredientes de recetas, ya consolidados en decrementMap).
    for (const [id, { cantidad }] of decrementMap) {
      await Inventario.findByIdAndUpdate(id, { $inc: { cantidad: -cantidad }, updatedAt: new Date() });
    }

    res.status(201).json({ message: "Venta registrada exitosamente", venta: ventaGuardada });

    // ✅ Regenerar reportes en background (ventas + estado de resultados)
    regenerarReporteDeVenta(fechaVenta);
    regenerarEstadoDeFecha(fechaVenta);

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

    // ✅ Regenerar reportes en background. Si cambió la fecha de mes, se
    // regeneran el mes viejo y el nuevo (ambas fechas).
    regenerarReporteDeVenta(ventaExistente.fecha);
    if (ventaActualizada?.fecha) regenerarReporteDeVenta(ventaActualizada.fecha);
    regenerarEstadoDeFecha(ventaExistente.fecha, ventaActualizada?.fecha);
  } catch (error) {
    if (error.name === "ValidationError") return res.status(400).json({ error: "Error de validación", detalles: Object.values(error.errors).map(e=>e.message).join(", ") });
    res.status(500).json({ error: "Error al actualizar la venta", mensaje: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// Devolución de inventario al borrar una venta
//
// Borrar una venta significa que NUNCA existió: desaparece de ventas, de los
// reportes y el inventario vuelve a como estaba. Antes solo se borraba el
// documento y se regeneraban los reportes; el stock quedaba descontado para
// siempre, tanto de productos simples como de ingredientes de recetas.
// ─────────────────────────────────────────────────────────────────

const acumularEnPlan = (mapa, itemId, nombre, cantidad) => {
  const clave = String(itemId);
  const previo = mapa.get(clave);
  mapa.set(clave, { itemId, nombre: nombre || previo?.nombre || '', cantidad: (previo?.cantidad || 0) + cantidad });
};

/**
 * Reconstruye el movimiento de inventario de una venta VIEJA, que no guardó
 * descuentosInventario. Es lo mejor que se puede hacer con lo que hay, pero es
 * una ESTIMACIÓN: si la receta cambió desde que se hizo la venta, devuelve las
 * cantidades de la receta de hoy, no las que realmente se descontaron.
 * @param {Object} venta
 * @returns {Promise<{plan: Object[], noEncontrados: string[]}>}
 */
const estimarPlanDesdeProductos = async (venta) => {
  const mapa = new Map();
  const noEncontrados = [];

  for (const item of (venta.productos || [])) {
    const productoDB = await Inventario.findById(item.productoId).populate('receta.ingredienteId', 'nombre');

    if (!productoDB) {
      noEncontrados.push(item.nombre || 'producto desconocido');
      continue;
    }

    if (productoDB.tipo === 'receta') {
      for (const comp of (productoDB.receta || [])) {
        const ing = comp.ingredienteId;
        if (!ing) {
          noEncontrados.push(`un ingrediente de "${productoDB.nombre}"`);
          continue;
        }
        acumularEnPlan(mapa, ing._id, ing.nombre, comp.cantidad * item.cantidad);
      }
    } else {
      acumularEnPlan(mapa, productoDB._id, productoDB.nombre, item.cantidad);
    }
  }

  return { plan: [...mapa.values()], noEncontrados };
};

/**
 * Devuelve al inventario lo que descontó una venta. Nunca lanza: informa lo que
 * pudo y lo que no, para que borrar la venta no se caiga por un ítem raro.
 * @param {Object} venta - Documento de Sale
 * @returns {Promise<{devueltos: Object[], noEncontrados: string[], estimado: boolean}>}
 */
export const restaurarInventarioDeVenta = async (venta) => {
  const guardados = venta.descuentosInventario || [];
  const estimado = guardados.length === 0;

  let plan = [];
  let noEncontrados = [];

  if (!estimado) {
    // Camino normal: se devuelve exactamente lo que se descontó.
    plan = guardados.map((d) => ({ itemId: d.itemId, nombre: d.nombre, cantidad: d.cantidad }));
  } else {
    // Venta vieja (o sin productos que muevan inventario): hay que estimarlo.
    const estimacion = await estimarPlanDesdeProductos(venta);
    plan = estimacion.plan;
    noEncontrados = estimacion.noEncontrados;
  }

  const devueltos = [];
  for (const linea of plan) {
    if (!linea.cantidad || linea.cantidad <= 0) continue;
    try {
      const actualizado = await Inventario.findByIdAndUpdate(
        linea.itemId,
        { $inc: { cantidad: linea.cantidad }, updatedAt: new Date() },
        { new: true }
      );
      if (!actualizado) {
        // El ítem ya no existe en inventario: no hay dónde devolverlo.
        noEncontrados.push(linea.nombre || String(linea.itemId));
        continue;
      }
      devueltos.push({ itemId: linea.itemId, nombre: linea.nombre || actualizado.nombre, cantidad: linea.cantidad });
    } catch (err) {
      console.error(`⚠️ No se pudo devolver "${linea.nombre}" al inventario:`, err.message);
      noEncontrados.push(linea.nombre || String(linea.itemId));
    }
  }

  return { devueltos, noEncontrados, estimado };
};

// ─────────────────────────────────────────────────────────────────
// DELETE /api/sales/:id  — devuelve el inventario y regenera reportes
// ─────────────────────────────────────────────────────────────────
export const deleteSale = async (req, res) => {
  try {
    const ventaExistente = await Sale.findById(req.params.id);
    if (!ventaExistente) return res.status(404).json({ error: "Venta no encontrada" });

    const fechaVenta = ventaExistente.fecha;

    // Primero se borra la venta y DESPUÉS se devuelve el inventario. En ese
    // orden a propósito: borrar es una sola operación y es lo que el usuario
    // pidió, mientras que la devolución son varias y podría fallar en alguna.
    // Al revés, si la devolución saliera bien y el borrado fallara, quedaría
    // stock inflado con la venta todavía viva, que es peor y más difícil de
    // notar. Lo que no se pudo devolver se informa en la respuesta.
    await Sale.findByIdAndDelete(req.params.id);

    const { devueltos, noEncontrados, estimado } = await restaurarInventarioDeVenta(ventaExistente);

    if (noEncontrados.length > 0) {
      console.warn(`⚠️ Venta ${ventaExistente._id} borrada, pero no se pudo devolver al inventario: ${noEncontrados.join(', ')}`);
    }

    res.json({
      message: "Venta eliminada exitosamente",
      ventaEliminada: { id: ventaExistente._id, total: ventaExistente.total, fecha: ventaExistente.fecha },
      inventario: {
        devueltos,
        noEncontrados,
        // true = la venta es anterior a que se guardara el detalle del
        // descuento, así que se calculó desde la receta/producto de hoy.
        estimado,
      },
    });

    // ✅ Regenerar reportes en background (ventas + estado de resultados)
    regenerarReporteDeVenta(fechaVenta);
    regenerarEstadoDeFecha(fechaVenta);
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar la venta", mensaje: error.message });
  }
};