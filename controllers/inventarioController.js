import Inventario from "../models/Inventario.js";
import cloudinary from "../config/cloudinary.js";
import { mongoose } from "../db.js";
import Sale from "../models/sale.js";

// GET
export const getInventario = async (req, res) => {
  try {
    const data = await Inventario.find().populate("createdBy", "nombre email");
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
// Agregar productos
export const addProducto = async (req, res, next) => {
  console.log("\n🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴");
  console.log("🔴 ADDPRODUCTO SE ESTÁ EJECUTANDO 🔴");
  console.log("🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴");
  console.log("======================================");
  console.log("🚀 INICIO addProducto");
  const inicioTotal = Date.now();

  const { body, file } = req;
  
  console.log("📦 BODY recibido:", body);
  console.log("📷 FILE recibido:", file ? {
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: `${(file.size / 1024).toFixed(2)} KB (${(file.size / (1024 * 1024)).toFixed(2)} MB)`,
    buffer: file.buffer ? '✅ Buffer presente' : '❌ Sin buffer',
    // ✅ NUEVO: mostrar si ya tiene URL de Cloudinary del middleware
    cloudinaryUrl: file.path ? `✅ Ya subida: ${file.path}` : '❌ Sin URL (se subirá aquí)'
  } : "❌ Sin archivo");
  console.log("👤 Usuario autenticado:", req.user);

  try {
    // ✅ 1. VALIDAR USUARIO
    const userId = req.user?.id;
    if (!userId) {
      console.error("❌ Usuario no autenticado");
      return res.status(401).json({
        error: "Usuario no autenticado. Debes iniciar sesión.",
        code: "UNAUTHORIZED"
      });
    }

    // ✅ 2. VALIDAR ARCHIVO
    if (!file) {
      console.error("❌ No se recibió archivo");
      return res.status(400).json({
        error: "No se recibió ninguna imagen. Por favor, selecciona una imagen.",
        code: "NO_FILE"
      });
    }

    // ✅ 3. VALIDAR CAMPOS REQUERIDOS
    const requiredFields = ['nombre', 'cantidad', 'precioCompra', 'precioVenta', 'fechaCompra'];
    const missingFields = requiredFields.filter(field => !body[field]);
    
    if (missingFields.length > 0) {
      console.error("❌ Campos faltantes:", missingFields);
      return res.status(400).json({
        error: `Faltan campos obligatorios: ${missingFields.join(', ')}`,
        code: "MISSING_FIELDS",
        missingFields
      });
    }

    // ✅ 4. OBTENER URL DE CLOUDINARY
    // El middleware uploadToCloudinary ya subió la imagen y guardó la URL en file.path
    // Si por alguna razón no está (e.g. ruta sin middleware), se sube aquí como fallback
    let imageUrl;
    let tiempoCloudinary = 0;

    if (file.path && file.path.startsWith('http')) {
      // ✅ CASO NORMAL: el middleware ya subió la imagen
      imageUrl = file.path;
      console.log("\n✅ Imagen ya subida por middleware uploadToCloudinary");
      console.log(`   URL: ${imageUrl}`);
      console.log(`   Cloudinary ID: ${file.cloudinary_id || 'N/A'}`);
    } else {
      // ⚠️ FALLBACK: el middleware no subió la imagen, se sube aquí
      // Esto no debería pasar si la ruta está bien configurada
      console.warn("\n⚠️ file.path no tiene URL de Cloudinary, subiendo manualmente...");
      console.warn("   Verifica que uploadToCloudinary middleware esté en la ruta");

      if (!file.buffer) {
        console.error("❌ Archivo sin buffer");
        return res.status(400).json({
          error: "El archivo no tiene contenido. Intenta con otra imagen.",
          code: "EMPTY_FILE"
        });
      }

      console.log("\n📤 Subiendo imagen a Cloudinary (fallback)...");
      const inicioCloudinary = Date.now();

      const uploadToCloudinaryFallback = (fileBuffer) => {
        return new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              resource_type: "image",
              folder: "productos",
            },
            (error, result) => {
              if (error) {
                console.error("❌ Error en Cloudinary:", {
                  message: error.message,
                  http_code: error.http_code,
                  name: error.name
                });
                
                const errorMsg = error.message || 'Error desconocido de Cloudinary';
                const cloudinaryError = new Error(`Cloudinary: ${errorMsg}`);
                cloudinaryError.code = 'CLOUDINARY_ERROR';
                cloudinaryError.originalError = error;
                
                reject(cloudinaryError);
              } else {
                resolve(result);
              }
            },
          );
          stream.end(fileBuffer);
        });
      };

      let result;
      try {
        result = await uploadToCloudinaryFallback(file.buffer);
        tiempoCloudinary = Date.now() - inicioCloudinary;
        
        console.log(`✅ Imagen subida exitosamente a Cloudinary (fallback)`);
        console.log(`   URL: ${result.secure_url}`);
        console.log(`   Public ID: ${result.public_id}`);
        console.log(`   Formato: ${result.format}`);
        console.log(`   Tamaño: ${(result.bytes / 1024).toFixed(2)} KB`);
        console.log(`⏱️ TIEMPO CLOUDINARY (fallback): ${tiempoCloudinary}ms (${(tiempoCloudinary / 1000).toFixed(2)}s)`);

        imageUrl = result.secure_url;
        
      } catch (cloudinaryError) {
        console.error("❌ Fallo crítico en Cloudinary:", cloudinaryError);
        
        return res.status(500).json({
          error: "No se pudo subir la imagen a Cloudinary. Verifica las credenciales o intenta más tarde.",
          code: "CLOUDINARY_ERROR",
          details: cloudinaryError.message
        });
      }
    }

    // ⏱️ MEDICIÓN 2: Creación del objeto
    console.log("\n🔨 Creando objeto producto...");
    const inicioCreacion = Date.now();

    const producto = new Inventario({
      nombre: body.nombre,
      cantidad: Number(body.cantidad),
      precioCompra: Number(body.precioCompra),
      precioVenta: Number(body.precioVenta),
      fechaCompra: new Date(body.fechaCompra),
      imagen: imageUrl, // ✅ Usa la URL obtenida (del middleware o del fallback)
      seVende: body.seVende === "true" || body.seVende === true,
      createdBy: userId,
    });

    const tiempoCreacion = Date.now() - inicioCreacion;
    console.log(`⏱️ TIEMPO CREACIÓN OBJETO: ${tiempoCreacion}ms`);

    // ⏱️ MEDICIÓN 3: Save en MongoDB
    console.log("\n💾 Guardando en MongoDB...");
    console.log("   Estado conexión Mongoose:", {
      0: "desconectado",
      1: "conectado",
      2: "conectando",
      3: "desconectando"
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
      
      // Si falló MongoDB, intentar borrar la imagen de Cloudinary
      try {
        console.log("🧹 Limpiando imagen de Cloudinary...");
        const publicId = file.cloudinary_id || null;
        if (publicId) {
          await cloudinary.uploader.destroy(publicId);
          console.log("✅ Imagen eliminada de Cloudinary");
        } else {
          console.warn("⚠️ No se pudo limpiar Cloudinary: sin public_id");
        }
      } catch (cleanupError) {
        console.error("❌ No se pudo limpiar Cloudinary:", cleanupError);
      }
      
      return res.status(500).json({
        error: "No se pudo guardar el producto en la base de datos.",
        code: "DATABASE_ERROR",
        details: mongoError.message
      });
    }

    // ⏱️ RESUMEN FINAL
    const tiempoTotal = Date.now() - inicioTotal;
    console.log("\n📊 ========== RESUMEN DE TIEMPOS ==========");
    console.log(`⏱️ Cloudinary:    ${tiempoCloudinary}ms (${tiempoCloudinary > 0 ? 'fallback' : 'ya subida por middleware'})`);
    console.log(`⏱️ Creación:      ${tiempoCreacion}ms`);
    console.log(`⏱️ TIEMPO TOTAL:  ${tiempoTotal}ms (${(tiempoTotal / 1000).toFixed(2)}s)`);
    console.log("==========================================\n");

    // ✅ RESPUESTA EXITOSA
    res.status(201).json({
      message: "Producto agregado exitosamente",
      producto: savedProducto,
      _debug: {
        uploadTime: tiempoTotal,
        cloudinaryUrl: imageUrl
      }
    });
    
  } catch (error) {
    console.error("❌ ERROR INESPERADO EN ADDPRODUCTO:", {
      message: error.message,
      name: error.name,
      code: error.code,
      stack: error.stack
    });
    
    // Error no manejado
    res.status(500).json({ 
      error: error.message || "Error interno del servidor",
      code: error.code || "INTERNAL_ERROR"
    });
  }
};


