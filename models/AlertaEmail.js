import mongoose from 'mongoose';

// ─────────────────────────────────────────────────────────────────────────────
// Control de enfriamiento (cooldown) de las alertas por correo.
//
// EL PROBLEMA: cuando WhatsApp se cae, TODAS las sesiones del día empiezan a
// fallar. Sin freno recibirías un correo por cada una, y encima duplicados,
// porque el motor de Atlas y el de Koyeb fallan los dos por separado.
//
// LA SOLUCIÓN: cada tipo de alerta tiene una `clave`. Antes de mandar un correo
// se "reclama" la clave de forma ATÓMICA contra esta colección: solo pasa si el
// último correo de esa clave fue hace más del enfriamiento pedido. Como los dos
// motores usan la MISMA base, el freno vale para los dos a la vez.
//
// El trigger de Atlas usa esta misma colección a mano (no tiene mongoose), así
// que el nombre y los campos NO se pueden cambiar sin actualizar también
// atlas/finSesionTrigger.js.
// ─────────────────────────────────────────────────────────────────────────────

const alertaEmailSchema = new mongoose.Schema(
  {
    // Identifica el TIPO de alerta, no el hecho puntual. Ej: 'whatsapp-aviso-fallido'.
    clave: {
      type: String,
      required: true,
      unique: true,
    },
    // Cuándo salió el último correo de esta clave. Es el campo que se compara
    // contra el enfriamiento.
    ultimoEnvio: {
      type: Date,
      required: true,
    },
    // Cuántos correos de esta clave se mandaron en total (histórico).
    veces: {
      type: Number,
      default: 0,
    },
    // Cuántas alertas de esta clave se callaron desde el último correo. Se
    // informa en el siguiente correo ("y otras N iguales") y vuelve a cero.
    suprimidas: {
      type: Number,
      default: 0,
    },
    // Resumen de la última alerta, para poder mirar en la base qué pasó.
    ultimoDetalle: {
      type: String,
      default: '',
    },
  },
  { timestamps: true, collection: 'alertas_email' }
);

export default mongoose.model('AlertaEmail', alertaEmailSchema);
