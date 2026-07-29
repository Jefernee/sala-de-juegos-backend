# 🔔 Notificaciones de fin de sesión por WhatsApp (WAHA)

Guía de mantenimiento del sistema que avisa por WhatsApp cuando se **agota el tiempo
de una sesión de juego** (un "play"). Pensada para el futuro: si algo deja de
funcionar o hay que darle mantenimiento, empezá por acá.

> **Nota de historia:** antes esto usaba **CallMeBot** (API gratuita). Se cambió a
> **WAHA** en julio 2026 porque CallMeBot mandaba tarde y a veces fallaba. Todo el
> legado de CallMeBot (colección `whatsapp_recipients`, su CRUD, la variable
> `CALLMEBOT_RECIPIENTS`) fue **eliminado**.

---

## ¿Qué hace y cómo?

Cuando se registra un play, se calcula `finProgramado` (el instante exacto en que se
acaba el tiempo pagado). Un chequeador busca los plays cuyo `finProgramado` ya pasó y
todavía no fueron avisados, y manda **un solo mensaje a un grupo de WhatsApp** con el
detalle de la partida (consola, cliente, hora de inicio/fin, duración, total, etc.).

El disparador es **el TIEMPO**, no el estado del pago (el estado del pago a veces
queda "En Proceso" aunque la sesión ya terminó → no es confiable para esto).

## Los dos motores (por qué hay dos)

| Motor | Dónde vive | Frecuencia | Rol |
|---|---|---|---|
| **Scheduled Trigger de MongoDB Atlas** | Panel de Atlas (App Services → Triggers). Código de referencia: `atlas/finSesionTrigger.js` | cada 1 min | **PRINCIPAL** — Atlas está siempre encendido |
| **Scheduler de Koyeb** | `utils/finSesionScheduler.js` (corre dentro del backend) | cada 30 s | **RESPALDO** |

Se usan **dos** porque Koyeb (plan gratis) **duerme** el contenedor cuando no hay
tráfico y tarda ~150 s en despertar, retrasando o perdiendo el aviso. Atlas nunca
duerme. Los dos "reclaman" cada play de forma **atómica** (marcan la bandera
`notificacionFinEnviada` en la misma operación con que lo leen), así que **nunca se
manda el aviso dos veces**, aunque los dos corran a la vez.

Ambos tienen una **ventana de catch-up de 2 horas**: si estuvieron caídos, al volver
mandan lo que se pasó en las últimas 2 h, pero no spamean sesiones viejas.

---

## WAHA (el "puente" a WhatsApp)

WAHA (WhatsApp HTTP API) corre en una **VM gratuita de Oracle Cloud** con el número de
la sala conectado como un WhatsApp **real**. Por eso puede mandar a un **grupo** de una
sola vez (CallMeBot no podía).

- **VM:** Oracle Always Free (Ubuntu). IP pública `157.151.183.29`, WAHA en el puerto `3000`.
- **Dashboard:** `http://157.151.183.29:3000/dashboard` (usuario/clave en tu nota privada, NO acá).
- **Engine:** NOWEB (liviano). `restart: always` + reinicio automático por cron a las 3:00 AM.
- **Sesión:** se llama `default`, número `50662010642` ("Sala de juegos Ruiz"), estado esperado **WORKING**.
- **Persistencia:** la sesión se guarda en `/opt/waha/sessions` → **no** hay que re-escanear el QR al reiniciar.
- **Grupo destino actual:** `120363403807399844@g.us` (grupo "Hogar 2").

### Cómo se manda un mensaje (contrato de la API)

```
POST {WAHA_URL}/api/sendText
Header: X-Api-Key: <API KEY de WAHA>
Body (JSON): { "session": "default", "chatId": "120363403807399844@g.us", "text": "..." }
```

### Cómo obtener el ID de un grupo (si cambia el grupo)

```bash
curl -H "X-Api-Key: <API KEY>" http://157.151.183.29:3000/api/default/groups
```
Buscá el grupo por su `subject` (nombre) y copiá su `id` (`...@g.us`). Ese valor va en
`WAHA_CHAT_ID`.

---

## Configuración (variables de entorno)

En el backend (local `.env` y en **Koyeb** → Environment):

| Variable | Ejemplo | Qué es |
|---|---|---|
| `NOTIFICACIONES_WHATSAPP_ENABLED` | `true` | Interruptor general (on/off) del scheduler de Koyeb. |
| `WAHA_URL` | `http://157.151.183.29:3000` | Base de la API de WAHA. |
| `WAHA_API_KEY` | *(secreto)* | La `X-Api-Key` de WAHA. **Nunca subir al repo.** |
| `WAHA_SESSION` | `default` | Nombre de la sesión de WhatsApp en WAHA. |
| `WAHA_CHAT_ID` | `120363403807399844@g.us` | ID del grupo destino. |