// ✅ PUT - ACTUALIZADO CON MEJOR MANEJO DE ERRORES Y LOGS
export const updateProducto = async (req, res) => {
  console.log("========================================");
  console.log("🔵 PETICIÓN PUT RECIBIDA");
  console.log("========================================");
  console.log("req.params.id:", req.params.id);
  console.log("req.body:", req.body);
  console.log("req.file:", req.file);
  console.log("========================================");
  try {
    console.log("=== INICIO updateProducto ===");
    console.log("ID del producto:", req.params.id);
    console.log("Body recibido:", req.body);
    console.log("File recibido:", req.file);
    console.log("Usuario autenticado:", req.user);

    // ✅ Validar que el ID sea válido
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "ID de producto inválido" });
    }

    // Buscar producto actual
    const productoActual = await Inventario.findById(req.params.id);

    if (!productoActual) {
      console.error("❌ Producto no encontrado en la BD");
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    console.log("✅ Producto actual encontrado:", productoActual);

    // Preparar datos de actualización
    const updateData = {
      nombre: req.body.nombre,
      cantidad: Number(req.body.cantidad) || 0,
      precioCompra: Number(req.body.precioCompra) || 0,
      precioVenta: Number(req.body.precioVenta) || 0,
      fechaCompra: req.body.fechaCompra,
      seVende: req.body.seVende === "true" || req.body.seVende === true,
      updatedAt: new Date(),
    };
    console.log("📦 Datos preparados para actualizar:", updateData);

    // ✅ Si hay nueva imagen, procesarla
    if (req.file) {
      console.log("🖼️  Nueva imagen detectada, subiendo a Cloudinary...");
      console.log("Archivo recibido:", {
        fieldname: req.file.fieldname,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      });

      const uploadToCloudinary = (fileBuffer) => {
        return new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              resource_type: "image",
              folder: "productos",
              angle: "exif",
              transformation: [
                { width: 400, height: 400, crop: "fill" },
                { quality: "auto:good" },
                { fetch_format: "auto" },
              ],
            },
            (error, result) => {
              if (error) {
                console.error("❌ Error en Cloudinary upload:", error);
                reject(error);
              } else {
                console.log("✅ Cloudinary upload exitoso");
                resolve(result);
              }
            },
          );
          stream.end(fileBuffer);
        });
      };

      try {
        const result = await uploadToCloudinary(req.file.buffer);
        console.log("✅ Nueva imagen subida a Cloudinary:", result.secure_url);

        // Agregar nueva URL de imagen
        updateData.imagen = result.secure_url;

        // ✅ Eliminar imagen anterior de Cloudinary
        if (productoActual.imagen) {
          try {
            const regex = /\/v\d+\/(.+?)(?:\.\w+)?$/;
            const match = productoActual.imagen.match(regex);

            let publicId;
            if (match) {
              publicId = match[1];
            } else {
              const urlParts = productoActual.imagen.split("/");
              const uploadIndex = urlParts.findIndex(
                (part) => part === "upload",
              );
              if (uploadIndex !== -1 && uploadIndex + 2 < urlParts.length) {
                const pathAfterUpload = urlParts
                  .slice(uploadIndex + 2)
                  .join("/");
                publicId = pathAfterUpload.replace(/\.[^/.]+$/, "");
              }
            }

            if (publicId) {
              console.log("🗑️  Eliminando imagen anterior:", publicId);
              const deleteResult = await cloudinary.uploader.destroy(publicId);
              console.log("Resultado eliminación:", deleteResult);
            }
          } catch (cloudinaryError) {
            console.error(
              "⚠️  Error al eliminar imagen anterior:",
              cloudinaryError,
            );
            // Continuar aunque falle la eliminación
          }
        }
      } catch (uploadError) {
        console.error("❌ Error al subir imagen a Cloudinary:", uploadError);
        return res.status(500).json({
          error: "Error al subir imagen",
          details: uploadError.message,
        });
      }
    } else {
      console.log("ℹ️  No se recibió nueva imagen, se mantiene la actual");
    }

    console.log("📝 Datos finales para actualizar:", updateData);

    // Actualizar producto
    const productoActualizado = await Inventario.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true, // Retorna el documento actualizado
        runValidators: true, // Ejecuta validaciones del schema
      },
    ).populate("createdBy", "nombre email");

    if (!productoActualizado) {
      console.error("❌ No se pudo actualizar el producto");
      return res.status(500).json({ error: "Error al actualizar producto" });
    }

    console.log("✅ Producto actualizado exitosamente:", productoActualizado);
    res.json(productoActualizado);
  } catch (error) {
    console.error("❌ ERROR EN updateProducto:", error);
    console.error("Stack trace:", error.stack);
    res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

// DELETE - ✅ ACTUALIZADO: Elimina producto e imagen de Cloudinary
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
          console.log(
            "Eliminando imagen de Cloudinary con public_id:",
            publicId,
          );

          const result = await cloudinary.uploader.destroy(publicId);
          console.log("Resultado de eliminación en Cloudinary:", result);

          if (result.result === "ok") {
            console.log("✅ Imagen eliminada de Cloudinary exitosamente");
          } else {
            console.warn(
              "⚠️ Cloudinary respondió pero la imagen puede no existir:",
              result,
            );
          }
        } else {
          console.error(
            "❌ No se pudo extraer el public_id de la URL:",
            producto.imagen,
          );
        }
      } catch (cloudinaryError) {
        console.error(
          "❌ Error al eliminar imagen de Cloudinary:",
          cloudinaryError,
        );
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

// GET PAGINADO - ✅ ACTUALIZADO CON POPULATE
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
        "nombre cantidad precioCompra precioVenta fechaCompra imagen seVende createdBy createdAt updatedAt",
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
          "nombre imagen imagenOptimizada imagenOriginal precioVenta cantidad",
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

// ⭐ NUEVA VERSIÓN: Obtener productos disponibles para venta ORDENADOS POR MÁS VENDIDOS
export const getProductosParaVenta = async (req, res) => {
  console.log("\n📦 ===== OBTENIENDO PRODUCTOS PARA VENTA =====");

  try {
    const { search } = req.query;
    console.log(`🔍 Búsqueda: "${search || "sin filtro"}"`);

    // 1️⃣ Filtro base: productos con stock y disponibles para venta
    let matchQuery = {
      cantidad: { $gt: 0 },
      seVende: true,
    };

    // 2️⃣ Si hay búsqueda, agregar filtros
    if (search && search.trim() !== "") {
      const searchRegex = new RegExp(search.trim(), "i");
      matchQuery.$or = [
        { nombre: searchRegex },
        { categoria: searchRegex },
        { codigo: searchRegex },
      ];
      console.log(`   Aplicando filtro de búsqueda: "${search}"`);
    }

    console.log("📊 Calculando productos ordenados por ventas...");

    // 3️⃣ Agregación para obtener productos con total de ventas y ordenarlos
    const productos = await Inventario.aggregate([
      // PASO 1: Filtrar productos disponibles (con stock y se venden)
      { $match: matchQuery },

      // PASO 2: Buscar cuántas veces se vendió cada producto
      {
        $lookup: {
          from: "sales", // ⚠️ Nombre de tu colección de ventas en MongoDB
          let: { productoId: "$_id" }, // Usar _id directamente como ObjectId
          pipeline: [
            // Descomponer el array de productos de cada venta
            { $unwind: "$productos" },
            // Filtrar solo los productos que coincidan con el ID actual
            {
              $match: {
                $expr: {
                  $eq: ["$productos.productoId", "$$productoId"], // Comparar ObjectId
                },
              },
            },
            // Sumar todas las cantidades vendidas
            {
              $group: {
                _id: null,
                totalVendido: { $sum: "$productos.cantidad" },
              },
            },
          ],
          as: "ventasData",
        },
      },

      // PASO 3: Agregar campo totalVendido (0 si nunca se vendió)
      {
        $addFields: {
          totalVendido: {
            $ifNull: [{ $arrayElemAt: ["$ventasData.totalVendido", 0] }, 0],
          },
        },
      },

      // PASO 4: Eliminar campo temporal
      {
        $project: {
          ventasData: 0,
        },
      },

      // PASO 5: 🔥 ORDENAR - MÁS VENDIDOS PRIMERO
      {
        $sort: {
          totalVendido: -1, // -1 = descendente (más vendidos primero)
          nombre: 1, // 1 = ascendente (alfabético como desempate)
        },
      },

      // PASO 6: Limitar resultados
      { $limit: 100 },
    ]);

    console.log(`✅ ${productos.length} productos encontrados y ordenados`);

    // Mostrar top 5 en consola para debug
    if (productos.length > 0) {
      console.log("\n🏆 Top 5 productos más vendidos:");
      productos.slice(0, 5).forEach((p, i) => {
        console.log(`   ${i + 1}. ${p.nombre}`);
        console.log(`      - Vendidos: ${p.totalVendido || 0}`);
        console.log(`      - Stock: ${p.cantidad}`);
        console.log(`      - Precio: ₡${p.precioVenta}`);
      });
    }

    // Respuesta al frontend (mismo formato que antes)
    res.json({
      productos,
      totalEncontrados: productos.length,
    });

    console.log(
      "✅ Productos enviados al frontend (ordenados por más vendidos)\n",
    );
  } catch (error) {
    console.error("\n❌ Error al obtener productos para venta:", error);
    console.error("Mensaje:", error.message);
    console.error("Stack:", error.stack);
    res.status(500).json({
      error: "Error al obtener productos",
      message: error.message,
    });
  }
};
