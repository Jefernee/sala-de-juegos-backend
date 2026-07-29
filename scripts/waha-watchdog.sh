#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Vigilante (watchdog) de la sesión de WhatsApp en WAHA.
#
# EL PROBLEMA QUE RESUELVE:
#   WAHA mantiene una conexión permanente contra los servidores de WhatsApp. Si
#   esa conexión se corta y el reintento interno no logra reconectar, la sesión
#   queda en estado FAILED y AHÍ SE QUEDA PARA SIEMPRE: WAHA no la revive sola.
#   Resultado: el servidor sigue "vivo" (responde /ping) pero ningún mensaje sale.
#   Pasó en producción el 29-jul-2026 y estuvimos ~1 día sin avisos de fin de
#   sesión sin darnos cuenta.
#
# QUÉ HACE:
#   Cada vez que corre (por cron, cada 5 min) consulta el estado de la sesión:
#     WORKING       → todo bien, no hace nada.
#     STARTING      → está conectando: se le da tiempo, PERO si se queda pegada
#                     más de STARTING_MAX_SEG se trata como caída y se reinicia.
#                     (Una sesión atascada en STARTING para siempre es un caso
#                     real que vimos en prod: parece que está trabajando y no.)
#     SCAN_QR_CODE  → necesita que un HUMANO escanee el QR; reiniciar no ayuda.
#     FAILED/STOPPED/sin respuesta → reinicia la sesión.
#
#   Además AVISA POR CORREO (vía Resend) cuando pasa algo que hay que saber:
#   que reinició la sesión, que hace falta escanear el QR, o que lleva varios
#   reinicios sin lograrlo. Los logs de acá no los mira nadie; el correo sí.
#
# BLINDAJES (importantes: no queremos golpear a WhatsApp):
#   - Espera COOLDOWN_SEG entre reinicios, aunque el cron corra más seguido.
#   - Tras MAX_REINTENTOS reinicios seguidos sin llegar a WORKING, pasa a modo
#     "espaciado" (BACKOFF_SEG) y lo grita en el log: casi seguro hace falta QR.
#   - El contador se pone en cero solo, en cuanto la sesión vuelve a WORKING.
#   - Los correos también tienen enfriamiento (EMAIL_COOLDOWN_SEG) por TIPO de
#     aviso, así una caída larga no te llena la bandeja. Si cambia el tipo (por
#     ejemplo pasa de "reinicié" a "hace falta QR"), el correo sale igual.
#
# INSTALACIÓN (en la VM de Oracle, una sola vez):
#   sudo mkdir -p /opt/waha
#   sudo nano /opt/waha/watchdog.sh          # pegar este archivo
#   sudo chmod +x /opt/waha/watchdog.sh
#   # Los secretos van en un archivo aparte, NO dentro del script:
#   sudo tee /opt/waha/watchdog.env >/dev/null <<'FIN'
#   WAHA_API_KEY=la-key-real-de-waha
#   RESEND_API_KEY=re_la-key-real-de-resend
#   ALERTAS_EMAIL_TO=jefernee50@gmail.com
#   FIN
#   sudo chmod 600 /opt/waha/watchdog.env
#   # Cron cada 5 minutos:
#   sudo crontab -e
#   */5 * * * * /opt/waha/watchdog.sh >> /var/log/waha-watchdog.log 2>&1
#
#   (Si no ponés RESEND_API_KEY el watchdog funciona igual, solo que sin correo.)
#
# PROBARLO A MANO:
#   sudo /opt/waha/watchdog.sh ; echo "salida: $?"
#   sudo tail -f /var/log/waha-watchdog.log
# ─────────────────────────────────────────────────────────────────────────────

set -uo pipefail

# ── Configuración ────────────────────────────────────────────────────────────
WAHA_URL="${WAHA_URL:-http://127.0.0.1:3000}"   # local: no sale a internet y vuelve
WAHA_SESSION="${WAHA_SESSION:-default}"
# Rutas por defecto (se pueden sobreescribir por entorno para poder probar).
ENV_FILE="${WATCHDOG_ENV_FILE:-/opt/waha/watchdog.env}"          # de acá salen las API keys
ESTADO_FILE="${WATCHDOG_ESTADO_FILE:-/var/tmp/waha-watchdog.estado}"
CORREO_FILE="${WATCHDOG_CORREO_FILE:-/var/tmp/waha-watchdog.correo}"

