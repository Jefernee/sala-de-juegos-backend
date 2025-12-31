// controllers/pedidosController.js
import Pedido from '../models/Pedido.js';
import Inventario from '../models/Inventario.js';

// Crear nuevo pedido
export const addPedido = async (req, res) => {
  try {
    const {
      productoId,
      productoNombre,
      precioVenta,
      nombreCliente,
      telefono,
      email,
      cantidad,
      notas,
      total
    } = req.body;
    
    const producto = await Inventario.findById(productoId);
    
    if (!producto) {
      return res.status(404).json({ 
        error: 'Producto no encontrado' 
      });
    }
    
    if (producto.cantidad < cantidad) {
      return res.status(400).json({ 
        error: 'Stock insuficiente',
        disponible: producto.cantidad
      });
    }
    
    const nuevoPedido = new Pedido({
      productoId,
      productoNombre,
      precioVenta,
      nombreCliente,
      telefono,
      email,
      cantidad,
      total,
      notas
    });
    
    await nuevoPedido.save();
    
    res.status(201).json({
      message: 'Pedido creado exitosamente',
      pedido: nuevoPedido
    });
    
  } catch (error) {
    console.error('Error al crear pedido:', error);
    res.status(500).json({ 
      error: 'Error al crear el pedido',
      message: error.message 
    });
  }
};

export const getPedidos = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const estado = req.query.estado;
    
    const skip = (page - 1) * limit;
    const filter = {};
    if (estado) filter.estado = estado;
    
    const [pedidos, totalPedidos] = await Promise.all([
      Pedido.find(filter)
        .populate('productoId', 'nombre imagen')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Pedido.countDocuments(filter)
    ]);
    
    const totalPages = Math.ceil(totalPedidos / limit);
    
    res.json({
      pedidos,
      pagination: {
        totalPedidos,
        totalPages,
        currentPage: page,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Error al obtener pedidos:', error);
    res.status(500).json({ 
      error: 'Error al obtener pedidos',
      message: error.message 
    });
  }
};

export const getPedidoById = async (req, res) => {
  try {
    const pedido = await Pedido.findById(req.params.id)
      .populate('productoId', 'nombre imagen precioVenta cantidad');
    
    if (!pedido) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    
    res.json(pedido);
  } catch (error) {
    console.error('Error al obtener pedido:', error);
    res.status(500).json({ 
      error: 'Error al obtener pedido',
      message: error.message 
    });
  }
};

export const updatePedidoEstado = async (req, res) => {
  try {
    const { estado } = req.body;
    
    const estadosValidos = ['pendiente', 'confirmado', 'completado', 'cancelado'];
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ 
        error: 'Estado inválido',
        estadosValidos 
      });
    }
    
    const pedido = await Pedido.findByIdAndUpdate(
      req.params.id,
      { estado },
      { new: true }
    ).populate('productoId', 'nombre imagen');
    
    if (!pedido) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    
    res.json({
      message: 'Estado actualizado',
      pedido
    });
  } catch (error) {
    console.error('Error al actualizar pedido:', error);
    res.status(500).json({ 
      error: 'Error al actualizar pedido',
      message: error.message 
    });
  }
};

export const deletePedido = async (req, res) => {
  try {
    const pedido = await Pedido.findByIdAndDelete(req.params.id);
    
    if (!pedido) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    
    res.json({ 
      message: 'Pedido eliminado exitosamente',
      pedido 
    });
  } catch (error) {
    console.error('Error al eliminar pedido:', error);
    res.status(500).json({ 
      error: 'Error al eliminar pedido',
      message: error.message 
    });
  }
};