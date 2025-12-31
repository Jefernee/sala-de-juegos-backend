import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

console.log("Conectando a MongoDB...");
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("Conectado correctamente!"))
  .catch(err => console.error("ERROR CONEXIÓN:", err));