COOLDOWN_SEG=600      # 10 min mínimo entre reinicios
MAX_REINTENTOS=4      # tras 4 reinicios seguidos sin éxito → modo espaciado
BACKOFF_SEG=3600      # en modo espaciado, 1 reinicio por hora
STARTING_MAX_SEG=420  # 7 min en STARTING = atascada (lo normal son segundos)
CURL_TIMEOUT=15

# Alertas por correo (Resend). Si no hay RESEND_API_KEY, el watchdog funciona
# igual pero en silencio.
EMAIL_COOLDOWN_SEG=3600   # 1 h entre correos DEL MISMO TIPO
ALERTAS_EMAIL_FROM="${ALERTAS_EMAIL_FROM:-Sala de Juegos <onboarding@resend.dev>}"
# ─────────────────────────────────────────────────────────────────────────────

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# La key vive fuera del script (el repo es público).
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi
if [ -z "${WAHA_API_KEY:-}" ]; then
  log "ERROR: no hay WAHA_API_KEY (esperada en $ENV_FILE). Nada que hacer."
  exit 1
fi

# ── Estado persistido ────────────────────────────────────────────────────────
# Formato: "<epoch_ultimo_reinicio> <fallos_seguidos> <epoch_primer_starting>"
ULTIMO_REINICIO=0
FALLOS=0
PRIMER_STARTING=0
if [ -f "$ESTADO_FILE" ]; then
  read -r ULTIMO_REINICIO FALLOS PRIMER_STARTING < "$ESTADO_FILE" 2>/dev/null || true
  # Si el archivo viene corrupto o de una versión vieja, arrancamos de cero.
  case "$ULTIMO_REINICIO"  in (*[!0-9]*|'') ULTIMO_REINICIO=0 ;; esac
  case "$FALLOS"           in (*[!0-9]*|'') FALLOS=0 ;; esac
  case "$PRIMER_STARTING"  in (*[!0-9]*|'') PRIMER_STARTING=0 ;; esac
fi

guardar_estado() { echo "$1 $2 $3" > "$ESTADO_FILE"; }

# ── Aviso por correo (Resend) ────────────────────────────────────────────────
# avisar_por_correo <tipo> <asunto> <cuerpo>
#
# El <tipo> agrupa el enfriamiento: no se repite el mismo tipo de aviso antes de
# EMAIL_COOLDOWN_SEG. Pero si el tipo CAMBIA (por ejemplo, veníamos reiniciando y
# ahora hace falta QR), el correo sale igual aunque sea seguido: es información
# nueva y hay que saberla.
avisar_por_correo() {
  tipo="$1"; asunto="$2"; cuerpo="$3"

  if [ -z "${RESEND_API_KEY:-}" ] || [ -z "${ALERTAS_EMAIL_TO:-}" ]; then
    return 0   # correo no configurado: el watchdog sigue funcionando igual
  fi

  ULTIMO_CORREO=0
  TIPO_CORREO=""
  if [ -f "$CORREO_FILE" ]; then
    read -r ULTIMO_CORREO TIPO_CORREO < "$CORREO_FILE" 2>/dev/null || true
    case "$ULTIMO_CORREO" in (*[!0-9]*|'') ULTIMO_CORREO=0 ;; esac
  fi

  DESDE_CORREO=$(( $(date +%s) - ULTIMO_CORREO ))
  if [ "$tipo" = "$TIPO_CORREO" ] && [ "$DESDE_CORREO" -lt "$EMAIL_COOLDOWN_SEG" ]; then
    log "Correo '$tipo' omitido (el anterior fue hace ${DESDE_CORREO}s, enfriamiento ${EMAIL_COOLDOWN_SEG}s)."
    return 0
  fi

  # El cuerpo se manda como JSON: hay que escapar comillas, barras y saltos.
  cuerpo_json=$(printf '%s' "$cuerpo" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
    | awk '{ printf "%s\\n", $0 }')

  CODIGO=$(curl -s -o /dev/null -w '%{http_code}' -m 20 -X POST \
    -H "Authorization: Bearer $RESEND_API_KEY" \
    -H 'Content-Type: application/json' \
    -d "{\"from\":\"$ALERTAS_EMAIL_FROM\",\"to\":[\"$ALERTAS_EMAIL_TO\"],\"subject\":\"$asunto\",\"text\":\"$cuerpo_json\"}" \
    "https://api.resend.com/emails" 2>/dev/null) || CODIGO="000"

  if [ "$CODIGO" -ge 200 ] 2>/dev/null && [ "$CODIGO" -lt 300 ] 2>/dev/null; then
    log "Correo '$tipo' enviado a $ALERTAS_EMAIL_TO."
    echo "$(date +%s) $tipo" > "$CORREO_FILE"
  else
    # No guardamos la marca: así el próximo chequeo vuelve a intentarlo.
    log "ERROR: no se pudo mandar el correo '$tipo' (HTTP $CODIGO)."
  fi
}

