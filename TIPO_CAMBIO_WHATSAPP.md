# 💵 Tipo de cambio del dólar por WhatsApp (7:00 AM)

Todos los días a las **7:00 de la mañana** llega un WhatsApp al número personal
del administrador con el **precio de compra y de venta** del dólar del día.

Ejemplo del mensaje:

```
💵 *Tipo de cambio del dólar*
📅 miércoles 29 de julio del 2026

🟢 Compra: ₡449.94
🔴 Venta: ₡454.55

📊 *Comparado con ayer:*
📈 Compra: subió ₡2.20
📈 Venta: subió ₡2.55

_Compra: lo que te dan por cada $1._
_Venta: lo que te cuesta cada $1._

Fuente: Ministerio de Hacienda
```

---

## Cómo está armado

| Pieza | Dónde |
|---|---|
| **El motor** | Scheduled Trigger de MongoDB Atlas. Código: `atlas/tipoCambioTrigger.js` |
| **El envío** | WAHA, el mismo WhatsApp de la sala que manda los avisos de fin de sesión |
| **El destino** | `50686825481@c.us` — el número **personal**, no el grupo |
| **El dato** | API del Ministerio de Hacienda, con `tipodecambio.paginasweb.cr` de respaldo |
| **El historial** | Colección `tipo_cambio_historial` en Mongo (un registro por día) |

**Por qué en Atlas y no en el backend:** Koyeb (plan gratis) duerme el contenedor
cuando no hay tráfico, y a las 7 AM está dormido con toda seguridad — un
temporizador dentro del backend simplemente no se ejecutaría. Atlas nunca duerme.
Es el mismo motivo por el que los avisos de fin de sesión viven ahí.

**Por qué al número y no al grupo:** el tipo de cambio es información personal
del administrador; al grupo de la sala no le sirve. En WAHA un chat individual se
escribe `<código de país><número>@c.us`, sin `+`, espacios ni guiones.

**Por qué dos fuentes:** son servicios públicos gratuitos y de vez en cuando se
caen. Si la primera falla se usa la segunda. Además se validan los valores: si
llega algo absurdo (cero, negativo o mayor a ₡5.000) se descarta esa fuente en
vez de mandar un número inventado. Si **las dos** fallan, igual llega un mensaje
diciendo que hoy no se pudo consultar — es preferible saberlo a quedarse
esperando un mensaje que nunca llega.

**La comparación con ayer** sale del historial que el propio trigger va
guardando. El primer día no aparece (todavía no hay con qué comparar).

**Compra y venta se comparan por separado**, cada una en su línea. No se mueven
igual (cada una lleva su propio margen), así que un solo "subió ₡2.55" escondía
lo que había hecho la otra — que podía incluso haber bajado ese mismo día. Si
ninguna de las dos se movió, sale una sola línea: `➖ Sin cambios desde ayer.`

---

## Instalación en Atlas (una sola vez)

1. Entrá a **MongoDB Atlas → App Services → Triggers → Add a Trigger**.
2. Configuralo así:
   - **Trigger Type:** `Scheduled`
   - **Name:** `tipoCambioDiario`
   - **Schedule Type:** `Advanced` (cron)
   - **Cron expression:** `0 13 * * *`
   - **Function:** pegá el contenido de `atlas/tipoCambioTrigger.js`
   - **Authentication:** `System`
3. ⚠️ Antes de guardar, reemplazá `PEGA-AQUI-LA-API-KEY-DE-WAHA` por la key real
   (la misma que usa el trigger de fin de sesión). **El repo no la guarda.**
4. **Save** y **Deploy**.

### Sobre el cron: `0 13 * * *`

Atlas interpreta el cron **siempre en UTC**. Costa Rica es **UTC-6 todo el año**
(no hay horario de verano), así que 13:00 UTC = 7:00 AM en Costa Rica, y esa
cuenta no se desfasa nunca.

Si algún día querés cambiar la hora, sumale 6 a la hora de Costa Rica:

| Hora que querés (CR) | Cron |
|---|---|
| 6:00 AM | `0 12 * * *` |
| **7:00 AM** | **`0 13 * * *`** |
| 8:00 AM | `0 14 * * *` |
| 12:00 md | `0 18 * * *` |

---

## Cómo probarlo sin esperar a mañana

En el panel de Atlas, en la función del trigger, hay un botón **Run** que la
ejecuta al instante. El WhatsApp debería llegar en segundos.

Para ver qué pasó: **App Services → Logs**, filtrando por el nombre del trigger.
Ahí queda el mensaje completo que se mandó (o el error).

---

## 🐛 Si deja de llegar

1. **¿Llegan los avisos de fin de sesión?** Si tampoco llegan, el problema es
   WAHA/WhatsApp, no este trigger → andá a
   [`NOTIFICACIONES_WHATSAPP.md`](NOTIFICACIONES_WHATSAPP.md).
2. **¿El trigger está suspendido?** Atlas suspende los triggers que fallan varias
   veces seguidas. Se ve (y se reactiva) en el panel de Triggers.
3. **¿La API key sigue siendo la correcta?** Si la cambiaste en WAHA, hay que
   actualizarla en **los dos** triggers de Atlas, no solo en uno.
4. **¿El número sigue bien?** `DESTINO` tiene que ser
   `<código de país><número>@c.us`, sin `+` ni espacios. Y ese número tiene que
   tener WhatsApp activo.
5. **¿Las fuentes de datos responden?** Probalas a mano:
   ```bash
   curl https://api.hacienda.go.cr/indicadores/tc/dolar
   curl https://tipodecambio.paginasweb.cr/api
   ```
6. **Historial:** `db.tipo_cambio_historial.find().sort({dia:-1}).limit(7)` te
   muestra los últimos días. Si hay registros pero no llegó el WhatsApp, el dato
   se obtuvo bien y lo que falló fue el envío.

---

## Archivos relacionados

- `atlas/tipoCambioTrigger.js` — el trigger (se pega en el panel de Atlas).
- [`NOTIFICACIONES_WHATSAPP.md`](NOTIFICACIONES_WHATSAPP.md) — WAHA, la sesión de WhatsApp y su mantenimiento.
- `controllers/finanzasPersonalesController.js` — usa la misma API de Hacienda para el tipo de cambio dentro de la app (`GET /api/finanzas-personales/tipo-cambio`).
