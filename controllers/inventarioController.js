import Inventario from "../models/Inventario.js";
import cloudinary from "../config/cloudinary.js";
import { mongoose } from "../db.js";

// GET
export const getInventario = async (req, res) => {
  try {
    const data = await Inventario.find().populate("createdBy", "nombre email");
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// POST - ✅ ACTUALIZADO CON USUARIO
export const addProducto = async (req, res, next) => {
  console.log("Estado de conexión Mongoose:", mongoose.connection.readyState);
  console.log("INICIO addProducto");

  const { body, file } = req;
  console.log("BODY recibido:", body);
  console.log("FILE recibido:", file);
  console.log("Usuario autenticado:", req.user);

  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: "Usuario no autenticado. Debes iniciar sesión.",
      });
    }

    console.log(
      "Estado de conexión Mongoose antes de subir imagen:",
      req.app.get("mongooseConnection")?.readyState || 0
    );
    console.log(
      "Mongoose connection readyState:",
      mongoose.connection.readyState
    );

    console.log("Subiendo imagen a Cloudinary...");

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
              reject(error);
            } else {
              resolve(result);
            }
          }
        );
        stream.end(fileBuffer);
      });
    };

    const result = await uploadToCloudinary(file.buffer);
    console.log("Imagen subida y optimizada:", result.secure_url);

    const producto = new Inventario({
      nombre: body.nombre,
      cantidad: Number(body.cantidad),
      precioCompra: Number(body.precioCompra),
      precioVenta: Number(body.precioVenta),
      fechaCompra: new Date(body.fechaCompra),
      imagen: result.secure_url,
      seVende: body.seVende === "true" || body.seVende === true,
      createdBy: userId,
    });

    console.log("Producto listo para guardar:", producto);
    console.log(
      "Estado de conexión Mongoose antes de save:",
      mongoose.connection.readyState
    );

    const savedProducto = await producto.save();

    const productoConUsuario = await Inventario.findById(
      savedProducto._id
    ).populate("createdBy", "nombre email");

    console.log("Producto guardado correctamente:", productoConUsuario);

    res.status(201).json(productoConUsuario);
  } catch (error) {
    console.error("ERROR EN ADDPRODUCTO:", error);
    res.status(500).json({ error: error.message });
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
            }
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
                (part) => part === "upload"
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
              cloudinaryError
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
      }
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
            publicId
          );

          const result = await cloudinary.uploader.destroy(publicId);
          console.log("Resultado de eliminación en Cloudinary:", result);

          if (result.result === "ok") {
            console.log("✅ Imagen eliminada de Cloudinary exitosamente");
          } else {
            console.warn(
              "⚠️ Cloudinary respondió pero la imagen puede no existir:",
              result
            );
          }
        } else {
          console.error(
            "❌ No se pudo extraer el public_id de la URL:",
            producto.imagen
          );
        }
      } catch (cloudinaryError) {
        console.error(
          "❌ Error al eliminar imagen de Cloudinary:",
          cloudinaryError
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
        "nombre cantidad precioCompra precioVenta fechaCompra imagen seVende createdBy createdAt updatedAt"
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

// ✅ NUEVA: Obtener productos disponibles para venta
export const getProductosParaVenta = async (req, res) => {
  try {
    const search = req.query.search || "";

    const filter = {
      seVende: true,
      cantidad: { $gt: 0 },
      ...(search && { nombre: { $regex: search, $options: "i" } }),
    };

    const productos = await Inventario.find(filter)
      .select("nombre imagen imagenOptimizada precioVenta cantidad")
      .sort({ nombre: 1 })
      .limit(100);

    res.json({ productos });
  } catch (error) {
    console.error("Error al obtener productos para venta:", error);
    res.status(500).json({
      error: "Error al obtener productos",
      message: error.message,
    });
  }
};
