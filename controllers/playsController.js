// controllers/playsController.js
import Play from '../models/plays.js';

// Función helper para calcular costos
const calcularCostos = (lugarDeJuego, tiempoPagado, controlAdicional) => {
  let precioPorHora = 0;
  
  if (lugarDeJuego.includes('Play 5')) {
    precioPorHora = 1000;
  } else if (lugarDeJuego.includes('Play 4')) {
    precioPorHora = 800;
  } else if (lugarDeJuego === 'Ping Pong') {
    precioPorHora = 800;
  }
  
  const subtotal = (tiempoPagado / 60) * precioPorHora;
  const costoControles = controlAdicional * 200;
  const total = subtotal + costoControles;
  
  return {
    subtotal: Math.round(subtotal),
    costoControles,
    total: Math.round(total)
  };
};

// Función helper para determinar tipo de play
const determinarTipoPlay = (lugarDeJuego) => {
  if (lugarDeJuego.includes('Play 5')) return 'Play 5';
  if (lugarDeJuego.includes('Play 4')) return 'Play 4';
  if (lugarDeJuego === 'Ping Pong') return 'Ping Pong';
  return '';
};

// GET - Obtener todos los plays CON PAGINACIÓN
export const getAllPlays = async (req, res) => {
  try {
    // Obtener parámetros de paginación de la query
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const skip = (page - 1) * limit;

    // Obtener el total de documentos
    const total = await Play.countDocuments();
    
    // Obtener los plays paginados (ÚLTIMOS PRIMERO)
    const plays = await Play.find()
      .sort({ fecha: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Calcular información de paginación
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.status(200).json({
      success: true,
      data: plays,
      pagination: {
        total,
        count: plays.length,
        page,
        limit,
        totalPages,
        hasNextPage,
        hasPrevPage
      }
    });
  } catch (error) {
    console.error('❌ Error en getAllPlays:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener los plays',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// GET - Obtener un play por ID
export const getPlayById = async (req, res) => {
  try {
    const play = await Play.findById(req.params.id);
    
    if (!play) {
      return res.status(404).json({
        success: false,
        message: 'Play no encontrado'
      });
    }
    
    res.status(200).json({
      success: true,
      data: play
    });
  } catch (error) {
    console.error('❌ Error en getPlayById:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener el play',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// POST - Crear un nuevo play
export const createPlay = async (req, res) => {
  try {
    console.log('📝 Datos recibidos para crear play:', req.body);
    
    // ✅ Determinar tipo de play automáticamente
    const tipoPlay = determinarTipoPlay(req.body.lugarDeJuego);
    
    // ✅ Calcular costos automáticamente
    const costos = calcularCostos(
      req.body.lugarDeJuego,
      req.body.tiempoPagado,
      req.body.controlAdicional || 0
    );
    
    // ✅ Calcular totales por tipo automáticamente
    const totalPlay4 = tipoPlay === 'Play 4' ? costos.total : 0;
    const totalPlay5 = tipoPlay === 'Play 5' ? costos.total : 0;
    const totalPingPong = tipoPlay === 'Ping Pong' ? costos.total : 0;
    
    const play = new Play({
      fecha: req.body.fecha,
      cliente: req.body.cliente,
      atendio: req.body.atendio,
      tiempoPagado: req.body.tiempoPagado,
      tiempoPendiente: req.body.tiempoPendiente || 0,
      horaInicio: req.body.horaInicio,
      horaFinal: req.body.horaFinal,
      lugarDeJuego: req.body.lugarDeJuego,
      tipoPlay: tipoPlay,
      juegosJugados: req.body.juegosJugados || [],
      controlAdicional: req.body.controlAdicional || 0,
      subtotal: costos.subtotal,
      costoControles: costos.costoControles,
      total: costos.total,
      totalPlay4: totalPlay4,
      totalPlay5: totalPlay5,
      totalPingPong: totalPingPong,
      estadoPago: req.body.estadoPago || 'En Proceso'
    });

    const nuevoPlay = await play.save();
    console.log('✅ Play creado exitosamente:', nuevoPlay._id);
    
    res.status(201).json({
      success: true,
      message: 'Play creado exitosamente',
      data: nuevoPlay
    });
  } catch (error) {
    console.error('❌ Error en createPlay:', error);
    console.error('📦 Body recibido:', req.body);
    
    res.status(400).json({
      success: false,
      message: 'Error al crear el play',
      error: error.message,
      errors: error.errors,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      receivedData: process.env.NODE_ENV === 'development' ? req.body : undefined
    });
  }
};

// PUT - Actualizar un play
export const updatePlay = async (req, res) => {
  try {
    console.log(`📝 Actualizando play ${req.params.id} con:`, req.body);
    
    const play = await Play.findById(req.params.id);
    
    if (!play) {
      return res.status(404).json({
        success: false,
        message: 'Play no encontrado'
      });
    }

    // Actualizar campos básicos
    if (req.body.fecha !== undefined) play.fecha = req.body.fecha;
    if (req.body.cliente !== undefined) play.cliente = req.body.cliente;
    if (req.body.atendio !== undefined) play.atendio = req.body.atendio;
    if (req.body.tiempoPagado !== undefined) play.tiempoPagado = req.body.tiempoPagado;
    if (req.body.tiempoPendiente !== undefined) play.tiempoPendiente = req.body.tiempoPendiente;
    if (req.body.horaInicio !== undefined) play.horaInicio = req.body.horaInicio;
    if (req.body.horaFinal !== undefined) play.horaFinal = req.body.horaFinal;
    if (req.body.lugarDeJuego !== undefined) play.lugarDeJuego = req.body.lugarDeJuego;
    if (req.body.juegosJugados !== undefined) play.juegosJugados = req.body.juegosJugados;
    if (req.body.controlAdicional !== undefined) play.controlAdicional = req.body.controlAdicional;
    if (req.body.estadoPago !== undefined) play.estadoPago = req.body.estadoPago;

    // ✅ Recalcular TODO automáticamente en el backend
    play.tipoPlay = determinarTipoPlay(play.lugarDeJuego);
    
    const costos = calcularCostos(
      play.lugarDeJuego,
      play.tiempoPagado,
      play.controlAdicional
    );
    
    play.subtotal = costos.subtotal;
    play.costoControles = costos.costoControles;
    play.total = costos.total;
    
    // ✅ Recalcular totales por tipo
    play.totalPlay4 = play.tipoPlay === 'Play 4' ? costos.total : 0;
    play.totalPlay5 = play.tipoPlay === 'Play 5' ? costos.total : 0;
    play.totalPingPong = play.tipoPlay === 'Ping Pong' ? costos.total : 0;

    const playActualizado = await play.save();
    console.log('✅ Play actualizado exitosamente:', playActualizado._id);
    
    res.status(200).json({
      success: true,
      message: 'Play actualizado exitosamente',
      data: playActualizado
    });
  } catch (error) {
    console.error('❌ Error en updatePlay:', error);
    console.error('📦 Body recibido:', req.body);
    
    res.status(400).json({
      success: false,
      message: 'Error al actualizar el play',
      error: error.message,
      errors: error.errors,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      receivedData: process.env.NODE_ENV === 'development' ? req.body : undefined
    });
  }
};

// DELETE - Eliminar un play
export const deletePlay = async (req, res) => {
  try {
    console.log(`🗑️ Eliminando play: ${req.params.id}`);
    
    const play = await Play.findById(req.params.id);
    
    if (!play) {
      return res.status(404).json({
        success: false,
        message: 'Play no encontrado'
      });
    }

    await play.deleteOne();
    console.log('✅ Play eliminado exitosamente');
    
    res.status(200).json({
      success: true,
      message: 'Play eliminado exitosamente',
      data: {}
    });
  } catch (error) {
    console.error('❌ Error en deletePlay:', error);
    
    res.status(500).json({
      success: false,
      message: 'Error al eliminar el play',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};