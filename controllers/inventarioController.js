import Inventario from "../models/Inventario.js";
import cloudinary from "../config/cloudinary.js";
import { mongoose } from "../db.js";
import Sale from "../models/sale.js";
// Helper: fecha actual en zona horaria de Costa Rica
// medianoche Costa Rica (UTC-6) = 06:00 UTC
const getFechaCostaRica = () => {
  const cr = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }));
  return new Date(Date.UTC(cr.getFullYear(), cr.getMonth(), cr.getDate(), 6, 0, 0, 0));
};

// GET
export const getInventario = async (req, res) => {
  try {
    const data = await Inventario.find().populate("createdBy", "nombre email");
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ============================================
// AGREGAR PRODUCTO con base 64 no form
// ============================================
export const addProducto = async (req, res) => {
  console.log("\n🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴");
  console.log("🔴 ADDPRODUCTO SE ESTÁ EJECUTANDO 🔴");
  console.log("🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴");
  console.log("======================================");
  console.log("🚀 INICIO addProducto");

  const inicioTotal = Date.now();
  const { body } = req;

  console.log("📦 BODY recibido:", {
    nombre: body.nombre,
    cantidad: body.cantidad,
    precioCompra: body.precioCompra,
    precioVenta: body.precioVenta,
    fechaCompra: body.fechaCompra,
    seVende: body.seVende,
    tipo: body.tipo || 'producto',
    imagenCloudinary: req.cloudinaryUrl ? `✅ URL presente: ${req.cloudinaryUrl}` : "❌ ausente",
  });
  console.log("👤 Usuario autenticado:", req.user);

  try {
    // ✅ 1. VALIDAR USUARIO
    const userId = req.user?.id;
    if (!userId) {
      console.error("❌ Usuario no autenticado");
      return res.status(401).json({
        error: "Usuario no autenticado. Debes iniciar sesión.",
        code: "UNAUTHORIZED",
      });
    }

    const tipo = body.tipo === 'receta' ? 'receta' : 'producto';

    // ─────────────────────────────────────────────────────────────────
    // Hecho por Claude Code — Rama para crear una RECETA (producto compuesto).
    // Las recetas no tienen stock propio ni requieren imagen obligatoria.
    // Su costo se calcula dinámicamente al momento de la venta.
    // ─────────────────────────────────────────────────────────────────
    if (tipo === 'receta') {
      if (!body.nombre || !body.precioVenta) {
        return res.status(400).json({
          error: 'Faltan campos obligatorios para la receta: nombre, precioVenta',
          code: 'MISSING_FIELDS',
        });
      }

      const recetaRaw = typeof body.receta === 'string'
        ? JSON.parse(body.receta)
        : body.receta;

      if (!Array.isArray(recetaRaw) || recetaRaw.length === 0) {
        return res.status(400).json({
          error: 'La receta debe tener al menos un ingrediente',
          code: 'RECETA_VACIA',
        });
      }

      // Validar que no haya ingredientes duplicados
      const idsUnicos = new Set(recetaRaw.map(r => r.ingredienteId?.toString()));
      if (idsUnicos.size !== recetaRaw.length) {
        return res.status(400).json({ error: 'La receta tiene ingredientes duplicados', code: 'INGREDIENTE_DUPLICADO' });
      }

      // Verificar que cada ingrediente exista y no sea otra receta
      const ingredienteIds = recetaRaw.map(r => r.ingredienteId).filter(Boolean);
      const ingredientesDB = await Inventario.find({
        _id: { $in: ingredienteIds },
        tipo: { $ne: 'receta' }, // Las recetas no pueden ser ingrediente de otra receta
      }).lean();

      if (ingredientesDB.length !== ingredienteIds.length) {
        return res.status(400).json({
          error: 'Uno o más ingredientes no existen o son recetas (las recetas no pueden ser ingrediente de otra receta)',
          code: 'INGREDIENTE_INVALIDO',
        });
      }

      const ingredientesMap = new Map(ingredientesDB.map(i => [i._id.toString(), i]));
      const recetaValidada = [];

      for (const comp of recetaRaw) {
        if (!comp.ingredienteId || !comp.cantidad || Number(comp.cantidad) <= 0) {
          return res.status(400).json({
            error: 'Cada ingrediente debe tener un ID válido y una cantidad mayor a 0',
            code: 'INGREDIENTE_DATOS_INVALIDOS',
          });
        }
        const ingredienteDB = ingredientesMap.get(comp.ingredienteId.toString());
        if (!ingredienteDB) {
          return res.status(400).json({ error: `Ingrediente con ID "${comp.ingredienteId}" no encontrado`, code: 'INGREDIENTE_NO_ENCONTRADO' });
        }
        recetaValidada.push({
          ingredienteId: comp.ingredienteId,
          nombre: ingredienteDB.nombre, // guardado para referencia rápida
          cantidad: Number(comp.cantidad),
        });
      }

      const nuevaReceta = new Inventario({
        nombre: body.nombre,
        cantidad: 0,           // Las recetas no tienen stock propio
        precioCompra: 0,       // Se calcula dinámicamente en cada venta
        precioVenta: Number(body.precioVenta),
        fechaCompra: getFechaCostaRica(),
        imagen: req.cloudinaryUrl || null,
        seVende: body.seVende === 'false' || body.seVende === false ? false : true,
        tipo: 'receta',
        receta: recetaValidada,
        createdBy: userId,
      });

      const savedReceta = await nuevaReceta.save();
      console.log(`✅ Receta "${savedReceta.nombre}" creada con ${recetaValidada.length} ingrediente(s)`);

      return res.status(201).json({
        message: 'Receta creada exitosamente',
        producto: savedReceta,
      });
    }

    // ─────────────────────────────────────────────────────────────────
    // Rama original: PRODUCTO SIMPLE (tipo: 'producto')
    // ─────────────────────────────────────────────────────────────────

    // ✅ 2. VALIDAR IMAGEN BASE64
    if (!req.cloudinaryUrl) {
      console.error("❌ No se recibió imagen o falló la subida a Cloudinary");
      return res.status(400).json({
        error: "No se recibió ninguna imagen. Por favor, selecciona una imagen.",
        code: "NO_IMAGE",
      });
    }

    // ✅ 3. VALIDAR CAMPOS REQUERIDOS
    const requiredFields = ["nombre", "cantidad", "precioCompra", "precioVenta"];
    const missingFields = requiredFields.filter((field) => !body[field] && body[field] !== 0);

    if (missingFields.length > 0) {
      console.error("❌ Campos faltantes:", missingFields);
      return res.status(400).json({
        error: `Faltan campos obligatorios: ${missingFields.join(", ")}`,
        code: "MISSING_FIELDS",
        missingFields,
      });
    }

    // ✅ 4. CREAR OBJETO PRODUCTO
    console.log("\n🔨 Creando objeto producto...");
    const inicioCreacion = Date.now();

    const producto = new Inventario({
      nombre: body.nombre,
      cantidad: Number(body.cantidad),
      precioCompra: Number(body.precioCompra),
      precioVenta: Number(body.precioVenta),
      fechaCompra: getFechaCostaRica(),
      imagen: req.cloudinaryUrl,
      seVende: body.seVende === "true" || body.seVende === true,
      tipo: 'producto',
      unidad: body.unidad?.trim() || 'unidades',
      cantidadPorEnvase: body.cantidadPorEnvase ? Number(body.cantidadPorEnvase) : null,
      nombreEnvase: body.nombreEnvase?.trim() || null,
      createdBy: userId,
    });

    const tiempoCreacion = Date.now() - inicioCreacion;
    console.log(`⏱️ TIEMPO CREACIÓN OBJETO: ${tiempoCreacion}ms`);

    // ✅ 5. GUARDAR EN MONGODB
    console.log("\n💾 Guardando en MongoDB...");
    console.log(" Estado conexión Mongoose:", {
      0: "desconectado",
      1: "conectado",
      2: "conectando",
      3: "desconectando",
    }[mongoose.connection.readyState]);

    const inicioSave = Date.now();
    let savedProducto;

    try {
      savedProducto = await producto.save();
      const tiempoSave = Date.now() - inicioSave;
      console.log(`✅ Producto guardado en BD`);
      console.log(`   ID: ${savedProducto._id}`);
      console.log(`⏱️ TIEMPO SAVE MONGODB: ${tiempoSave}ms (${(tiempoSave / 1000).toFixed(2)}s)`);
    } catch (mongoError) {
      console.error("❌ Fallo crítico en MongoDB:", mongoError);

      if (req.cloudinaryPublicId) {
        try {
          console.log("🧹 Limpiando imagen de Cloudinary...");
          await cloudinary.uploader.destroy(req.cloudinaryPublicId);
          console.log("✅ Imagen eliminada de Cloudinary");
        } catch (cleanupError) {
          console.error("❌ No se pudo limpiar Cloudinary:", cleanupError);
        }
      }

      return res.status(500).json({
        error: "No se pudo guardar el producto en la base de datos.",
        code: "DATABASE_ERROR",
        details: mongoError.message,
      });
    }

    const tiempoTotal = Date.now() - inicioTotal;
    console.log("\n📊 ========== RESUMEN DE TIEMPOS ==========");
    console.log(`⏱️ Creación objeto: ${tiempoCreacion}ms`);
    console.log(`⏱️ TIEMPO TOTAL: ${tiempoTotal}ms (${(tiempoTotal / 1000).toFixed(2)}s)`);
    console.log("==========================================\n");

    return res.status(201).json({
      message: "Producto agregado exitosamente",
      producto: savedProducto,
      _debug: {
        uploadTime: tiempoTotal,
        cloudinaryUrl: req.cloudinaryUrl,
      },
    });

  } catch (error) {
    console.error("❌ ERROR INESPERADO EN ADDPRODUCTO:", {
      message: error.message,
      name: error.name,
      code: error.code,
      stack: error.stack,
    });

    return res.status(500).json({
      error: error.message || "Error interno del servidor",
      code: error.code || "INTERNAL_ERROR",
    });
  }
};

// ============================================
// PUT - ACTUALIZAR PRODUCTO
// La cantidad NO se sobreescribe: se usa $inc
// para agregar unidades (reposición de stock).
// Si cantidadAAgregar es 0 o no viene, el stock
// no se toca.
// ============================================
export const updateProducto = async (req, res) => {
  console.log("========================================");
  console.log("🔵 PETICIÓN PUT RECIBIDA");
  console.log("========================================");
  console.log("req.params.id:", req.params.id);
  console.log("req.body:", req.body);
  console.log("req.cloudinaryUrl:", req.cloudinaryUrl || "❌ No hay nueva imagen");
  console.log("Usuario autenticado:", req.user);
  console.log("========================================");

  try {
    // ✅ Validar que el ID sea válido
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "ID de producto inválido" });
    }

    const productoActual = await Inventario.findById(req.params.id);

    if (!productoActual) {
      console.error("❌ Producto no encontrado en la BD");
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    console.log("✅ Producto actual encontrado:", {
      id: productoActual._id,
      nombre: productoActual.nombre,
      cantidadActual: productoActual.cantidad,
      imagenActual: productoActual.imagen,
    });

    // ✅ Campos editables (cantidad NO incluida aquí)
    const $set = {
      nombre: req.body.nombre,
      precioCompra: Number(req.body.precioCompra) || 0,
      precioVenta: Number(req.body.precioVenta) || 0,
      seVende: req.body.seVende === "true" || req.body.seVende === true,
      updatedAt: new Date(),
    };

    if (req.body.unidad !== undefined)           $set.unidad           = req.body.unidad?.trim() || 'unidades';
    if (req.body.cantidadPorEnvase !== undefined) $set.cantidadPorEnvase = req.body.cantidadPorEnvase ? Number(req.body.cantidadPorEnvase) : null;
    if (req.body.nombreEnvase !== undefined)      $set.nombreEnvase      = req.body.nombreEnvase?.trim() || null;

    // ─────────────────────────────────────────────────────────────────
    // Hecho por Claude Code — Actualización de ingredientes de una receta.
    // Si viene el campo 'receta' en el body, se validan y actualizan
    // los ingredientes. Solo aplica cuando el item es tipo 'receta'.
    // ─────────────────────────────────────────────────────────────────
    if (req.body.receta !== undefined) {
      const tipoFinal = req.body.tipo || productoActual.tipo || 'producto';
      if (tipoFinal !== 'receta') {
        return res.status(400).json({ error: 'Solo se puede actualizar la receta de un producto de tipo "receta"' });
      }

      const recetaRaw = typeof req.body.receta === 'string'
        ? JSON.parse(req.body.receta)
        : req.body.receta;

      if (!Array.isArray(recetaRaw) || recetaRaw.length === 0) {
        return res.status(400).json({ error: 'La receta debe tener al menos un ingrediente' });
      }

      // Validar duplicados
      const idsUnicos = new Set(recetaRaw.map(r => r.ingredienteId?.toString()));
      if (idsUnicos.size !== recetaRaw.length) {
        return res.status(400).json({ error: 'La receta tiene ingredientes duplicados' });
      }

      const ingredienteIds = recetaRaw.map(r => r.ingredienteId).filter(Boolean);
      const ingredientesDB = await Inventario.find({
        _id: { $in: ingredienteIds },
        tipo: { $ne: 'receta' },
      }).lean();

      if (ingredientesDB.length !== ingredienteIds.length) {
        return res.status(400).json({ error: 'Uno o más ingredientes no existen o son recetas' });
      }

      const ingMap = new Map(ingredientesDB.map(i => [i._id.toString(), i]));
      const recetaValidada = [];

      for (const comp of recetaRaw) {
        if (!comp.ingredienteId || !comp.cantidad || Number(comp.cantidad) <= 0) {
          return res.status(400).json({ error: 'Cada ingrediente debe tener ID y cantidad mayor a 0' });
        }
        const ing = ingMap.get(comp.ingredienteId.toString());
        if (!ing) return res.status(400).json({ error: `Ingrediente "${comp.ingredienteId}" no encontrado` });
        recetaValidada.push({ ingredienteId: comp.ingredienteId, nombre: ing.nombre, cantidad: Number(comp.cantidad) });
      }

      $set.receta = recetaValidada;
      console.log(`📋 Receta actualizada con ${recetaValidada.length} ingrediente(s)`);
    }

    // ✅ Reposición de stock: solo suma, nunca sobreescribe.
    // Soporta dos modos:
    //   - cantidadAAgregar: número directo de unidades base (ej. 500 ml)
    //   - envasesAAgregar: número de envases comprados; se multiplica por cantidadPorEnvase
    //     (ej. 2 botellas × 500 ml/botella = 1000 ml). Requiere cantidadPorEnvase configurado.
    // Las recetas no tienen stock propio; se ignora cualquier reposición.
    const esReceta = productoActual.tipo === 'receta' || req.body.tipo === 'receta';
    let cantidadAAgregar = 0;
    if (!esReceta) {
      const envasesAAgregar = Number(req.body.envasesAAgregar) || 0;
      const porEnvase = productoActual.cantidadPorEnvase || ($set.cantidadPorEnvase ?? null);
      if (envasesAAgregar > 0 && porEnvase) {
        cantidadAAgregar = envasesAAgregar * porEnvase;
        console.log(`📦 Reposición por envases: ${envasesAAgregar} ${productoActual.nombreEnvase || 'envase(s)'} × ${porEnvase} = ${cantidadAAgregar} ${productoActual.unidad || 'unidades'}`);
      } else {
        cantidadAAgregar = Number(req.body.cantidadAAgregar) || 0;
      }
    } else {
      console.log('ℹ️ Ignorando reposición en receta (las recetas no tienen stock propio)');
    }
    console.log(`📦 Unidades a agregar al stock: ${cantidadAAgregar}`);

    // ✅ Imagen: si viene nueva, actualizar URL y eliminar la anterior
    if (req.cloudinaryUrl) {
      console.log("🖼️ Nueva imagen detectada en Cloudinary:", req.cloudinaryUrl);
      $set.imagen = req.cloudinaryUrl;

      if (productoActual.imagen) {
        try {
          const regex = /\/v\d+\/(.+?)(?:\.\w+)?$/;
          const match = productoActual.imagen.match(regex);

          let publicId;
          if (match) {
            publicId = match[1];
          } else {
            const urlParts = productoActual.imagen.split("/");
            const uploadIndex = urlParts.findIndex((part) => part === "upload");
            if (uploadIndex !== -1 && uploadIndex + 2 < urlParts.length) {
              const pathAfterUpload = urlParts.slice(uploadIndex + 2).join("/");
              publicId = pathAfterUpload.replace(/\.[^/.]+$/, "");
            }
          }

          if (publicId) {
            console.log("🗑️ Eliminando imagen anterior:", publicId);
            const deleteResult = await cloudinary.uploader.destroy(publicId);
            console.log("Resultado eliminación:", deleteResult);
          }
        } catch (cloudinaryError) {
          console.error("⚠️ Error al eliminar imagen anterior:", cloudinaryError);
        }
      }
    } else {
      console.log("ℹ️ No se recibió nueva imagen, se mantiene la actual");
    }

    // ✅ Construir operación de actualización
    // $set: actualiza campos editables
    // $inc: suma unidades al stock (solo si cantidadAAgregar > 0)
    const updateOperation = { $set };
    if (cantidadAAgregar > 0) {
      updateOperation.$inc = { cantidad: cantidadAAgregar };
      console.log(`➕ Stock: ${productoActual.cantidad} + ${cantidadAAgregar} = ${productoActual.cantidad + cantidadAAgregar}`);
    } else {
      console.log("ℹ️ Sin reposición, stock no modificado");
    }

    console.log("📝 Operación final:", JSON.stringify(updateOperation, null, 2));

    const productoActualizado = await Inventario.findByIdAndUpdate(
      req.params.id,
      updateOperation,
      {
        new: true,          // retorna el documento actualizado
        runValidators: true,
      }
    ).populate("createdBy", "nombre email");

    if (!productoActualizado) {
      console.error("❌ No se pudo actualizar el producto");
      return res.status(500).json({ error: "Error al actualizar producto" });
    }

    console.log("✅ Producto actualizado exitosamente:", {
      id: productoActualizado._id,
      nombre: productoActualizado.nombre,
      cantidadNueva: productoActualizado.cantidad,
      imagenNueva: productoActualizado.imagen,
    });

    res.json({
      message: "Producto actualizado exitosamente",
      producto: productoActualizado,
    });

  } catch (error) {
    console.error("❌ ERROR EN updateProducto:", error);
    console.error("Stack trace:", error.stack);

    res.status(500).json({
      error: error.message || "Error al actualizar producto",
      code: error.code || "UPDATE_ERROR",
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

// DELETE - Elimina producto e imagen de Cloudinary
export const deleteProducto = async (req, res) => {
  try {
    const producto = await Inventario.findById(req.params.id);

    if (!producto) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    if (producto.imagen) {
      try {
        const regex = /\/v\d+\/(.+?)(?:\.\w+)?$/;
        const match = producto.imagen.match(regex);

        let publicId;
        if (match) {
          publicId = match[1];
        } else {
          const urlParts = producto.imagen.split("/");
          const uploadIndex = urlParts.findIndex((part) => part === "upload");
          if (uploadIndex !== -1 && uploadIndex + 2 < urlParts.length) {
            const pathAfterUpload = urlParts.slice(uploadIndex + 2).join("/");
            publicId = pathAfterUpload.replace(/\.[^/.]+$/, "");
          }
        }

        if (publicId) {
          console.log("Eliminando imagen de Cloudinary con public_id:", publicId);
          const result = await cloudinary.uploader.destroy(publicId);
          console.log("Resultado de eliminación en Cloudinary:", result);

          if (result.result === "ok") {
            console.log("✅ Imagen eliminada de Cloudinary exitosamente");
          } else {
            console.warn("⚠️ Cloudinary respondió pero la imagen puede no existir:", result);
          }
        } else {
          console.error("❌ No se pudo extraer el public_id de la URL:", producto.imagen);
        }
      } catch (cloudinaryError) {
        console.error("❌ Error al eliminar imagen de Cloudinary:", cloudinaryError);
      }
    }

    await Inventario.findByIdAndDelete(req.params.id);

    res.json({
      message: "Producto e imagen eliminados correctamente",
      id: req.params.id,
    });
  } catch (error) {
    console.error("Error al eliminar producto:", error);
    res.status(500).json({ error: error.message });
  }
};

// GET PAGINADO
export const getProductosPaginados = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const MAX_PAGE = 100;

    if (page > MAX_PAGE) {
      return res.status(400).json({
        error: `Página ${page} excede el máximo permitido (${MAX_PAGE})`,
      });
    }

    const skip = (page - 1) * limit;
    const search = req.query.search || "";
    const soloDisponibles = req.query.disponible === "true";

    let query = search ? { nombre: { $regex: search, $options: "i" } } : {};

    if (soloDisponibles) {
      query.seVende = true;
    }

    const productos = await Inventario.find(query)
      .select(
        "nombre cantidad precioCompra precioVenta fechaCompra imagen seVende tipo receta unidad cantidadPorEnvase nombreEnvase createdBy createdAt updatedAt"
      )
      .populate("createdBy", "nombre email")
      .limit(limit)
      .skip(skip)
      .sort({ createdAt: -1 })
      .lean();

    const total = await Inventario.countDocuments(query);

    const productosOptimizados = productos.map((producto) => {
      return {
        ...producto,
        imagenOptimizada: producto.imagen,
        imagenOriginal: producto.imagen,
      };
    });

    const totalPages = Math.ceil(total / limit);

    res.json({
      productos: productosOptimizados,
      pagination: {
        currentPage: page,
        totalPages: Math.min(totalPages, MAX_PAGE),
        totalProducts: total,
        productsPerPage: limit,
        hasNextPage: page < totalPages && page < MAX_PAGE,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Error al obtener productos paginados:", error);
    res.status(500).json({
      message: "Error al obtener productos",
      error: error.message,
    });
  }
};

// ✅ PRODUCTOS PÚBLICOS - Solo disponibles
export const getProductosPublicos = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const search = req.query.search || "";

    const skip = (page - 1) * limit;

    const filter = {
      seVende: true,
      ...(search && { nombre: { $regex: search, $options: "i" } }),
    };

    const [productos, totalProducts] = await Promise.all([
      Inventario.find(filter)
        .select(
          "nombre imagen imagenOptimizada imagenOriginal precioVenta cantidad"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Inventario.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalProducts / limit);

    res.json({
      productos,
      pagination: {
        totalProducts,
        totalPages,
        currentPage: page,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Error al obtener productos públicos:", error);
    res.status(500).json({
      error: "Error al obtener productos",
      message: error.message,
    });
  }
};

// ⭐ Obtener productos disponibles para venta ORDENADOS POR MÁS VENDIDOS
// Hecho por Claude Code — Se extendió para incluir recetas con stock calculado
// a partir de sus ingredientes. Ambos tipos (producto y receta) se mezclan
// y ordenan por totalVendido antes de enviarse al frontend.
export const getProductosParaVenta = async (req, res) => {
  console.log("\n📦 ===== OBTENIENDO PRODUCTOS PARA VENTA =====");

  try {
    const { search } = req.query;
    console.log(`🔍 Búsqueda: "${search || "sin filtro"}"`);

    // ── 1. Productos simples (tipo != 'receta') ──────────────────────
    let matchQuerySimples = {
      cantidad: { $gt: 0 },
      seVende: true,
      tipo: { $ne: 'receta' }, // Excluir recetas de esta consulta
    };

    if (search && search.trim() !== "") {
      const searchRegex = new RegExp(search.trim(), "i");
      matchQuerySimples.$or = [
        { nombre: searchRegex },
        { categoria: searchRegex },
        { codigo: searchRegex },
      ];
    }

    console.log("📊 Calculando productos simples ordenados por ventas...");

    const productosSimples = await Inventario.aggregate([
      { $match: matchQuerySimples },
      {
        $lookup: {
          from: "sales",
          let: { productoId: "$_id" },
          pipeline: [
            { $unwind: "$productos" },
            { $match: { $expr: { $eq: ["$productos.productoId", "$$productoId"] } } },
            { $group: { _id: null, totalVendido: { $sum: "$productos.cantidad" } } },
          ],
          as: "ventasData",
        },
      },
      {
        $addFields: {
          totalVendido: { $ifNull: [{ $arrayElemAt: ["$ventasData.totalVendido", 0] }, 0] },
        },
      },
      { $project: { ventasData: 0 } },
      { $sort: { totalVendido: -1, nombre: 1 } },
      { $limit: 100 },
    ]);

    // ── 2. Recetas con stock calculado a partir de ingredientes ──────
    // Hecho por Claude Code — Para cada receta activa, se verifica cuántas
    // unidades pueden prepararse con el stock actual de sus ingredientes.
    // stockDisponible = floor(min(ingrediente.cantidad / cantidadRequerida))
    let matchRecetas = { tipo: 'receta', seVende: true };
    if (search && search.trim() !== "") {
      matchRecetas.nombre = { $regex: search.trim(), $options: 'i' };
    }

    const recetasRaw = await Inventario.find(matchRecetas)
      .populate('receta.ingredienteId', 'nombre cantidad precioCompra unidad cantidadPorEnvase nombreEnvase')
      .lean();

    const recetasConStock = [];

    for (const receta of recetasRaw) {
      if (!receta.receta || receta.receta.length === 0) continue;

      let stockDisponible = Infinity;
      let costoCalculado = 0;
      let ingredienteFaltante = false;

      for (const comp of receta.receta) {
        const ing = comp.ingredienteId;
        if (!ing) { ingredienteFaltante = true; break; }

        const unidadesHacibles = Math.floor(ing.cantidad / comp.cantidad);
        stockDisponible = Math.min(stockDisponible, unidadesHacibles);
        costoCalculado += (ing.precioCompra || 0) * comp.cantidad;
      }

      if (ingredienteFaltante || stockDisponible <= 0 || stockDisponible === Infinity) continue;

      recetasConStock.push({
        ...receta,
        cantidad: stockDisponible,          // Stock calculado para el frontend
        precioCompra: costoCalculado,        // Costo real calculado de ingredientes
        totalVendido: 0,                     // Se calcula a continuación
      });
    }

    // Obtener totalVendido de las recetas en una sola consulta
    if (recetasConStock.length > 0) {
      const recetaIds = recetasConStock.map(r => r._id);
      const ventasRecetas = await Sale.aggregate([
        { $unwind: '$productos' },
        { $match: { 'productos.productoId': { $in: recetaIds } } },
        { $group: { _id: '$productos.productoId', totalVendido: { $sum: '$productos.cantidad' } } },
      ]);
      const ventasMap = new Map(ventasRecetas.map(v => [v._id.toString(), v.totalVendido]));
      for (const r of recetasConStock) {
        r.totalVendido = ventasMap.get(r._id.toString()) || 0;
      }
    }

    // ── 3. Combinar, ordenar y limitar a 100 ────────────────────────
    const todos = [...productosSimples, ...recetasConStock]
      .sort((a, b) => b.totalVendido - a.totalVendido || a.nombre.localeCompare(b.nombre))
      .slice(0, 100);

    console.log(`✅ ${productosSimples.length} producto(s) simple(s) + ${recetasConStock.length} receta(s) = ${todos.length} total`);

    if (todos.length > 0) {
      console.log("\n🏆 Top 5 más vendidos (productos + recetas):");
      todos.slice(0, 5).forEach((p, i) => {
        console.log(`   ${i + 1}. [${p.tipo || 'producto'}] ${p.nombre} — vendidos: ${p.totalVendido || 0} — stock: ${p.cantidad}`);
      });
    }

    res.json({ productos: todos, totalEncontrados: todos.length });

    console.log("✅ Productos y recetas enviados al frontend\n");
  } catch (error) {
    console.error("\n❌ Error al obtener productos para venta:", error);
    console.error("Mensaje:", error.message);
    console.error("Stack:", error.stack);
    res.status(500).json({ error: "Error al obtener productos", message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// Hecho por Claude Code — GET /api/products/:id
// Devuelve un producto o receta por su ID incluyendo los campos
// tipo y receta (con ingredientes populados) para que el frontend
// pueda cargar el formulario de edición correctamente.
// ─────────────────────────────────────────────────────────────────
export const getProductoById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'ID de producto inválido' });
    }

    const producto = await Inventario.findById(req.params.id)
      .populate('createdBy', 'nombre email')
      .populate('receta.ingredienteId', 'nombre cantidad precioCompra precioVenta imagen seVende tipo')
      .lean();

    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({ producto });
  } catch (error) {
    console.error('Error al obtener producto por ID:', error);
    res.status(500).json({ error: 'Error al obtener producto', mensaje: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// Hecho por Claude Code — GET /api/products/ingredientes
// Retorna todos los ítems de inventario que pueden usarse como
// ingredientes al armar una receta (solo tipo: 'producto').
// El frontend lo usa para el selector de ingredientes en el
// formulario de creación/edición de recetas.
// ─────────────────────────────────────────────────────────────────
export const getIngredientes = async (req, res) => {
  try {
    const { search } = req.query;
    const filtro = { tipo: { $ne: 'receta' } };
    if (search && search.trim()) {
      filtro.nombre = { $regex: search.trim(), $options: 'i' };
    }

    const ingredientes = await Inventario.find(filtro)
      .select('nombre cantidad precioCompra precioVenta imagen seVende tipo unidad cantidadPorEnvase nombreEnvase')
      .sort({ nombre: 1 })
      .lean();

    res.json({ ingredientes, total: ingredientes.length });
  } catch (error) {
    console.error('Error al obtener ingredientes:', error);
    res.status(500).json({ error: 'Error al obtener ingredientes', mensaje: error.message });
  }
};