⚠️ **El trigger de Atlas es aparte.** Su código (`atlas/finSesionTrigger.js`) tiene la
config arriba del archivo. Antes de pegarlo en el panel de Atlas hay que **reemplazar el
placeholder `PEGA-AQUI-LA-API-KEY-DE-WAHA` por la key real** (o moverla a un Secret de
Atlas). El repo NO guarda la key por seguridad.

---

## Cómo probar

Manda un mensaje de prueba al grupo (funciona aunque el interruptor esté apagado):

```bash
node scripts/testNotificacionWhatsApp.js
node scripts/testNotificacionWhatsApp.js "Mensaje personalizado de prueba"
```
Requiere las variables `WAHA_*` en el `.env`. Si sale `✅ Enviado`, revisá el grupo.

---

## Qué pasa si el envío falla (reintentos)

Cada motor **reclama** la sesión marcando `notificacionFinEnviada = true` *antes* de mandar
el mensaje (así dos motores nunca mandan el mismo aviso). El problema de hacer solo eso es
que si el envío fallaba, la sesión quedaba marcada como avisada **sin que el mensaje
hubiera salido nunca** → el aviso se perdía en silencio. Por eso ahora:

- Si el envío falla y **sabemos que el mensaje no salió** (WAHA respondió un error, o no se
  pudo conectar), la bandera **vuelve a `false`** y el aviso se reintenta en el ciclo
  siguiente (1 min en Atlas, 30 s en Koyeb).
- Si el fallo es **ambiguo** (timeout: WAHA pudo haber entregado el mensaje y tardado en
  contestar), la bandera **se deja en `true`**. Preferimos perder un aviso antes que mandar
  un duplicado.
- Cada intento suma 1 a `intentosNotificacion` (campo del play). A los **5 intentos** se
  deja de reintentar y queda un log `❌ RENDIDO`. Editar la sesión con un fin a futuro
  reinicia el contador.
- Cuando un envío falla, el ciclo **se corta ahí** (no sigue con los demás pendientes): si
  WhatsApp está caído no tiene sentido golpear a WAHA con toda la cola.
- La ventana de catch-up de 2 h sigue siendo el límite real: si WhatsApp estuvo caído más de
  2 h, esas sesiones ya no se avisan (evita spam de avisos viejos).

En los logs de Atlas (App Services → Logs) buscá `🔁 REINTENTO`, `⚠️ AMBIGUO` y
`❌ RENDIDO` para ver si hubo problemas de entrega.

> ⚠️ Los reintentos sirven para un corte **corto**. Si la sesión de WhatsApp se cae del
> todo, ningún reintento la revive — de eso se encarga el watchdog (siguiente sección).

---

## 🐕 El watchdog de la sesión de WhatsApp

**El problema:** WAHA mantiene una conexión permanente contra WhatsApp. Si esa conexión se
corta y el reintento interno no logra reconectar, la sesión queda en **FAILED y ahí se
queda para siempre**: WAHA no la revive sola. El servidor sigue "vivo" (responde), pero
ningún mensaje sale. Pasó el **29-jul-2026** y estuvimos ~1 día sin avisos sin darnos
cuenta.

**La solución:** `scripts/waha-watchdog.sh`, un script que corre por **cron cada 5 minutos
en la VM de Oracle** (no en Koyeb: consulta WAHA por `127.0.0.1`).

| Estado de la sesión | Qué hace el watchdog |
|---|---|
| `WORKING` | Nada (y pone los contadores en cero si venía de fallar). |
| `STARTING` | Le da tiempo. Si se queda pegada **más de 7 min**, la trata como caída. |
| `SCAN_QR_CODE` | **No reinicia** — hace falta un humano con el teléfono. Solo avisa en el log. |
| `FAILED` / `STOPPED` / sin respuesta | Reinicia la sesión (`POST /api/sessions/default/restart`). |

Blindajes para no golpear a WhatsApp: mínimo **10 min entre reinicios**; tras **4 reinicios
seguidos** sin llegar a WORKING pasa a modo espaciado (1 por hora) y lo grita en el log
(casi seguro hace falta QR). El contador se pone en cero solo al volver a WORKING.

### Instalación en la VM (una sola vez)

```bash
sudo mkdir -p /opt/waha
sudo nano /opt/waha/watchdog.sh          # pegar scripts/waha-watchdog.sh
sudo chmod +x /opt/waha/watchdog.sh
# La API key va en un archivo aparte, NO dentro del script:
echo 'WAHA_API_KEY=la-key-real' | sudo tee /opt/waha/watchdog.env
sudo chmod 600 /opt/waha/watchdog.env
sudo crontab -e
# agregar esta línea:
*/5 * * * * /opt/waha/watchdog.sh >> /var/log/waha-watchdog.log 2>&1
```

