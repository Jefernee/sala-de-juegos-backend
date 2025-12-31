import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const inventarioSchema = new mongoose.Schema({
  nombre: String,
  cantidad: Number,
  precioCompra: Number,
  precioVenta: Number,
  fechaCompra: Date,
});

const Inventario = mongoose.model("Inventario", inventarioSchema);

const test = async () => {
  try {
    console.log("Conectando a MongoDB...");
    await mongoose.connect(process.env.MONGO_URI); // <--- sin opciones
    console.log("Conectado correctamente!");

    const producto = new Inventario({
      nombre: "Test Producto",
      cantidad: 1,
      precioCompra: 10,
      precioVenta: 15,
      fechaCompra: new Date(),
    });

    await producto.save();
    console.log("Documento guardado correctamente:", producto);
    mongoose.connection.close();
  } catch (err) {
    console.error("ERROR CONEXIÓN/INSERT:", err);
  }
};

test();