# ── Consultar el estado de la sesión ─────────────────────────────────────────
RESPUESTA=$(curl -s -m "$CURL_TIMEOUT" \
  -H "X-Api-Key: $WAHA_API_KEY" \
  "$WAHA_URL/api/sessions/$WAHA_SESSION" 2>/dev/null) || RESPUESTA=""

# Sin jq: sacamos el status con grep (jq puede no estar instalado).
ESTADO=$(printf '%s' "$RESPUESTA" | grep -o '"status":"[A-Z_]*"' | head -1 | cut -d'"' -f4)

if [ -z "$ESTADO" ]; then
  # WAHA no contestó o contestó algo raro. Puede estar caído el contenedor.
  log "WAHA no responde en $WAHA_URL (respuesta: '${RESPUESTA:0:120}'). Se trata como caída."
  ESTADO="SIN_RESPUESTA"
fi

AHORA=$(date +%s)

# ── Caso feliz ───────────────────────────────────────────────────────────────
if [ "$ESTADO" = "WORKING" ]; then
  # Solo dejamos rastro si venía de fallar, para no llenar el log de ruido.
  if [ "$FALLOS" -gt 0 ] || [ "$PRIMER_STARTING" -ne 0 ]; then
    log "OK: la sesión volvió a WORKING (venía de $FALLOS reinicio(s)). Contadores a cero."
    guardar_estado "$ULTIMO_REINICIO" 0 0
    # Si hubo reinicios, ya avisamos del problema: ahora cerramos el asunto.
    if [ "$FALLOS" -gt 0 ]; then
      avisar_por_correo "recuperada" \
        "✅ WhatsApp de la sala funcionando de nuevo" \
        "La sesión de WhatsApp volvió al estado WORKING después de $FALLOS reinicio(s) del watchdog.

Los avisos de fin de sesión vuelven a salir normalmente. No hay que hacer nada."
    fi
  fi
  exit 0
fi

# ── SCAN_QR_CODE: hace falta un humano, reiniciar no sirve ───────────────────
if [ "$ESTADO" = "SCAN_QR_CODE" ]; then
  log "ATENCIÓN: la sesión pide ESCANEAR EL QR. Reiniciar no lo arregla."
  log "          Entrá al dashboard de WAHA con el teléfono a mano."
  # Contador de STARTING a cero: ya no está intentando conectar.
  guardar_estado "$ULTIMO_REINICIO" "$FALLOS" 0
  # Este es el caso que SÍ necesita que vayas vos: reiniciar no lo arregla.
  avisar_por_correo "qr" \
    "🔴 WhatsApp de la sala desconectado: hay que escanear el QR" \
    "La sesión de WhatsApp se desconectó y pide que alguien escanee el código QR.

Reiniciarla NO lo arregla: hace falta el teléfono.

QUÉ HACER:
1. Entrá al dashboard de WAHA: http://157.151.183.29:3000/dashboard
2. Abrí la sesión '$WAHA_SESSION' y mostrá el QR.
3. En el teléfono de la sala: WhatsApp > Dispositivos vinculados > Vincular.

MIENTRAS TANTO no sale ningún aviso de fin de sesión."
  exit 0
fi

# ── STARTING: le damos tiempo, pero no para siempre ──────────────────────────
if [ "$ESTADO" = "STARTING" ]; then
  if [ "$PRIMER_STARTING" -eq 0 ]; then
    # Primera vez que la vemos conectando: arrancamos el cronómetro.
    guardar_estado "$ULTIMO_REINICIO" "$FALLOS" "$AHORA"
    log "La sesión está STARTING (conectando). Se deja trabajar."
    exit 0
  fi
  EN_STARTING=$(( AHORA - PRIMER_STARTING ))
  if [ "$EN_STARTING" -lt "$STARTING_MAX_SEG" ]; then
    log "La sesión sigue STARTING (${EN_STARTING}s). Se deja trabajar hasta ${STARTING_MAX_SEG}s."
    exit 0
  fi
  # Pegada en STARTING → se trata como caída y cae al bloque de reinicio.
  log "La sesión está ATASCADA en STARTING (${EN_STARTING}s, tope ${STARTING_MAX_SEG}s). Se trata como caída."