### Probarlo / revisarlo

```bash
sudo /opt/waha/watchdog.sh ; echo "salida: $?"   # correrlo a mano
sudo tail -f /var/log/waha-watchdog.log          # ver qué viene haciendo
```

Con la sesión sana el log queda casi vacío (solo escribe cuando pasa algo). Si ves
`ATENCIÓN: la sesión pide ESCANEAR EL QR`, entrá al dashboard con el teléfono a mano.

---

## 📧 Y si igual algo falla, te llega un correo

Los reintentos y el watchdog cubren los problemas que se arreglan solos. Para los
que **no**, hay un tercer sistema: alertas por correo. Te escribe cuando un aviso se
pierde definitivamente, cuando la sesión de WhatsApp se cae o cuando hace falta
escanear el QR. Va por correo justamente porque WhatsApp es el canal que falla.

Se configura con `ALERTAS_EMAIL_ENABLED`, `RESEND_API_KEY` y `ALERTAS_EMAIL_TO`.
**Guía completa: [`ALERTAS_EMAIL.md`](ALERTAS_EMAIL.md)**.

Probalo con `node scripts/testAlertaEmail.js`.

---

## 🐛 Si dejan de llegar los avisos — qué revisar

1. **¿La sesión de WhatsApp está viva?** (es la causa nº 1)
   ```bash
   curl -H "X-Api-Key: <API KEY>" http://157.151.183.29:3000/api/sessions/default
   ```
   Tiene que decir estado **WORKING**. Si dice `FAILED`/`SCAN_QR_CODE`, hay que
   reconectar el WhatsApp (entrar al dashboard y escanear el QR de nuevo).
   Mirá también el log del watchdog (`sudo tail -50 /var/log/waha-watchdog.log`): te dice
   si ya intentó reiniciarla y con qué resultado.

2. **¿La VM de Oracle está encendida y WAHA corriendo?** (por SSH a la VM)
   ```bash
   cd /opt/waha && sudo docker compose ps      # estado
   cd /opt/waha && sudo docker compose logs -f  # logs en vivo
   cd /opt/waha && sudo docker compose restart   # reiniciar WAHA
   ```
   (La llave SSH está en tu carpeta privada de "Oracle Keys", no en el repo.)

3. **¿El grupo sigue existiendo y el número de la sala sigue en el grupo?**
   Si cambió el grupo, actualizá `WAHA_CHAT_ID` (ver "Cómo obtener el ID de un grupo").

4. **¿El interruptor y las variables están bien en Koyeb?** `NOTIFICACIONES_WHATSAPP_ENABLED=true`
   y las `WAHA_*` correctas. Después de cambiar variables en Koyeb, hay que redeploy.

5. **¿El trigger de Atlas quedó con la API key real?** Si copiaste el archivo del repo,
   recordá que trae un placeholder — hay que poner la key real en el panel.

6. **Prueba directa:** corré `node scripts/testNotificacionWhatsApp.js`. Si el mensaje de
   prueba llega pero los avisos automáticos no, el problema está en los motores
   (Atlas/Koyeb) o en `finProgramado`, no en WAHA.

7. **¿Los motores están corriendo?** Mirá en la base los plays del día: si tienen
   `notificacionFinEnviada: true`, los motores SÍ los están procesando y el corte está en
   WAHA/WhatsApp. Si están en `false` con `finProgramado` ya pasado, el que no corre es el
   trigger de Atlas (revisá en el panel que no esté **suspendido**).

8. **¿Cuántas veces falló?** El campo `intentosNotificacion` del play cuenta los intentos.
   Varios plays con `intentosNotificacion` en 5 = estuvo fallando el envío un buen rato.

---

## Archivos relacionados

- `utils/notificacionesWhatsApp.js` — arma el mensaje y lo manda a WAHA (timeout 10 s, 1 reintento, nunca rompe el flujo).
- `utils/finSesionScheduler.js` — chequeador de respaldo (Koyeb), cada 30 s.
- `atlas/finSesionTrigger.js` — código del motor principal, para pegar en el panel de Atlas.
- `scripts/testNotificacionWhatsApp.js` — prueba manual.
- `scripts/waha-watchdog.sh` — watchdog de la sesión de WhatsApp; va instalado en la VM de Oracle (cron cada 5 min), no en Koyeb.
- `utils/alertasEmail.js` + [`ALERTAS_EMAIL.md`](ALERTAS_EMAIL.md) — las alertas por correo cuando todo lo anterior no alcanza.
