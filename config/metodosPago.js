// config/metodosPago.js
// Cómo se cobró una venta.
//
// Dos formas, que es lo que se usa en la sala:
//   • efectivo → el cliente paga con billetes y puede haber vuelto.
//   • sinpe    → transferencia por SINPE Móvil: el monto pagado siempre es
//                exacto (igual al total) y el vuelto es 0.
//
// Las ventas registradas ANTES de que existiera este campo no lo tienen y
// todas fueron en efectivo, así que ese es el valor por defecto: deja el
// histórico bien clasificado en vez de dejarlo en nulo. Lo mismo aplica a un
// frontend viejo que todavía no mande el campo.
export const METODO_EFECTIVO = 'efectivo';
export const METODO_SINPE = 'sinpe';

export const METODOS_PAGO = [METODO_EFECTIVO, METODO_SINPE];

// Normaliza y valida lo que llegue del frontend.
// Devuelve { ok: true, valor } con el método ya limpio (minúscula, sin
// espacios), o { ok: false, error } con el mensaje listo para el 400.
// Si no viene nada, cae en efectivo (compatibilidad con versiones viejas del
// frontend que puedan estar en caché en algún celular).
export const validarMetodoPago = (valor) => {
  if (valor === undefined || valor === null || valor === '') {
    return { ok: true, valor: METODO_EFECTIVO };
  }
  const limpio = String(valor).trim().toLowerCase();
  if (!METODOS_PAGO.includes(limpio)) {
    return {
      ok: false,
      error: `Método de pago "${valor}" no es válido. Opciones: ${METODOS_PAGO.join(', ')}.`,
    };
  }
  return { ok: true, valor: limpio };
};
