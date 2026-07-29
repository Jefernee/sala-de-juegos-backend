# 📧 Alertas por correo (Resend)

Guía del sistema que **te escribe un correo cuando algo se rompe**, para no
depender de que alguien mire los logs.

> **Por qué existe:** el 29-jul-2026 la sesión de WhatsApp en WAHA se cayó y
> estuvimos casi un día sin avisos de fin de sesión sin darnos cuenta. Todo
> estaba en los logs, pero nadie mira los logs. Y no se podía avisar por
> WhatsApp… porque WhatsApp era justamente lo que estaba caído. De ahí el
> correo: un canal **independiente** del que falla.

---

## Qué te avisa (y desde dónde)

| Alerta | La manda | Cuándo |
|---|---|---|
| **No salió un aviso de fin de sesión** | Backend (Koyeb) y trigger de Atlas | Cuando un aviso agota sus 5 intentos y se pierde definitivamente |
| **WhatsApp desconectado / hay que escanear el QR** | Watchdog en la VM | Estado `SCAN_QR_CODE`: reiniciar no lo arregla, tenés que ir con el teléfono |
| **WhatsApp se cayó y lo estoy reiniciando** | Watchdog en la VM | A partir del **2º** reinicio seguido (el primero no avisa: una reconexión suelta se arregla sola) |
| **WAHA no responde ni para reiniciar** | Watchdog en la VM | El contenedor de WAHA o la VM están caídos |
| **✅ Volvió a funcionar** | Watchdog en la VM | La sesión llegó a `WORKING` después de haber fallado |
| **Error grave del backend** | Backend (Koyeb) | Cualquier respuesta 5xx, promesa rechazada sin manejar o excepción no controlada |

> **Cómo se detectan los 500:** vigilando la **respuesta**, no el error. El middleware
> global de errores solo ve lo que se propaga con `next(err)`, pero los controladores de
> este proyecto atrapan sus errores y responden `res.status(500).json(...)` ellos mismos
> (92 lugares). Si solo miráramos el middleware, la mayoría de los 500 pasarían sin avisar.
> Por eso `server.js` envuelve `res.json` y alerta cuando el código es ≥ 500. Cuando el
> error **sí** llega al middleware, éste marca `res.locals.yaAlertado` para que no salgan
> dos correos por el mismo fallo (gana la alerta del middleware, que incluye el stack).

Los errores de **cliente** (payload muy grande, validación, CORS) **no** mandan
correo: son normales, los provoca el navegador y solo harían ruido.

---

## Por qué Resend y no un correo normal

El aviso tiene que poder salir desde **tres lugares distintos**, y dos de ellos
no pueden usar librerías de Node:

- **Backend en Koyeb** → podría usar cualquier cosa, pero **se duerme**.
- **Trigger de MongoDB Atlas** → solo puede hacer llamadas HTTP (no hay `npm`).
- **Watchdog en la VM** → es un script de bash, solo tiene `curl`.

Una **API HTTP** es lo único que sirve en los tres. El contrato es el mismo en
todos lados:

```
POST https://api.resend.com/emails
Header: Authorization: Bearer {RESEND_API_KEY}
Body (JSON): { "from": "...", "to": ["..."], "subject": "...", "text": "..." }
```

**Plan gratuito:** 3.000 correos por mes / 100 por día. Muy por encima de lo que
vamos a usar.

**Sobre el remitente:** con `onboarding@resend.dev` (el dominio de pruebas de
Resend) **solo se le puede escribir a la cuenta dueña de la API key**, que es
justo lo que queremos. Si algún día hiciera falta mandarle a otra persona, hay
que verificar un dominio propio en Resend y cambiar `ALERTAS_EMAIL_FROM`.

---

## Configuración

### 1. Sacar la API key (una sola vez)

1. Entrá a <https://resend.com> y registrate **con el mismo correo que va a
   recibir las alertas**. Esto importa: sin dominio propio, Resend solo deja
   escribirle a esa dirección.
2. Menú **API Keys** → **Create API Key** → permiso *Sending access*.
3. Copiá la key (empieza con `re_`). **Solo se muestra una vez.**

### 2. Backend (`.env` local y Koyeb → Environment)

| Variable | Ejemplo | Qué es |
|---|---|---|
| `ALERTAS_EMAIL_ENABLED` | `true` | Interruptor general. Cualquier valor distinto de `true` las apaga. |
| `RESEND_API_KEY` | *(secreto)* | La key de Resend. **Nunca subir al repo.** |
| `ALERTAS_EMAIL_TO` | `jefernee50@gmail.com` | A quién le llegan. |
| `ALERTAS_EMAIL_FROM` | `Sala de Juegos <onboarding@resend.dev>` | Remitente. |

Después de cambiar variables en Koyeb hay que hacer **redeploy**.

### 3. Trigger de Atlas

Su código (`atlas/finSesionTrigger.js`) tiene la config arriba del archivo.
Antes de pegarlo en el panel hay que reemplazar **dos** placeholders:
`PEGA-AQUI-LA-API-KEY-DE-WAHA` y `PEGA-AQUI-LA-API-KEY-DE-RESEND`.
Si dejás la de Resend con el placeholder, el trigger funciona igual pero no
manda correos (lo deja anotado en el log).

### 4. Watchdog en la VM

Las keys van en `/opt/waha/watchdog.env`, **nunca dentro del script**:

```bash
sudo tee /opt/waha/watchdog.env >/dev/null <<'FIN'
WAHA_API_KEY=la-key-real-de-waha
RESEND_API_KEY=re_la-key-real-de-resend
ALERTAS_EMAIL_TO=jefernee50@gmail.com
FIN
sudo chmod 600 /opt/waha/watchdog.env
```