else
  # Cualquier otro estado (FAILED/STOPPED/SIN_RESPUESTA): no está conectando.
  PRIMER_STARTING=0
fi

# ── Hay que reiniciar. Primero, ¿nos toca? ───────────────────────────────────
DESDE_ULTIMO=$(( AHORA - ULTIMO_REINICIO ))

if [ "$FALLOS" -ge "$MAX_REINTENTOS" ]; then
  ESPERA="$BACKOFF_SEG"
  MODO="espaciado (ya van $FALLOS reinicios sin éxito — revisá si hace falta QR)"
else
  ESPERA="$COOLDOWN_SEG"
  MODO="normal"
fi

if [ "$DESDE_ULTIMO" -lt "$ESPERA" ]; then
  log "Sesión en $ESTADO, pero el último reinicio fue hace ${DESDE_ULTIMO}s y en modo $MODO hay que esperar ${ESPERA}s. Se salta."
  guardar_estado "$ULTIMO_REINICIO" "$FALLOS" "$PRIMER_STARTING"
  exit 0
fi

# ── Reiniciar ────────────────────────────────────────────────────────────────
log "Sesión en $ESTADO → reiniciando (modo $MODO, fallos seguidos: $FALLOS)."

CODIGO=$(curl -s -o /dev/null -w '%{http_code}' -m 30 -X POST \
  -H "X-Api-Key: $WAHA_API_KEY" \
  -H 'Content-Type: application/json' \
  "$WAHA_URL/api/sessions/$WAHA_SESSION/restart" 2>/dev/null) || CODIGO="000"

FALLOS=$(( FALLOS + 1 ))
# Cronómetro de STARTING a cero: el reinicio abre un intento nuevo de conexión.
guardar_estado "$AHORA" "$FALLOS" 0

if [ "$CODIGO" -ge 200 ] 2>/dev/null && [ "$CODIGO" -lt 300 ] 2>/dev/null; then
  log "Reinicio pedido OK (HTTP $CODIGO). En el próximo chequeo verificamos si llegó a WORKING."
  # A partir del 2º reinicio seguido esto ya no es un hipo: avisamos.
  # (El primero no manda correo: una reconexión suelta se arregla sola y no
  #  vale la pena despertarte por eso. Si funcionó, el próximo chequeo manda
  #  el correo de "recuperada" y listo.)
  if [ "$FALLOS" -ge 2 ]; then
    avisar_por_correo "reinicio" \
      "🟠 WhatsApp de la sala se cayó (el watchdog lo está reiniciando)" \
      "La sesión de WhatsApp estaba en estado $ESTADO y el watchdog la reinició.

Van $FALLOS reinicio(s) seguidos sin que la sesión llegue a WORKING.

Si te llega un correo de '✅ funcionando de nuevo' en los próximos minutos, se
arregló solo y no hay que hacer nada. Si en cambio llega uno pidiendo escanear
el QR, hay que ir con el teléfono al dashboard de WAHA.

MIENTRAS TANTO los avisos de fin de sesión no están saliendo."
  fi
  exit 0
fi

log "ERROR: el reinicio falló (HTTP $CODIGO). Puede que el contenedor esté caído:"
log "       cd /opt/waha && sudo docker compose ps && sudo docker compose restart"
avisar_por_correo "reinicio-fallido" \
  "🔴 WAHA no responde: ni siquiera se pudo reiniciar la sesión" \
  "El watchdog quiso reiniciar la sesión de WhatsApp y WAHA no respondió (HTTP $CODIGO).

Lo más probable es que el contenedor de WAHA esté caído, o la VM con problemas.

QUÉ HACER (por SSH a la VM de Oracle):
  cd /opt/waha && sudo docker compose ps
  cd /opt/waha && sudo docker compose logs --tail 100
  cd /opt/waha && sudo docker compose restart

MIENTRAS TANTO no sale ningún aviso de fin de sesión."
exit 1
