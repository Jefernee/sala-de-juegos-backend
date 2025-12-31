import Inventario from "../models/Inventario.js";
import cloudinary from "../config/cloudinary.js";
import { mongoose } from "../db.js";

// GET
export const getInventario = async (req, res) => {
  try {
    const data = await Inventario.find().populate('createdBy', 'nombre email');
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
  console.log("Usuario autenticado:", req.user); // ✅ Para debug

  try {
    // ✅ VALIDAR QUE HAYA USUARIO AUTENTICADO
    // El token tiene "id", no "_id"
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ 
        error: "Usuario no autenticado. Debes iniciar sesión." 
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

    // ✅ Crear nuevo producto con referencia al usuario
    const producto = new Inventario({
      nombre: body.nombre,
      cantidad: Number(body.cantidad),
      precioCompra: Number(body.precioCompra),
      precioVenta: Number(body.precioVenta),
      fechaCompra: new Date(body.fechaCompra),
      imagen: result.secure_url,
      
      // ✅ CAMPO CORREGIDO: seVende (como en tu BD)
      seVende: body.seVende === 'true' || body.seVende === true,
      
      // ✅ REFERENCIA AL USUARIO: Usa req.user.id (no _id)
      createdBy: userId
    });

    console.log("Producto listo para guardar:", producto);
    console.log(
      "Estado de conexión Mongoose antes de save:",
      mongoose.connection.readyState
    );

    const savedProducto = await producto.save();
    
    // ✅ Populate para devolver los datos del usuario
    const productoConUsuario = await Inventario.findById(savedProducto._id)
      .populate('createdBy', 'nombre email');
    
    console.log("Producto guardado correctamente:", productoConUsuario);

    res.status(201).json(productoConUsuario);
  } catch (error) {
    console.error("ERROR EN ADDPRODUCTO:", error);
    res.status(500).json({ error: error.message });
  }
};

// PUT - ✅ ACTUALIZADO
export const updateProducto = async (req, res) => {
  try {
    const updateData = {
      ...req.body,
      updatedAt: new Date()
    };
    
    const producto = await Inventario.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate('createdBy', 'nombre email');
    
    res.json(producto);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// DELETE - ✅ ACTUALIZADO: Elimina producto e imagen de Cloudinary
export const deleteProducto = async (req, res) => {
  try {
    // 1. Buscar el producto primero para obtener la URL de la imagen
    const producto = await Inventario.findById(req.params.id);
    
    if (!producto) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    // 2. Extraer el public_id de la URL de Cloudinary
    if (producto.imagen) {
      try {
        // La URL de Cloudinary tiene formato:
        // https://res.cloudinary.com/cloud-name/image/upload/v123456/productos/imagen.jpg
        // Necesitamos extraer: productos/imagen
        
        const regex = /\/v\d+\/(.+?)(?:\.\w+)?$/;
        const match = producto.imagen.match(regex);
        
        let publicId;
        if (match) {
          publicId = match[1]; // Extrae "productos/imagen"
        } else {
          // Fallback: método manual
          const urlParts = producto.imagen.split('/');
          const uploadIndex = urlParts.findIndex(part => part === 'upload');
          if (uploadIndex !== -1 && uploadIndex + 2 < urlParts.length) {
            const pathAfterUpload = urlParts.slice(uploadIndex + 2).join('/');
            publicId = pathAfterUpload.replace(/\.[^/.]+$/, ''); // Remueve extensión
          }
        }

        if (publicId) {
          console.log("Eliminando imagen de Cloudinary con public_id:", publicId);
          
          // 3. Eliminar imagen de Cloudinary
          const result = await cloudinary.uploader.destroy(publicId);
          console.log("Resultado de eliminación en Cloudinary:", result);
          
          if (result.result === 'ok') {
            console.log("✅ Imagen eliminada de Cloudinary exitosamente");
          } else {
            console.warn("⚠️ Cloudinary respondió pero la imagen puede no existir:", result);
          }
        } else {
          console.error("❌ No se pudo extraer el public_id de la URL:", producto.imagen);
        }
      } catch (cloudinaryError) {
        console.error("❌ Error al eliminar imagen de Cloudinary:", cloudinaryError);
        // Continuar con la eliminación del producto aunque falle Cloudinary
      }
    }

    // 4. Eliminar el producto de la base de datos
    await Inventario.findByIdAndDelete(req.params.id);
    
    res.json({ 
      message: "Producto e imagen eliminados correctamente",
      id: req.params.id 
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
    const soloDisponibles = req.query.disponible === 'true';

    let query = search ? { nombre: { $regex: search, $options: "i" } } : {};
    
    if (soloDisponibles) {
      query.seVende = true;
    }

    const productos = await Inventario.find(query)
      .select("nombre cantidad precioCompra precioVenta fechaCompra imagen seVende createdBy createdAt updatedAt")
      .populate('createdBy', 'nombre email') // ✅ Incluir datos del usuario
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
    const search = req.query.search || '';
    
    const skip = (page - 1) * limit;
    
    const filter = {
      seVende: true, // Solo productos disponibles
      ...(search && { nombre: { $regex: search, $options: 'i' } })
    };
    
    const [productos, totalProducts] = await Promise.all([
      Inventario.find(filter)
        .select('nombre imagen imagenOptimizada imagenOriginal precioVenta cantidad')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Inventario.countDocuments(filter)
    ]);
    
    const totalPages = Math.ceil(totalProducts / limit);
    
    res.json({
      productos,
      pagination: {
        totalProducts,
        totalPages,
        currentPage: page,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Error al obtener productos públicos:', error);
    res.status(500).json({ 
      error: 'Error al obtener productos',
      message: error.message 
    });
  }
};

// ✅ NUEVA: Obtener productos disponibles para venta
export const getProductosParaVenta = async (req, res) => {
  try {
    const search = req.query.search || '';
    
    // Filtros: seVende=true Y cantidad>0
    const filter = {
      seVende: true, // Solo productos disponibles para venta
      cantidad: { $gt: 0 }, // Con stock disponible
      ...(search && { nombre: { $regex: search, $options: 'i' } })
    };
    
    const productos = await Inventario.find(filter)
      .select('nombre imagen imagenOptimizada precioVenta cantidad')
      .sort({ nombre: 1 })
      .limit(100);
    
    res.json({ productos });
  } catch (error) {
    console.error('Error al obtener productos para venta:', error);
    res.status(500).json({ 
      error: 'Error al obtener productos',
      message: error.message 
    });
  }
};