Si no ponés `RESEND_API_KEY`, el watchdog sigue reiniciando la sesión igual,
solo que en silencio.

---

## Cómo probar

```bash
node scripts/testAlertaEmail.js
node scripts/testAlertaEmail.js "Asunto personalizado"
```

Funciona aunque `ALERTAS_EMAIL_ENABLED` esté en `false` (lo fuerza) y **no**
pasa por el enfriamiento. La primera vez revisá la carpeta de **spam** y marcá
el remitente como confiable.

Para probar el correo del watchdog, en la VM:

```bash
sudo /opt/waha/watchdog.sh ; echo "salida: $?"
sudo tail -f /var/log/waha-watchdog.log
```

---

## El enfriamiento (por qué no te llegan 100 correos)

Cuando WhatsApp se cae, **todas** las sesiones del día empiezan a fallar. Sin
freno recibirías un correo por cada una, y encima duplicados, porque Atlas y
Koyeb fallan cada uno por su lado.

Por eso cada tipo de alerta tiene una **clave** y un tiempo mínimo entre correos:

| Clave | Enfriamiento | Dónde se guarda |
|---|---|---|
| `whatsapp-aviso-fallido` | 2 horas | Colección `alertas_email` en Mongo |
| `backend-error:<TipoDeError>` | 30 minutos | Colección `alertas_email` en Mongo |
| `backend-500:<MÉTODO /ruta>` | 30 minutos | Colección `alertas_email` en Mongo |
| Avisos del watchdog | 1 hora **por tipo** | `/var/tmp/waha-watchdog.correo` en la VM |

Detalles que importan:

- El freno del backend y el de Atlas **se comparten**, porque los dos usan la
  misma colección y la misma clave. Es la misma idea que la bandera
  `notificacionFinEnviada`: quien llega primero reclama, el otro se calla.
- Los errores del backend usan **una clave por tipo de error**. Así, si un error
  nuevo aparece mientras otro está en enfriamiento, el nuevo **sí** te llega.
- En los 5xx la clave es la **ruta con los ids reemplazados**: `/api/plays/68f2…` y
  `/api/plays/71a9…` cuentan como el mismo problema (`GET /api/plays/:id`). Si no,
  un endpoint roto mandaría un correo por cada cliente que lo tocara.
- Las alertas que se callan se cuentan. El siguiente correo te dice
  *"además hubo N alertas iguales que no se enviaron"*: es la diferencia entre
  "falló una vez" y "está fallando todo".
- El watchdog respeta el enfriamiento **por tipo**, pero si el tipo **cambia**
  (venía reiniciando y ahora pide QR) el correo sale igual: es información nueva.

### ⚠️ El índice único (esto hay que hacerlo una vez)

Todo el freno se apoya en un **índice único sobre `clave`**: el reclamo funciona
porque, si el documento ya existe y está en enfriamiento, el `upsert` choca
contra el índice y ahí sabemos que hay que callarse. **Sin ese índice se
insertarían documentos duplicados y saldría un correo por cada alerta.**

El backend lo crea solo al arrancar (mongoose lo construye al conectar). Pero el
trigger de Atlas puede correr **antes** de que el backend arranque, así que
conviene crearlo a mano una vez desde Atlas (Browse Collections → shell) o desde
Compass:

```js
db.alertas_email.createIndex({ clave: 1 }, { unique: true })
```

Es idempotente: si ya existe, no hace nada.

Para verificar que está:

```js
db.alertas_email.getIndexes()   // tiene que aparecer uno con "unique": true sobre clave
```

Para mirar el estado del freno en la base:

```js
db.alertas_email.find().pretty()
// clave, ultimoEnvio, veces (total histórico), suprimidas (calladas desde el último)
```

Borrar un documento de esa colección **resetea** el enfriamiento de esa clave
(útil para probar sin esperar 2 horas).

---

## 🐛 Si no llegan las alertas

1. **¿El interruptor está prendido?** `ALERTAS_EMAIL_ENABLED=true` en Koyeb (y
   redeploy después de cambiarlo).
2. **Prueba directa:** `node scripts/testAlertaEmail.js`. Si esta falla, el
   problema es la configuración (key o destinatario), no las alertas.
3. **¿Spam?** La primera vez casi siempre cae ahí.
4. **¿Estará en enfriamiento?** Mirá `db.alertas_email.find()`: si `suprimidas`
   está subiendo, el sistema **sí** está detectando el problema y se está
   callando a propósito.
5. **¿La key sigue viva?** En el panel de Resend, sección **Logs**, se ve cada
   correo que aceptaron y su estado de entrega.
6. **¿Se pasó el límite?** 100 correos por día en el plan gratis. Si llegaste
   ahí, algo está fallando muchísimo (o el enfriamiento no está funcionando).

---

## Archivos relacionados

- `utils/alertasEmail.js` — el módulo: envío, enfriamiento y los textos de cada alerta.
- `models/AlertaEmail.js` — colección `alertas_email`, la que hace de freno compartido.
- `scripts/testAlertaEmail.js` — prueba manual.
- `scripts/waha-watchdog.sh` — alertas de la sesión de WhatsApp (vive en la VM).
- `atlas/finSesionTrigger.js` — alerta del motor principal (se pega en el panel de Atlas).
- `server.js` — engancha los errores 500 y las excepciones no controladas.
- [`NOTIFICACIONES_WHATSAPP.md`](NOTIFICACIONES_WHATSAPP.md) — el sistema que estas alertas vigilan.
