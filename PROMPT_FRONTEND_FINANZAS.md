# Rediseño de Finanzas Personales — prompt para el frontend

> Copiá todo este archivo y pasáselo al Claude del frontend.

---

Hola. Vamos a rediseñar la pantalla de **Finanzas Personales** (`/api/finanzas-personales`, solo admin). El backend ya está desplegado con todo lo que se necesita: no hay que esperar nada del lado del servidor.

**Mockup funcional aprobado por el dueño:**
https://claude.ai/code/artifact/8b56ea41-341b-47bc-ba45-1681b315563c

Abrilo y usalo como referencia: es la pantalla completa, funcionando, con datos reales. Si tenés la herramienta de Artifacts, podés leer su HTML directo con `action: "read"` y esa URL (la cuenta es la misma del dueño, así que te devuelve el código). Si no, mirá las capturas o pedile al dueño que te pase el HTML.

## Por qué se rediseña

El dueño no es técnico y la pantalla actual tiene ~12 tarjetas con nombres contables (`disponible`, `libreParaGastar`, `variacionSaldo`, `patrimonio`, `tasaAhorroBruta`…). No podía verificar si los números daban, y cuando no daban no tenía forma de saber en cuál línea estaba el problema. Textual: *«es un enredo grande, me gustaría que hasta un chiquito pueda entender toda esta parte»*.

## El modelo nuevo

**Toda su plata está en uno de dos lugares:**

- 💵 **Tu plata** — lo que puede usar hoy
- 🏦 **Tus ahorros** — lo que tiene apartado

**Y solo puede hacer tres cosas:**

| Botón | Qué pasa | Qué se manda al backend |
| --- | --- | --- |
| 💰 **Entró plata** | sube *Tu plata* | `tipo: "ingreso"` |
| 🛒 **Gasté** | baja *Tu plata* **o** baja *Tus ahorros* | `tipo: "egreso"` + `fondo` |
| 🐷 **Ahorré** | pasa de *Tu plata* a *Tus ahorros* | `tipo: "egreso"` con categoría de ahorro |

Si toca **Gasté**, aparece **una sola pregunta más**: *¿De dónde salió la plata?* → **De mi plata** (`fondo: "mes"`) o **De mis ahorros** (`fondo: "ahorro"` + `bolsaAhorro`).

## ⚠️ `retiro_ahorro` se elimina de la interfaz

Era un cuarto tipo («sacar del ahorro»). **Ya no se ofrece.** `GET /categorias` ya dejó de devolverlo en `tipos` — armá el selector desde ahí y no lo hardcodees.

Fue justo lo que rompió las cuentas del dueño: sacó ₡291.200 del ahorro para un teléfono, lo anotó como retiro, y el saldo final quedó inflado por ese monto. Y si además anotaba el gasto, entonces bajaba «Puedo gastar hasta» aunque el mes no hubiera puesto un colón. Las dos formas daban mal.

El backend **sigue aceptando** `retiro_ahorro` en POST/PUT por compatibilidad, pero no lo muestres ni lo ofrezcas.

## Orden de la pantalla

Este orden lo pidió el dueño explícitamente:

1. Título del mes + «Cambiar mes»
2. **Los dos totales** (Tu plata · Tus ahorros)
3. **Anotar** ← el formulario va ARRIBA, no al final
4. **Tu plata en agosto** (escalera)
5. **Tus ahorros en agosto** (escalera)
6. **Qué te dicen tus números** (los mensajes inteligentes)
7. **Movimientos del mes**

## Las dos escaleras

Cada línea suma o resta la de arriba y cierra en el total. Es lo que le permite verificar los números él mismo.

### Tu plata en {mes} — `GET /resumen?mes=&anio=`

| Línea | Campo |
| --- | --- |
| Tenías del mes pasado | `saldoInicial` |
| + Entró | `totalIngresos` |
| − Gastaste | `totalGastos` |
| − Ahorraste | `totalAhorro` |
| **= Te queda** | `saldoFinal` |

### Tus ahorros en {mes}

| Línea | Campo |
| --- | --- |
| Tenías ahorrado | `ahorroInicial` ← **campo nuevo** |
| + Ahorraste | `totalAhorro` |
| − Pagaste con tus ahorros | `totalGastoDesdeAhorro` ← **campo nuevo** |
| **= Ahora tenés** | `ahorroAcumulado` |

La fila «Pagaste con tus ahorros» se **oculta** si el valor es 0.

> Si algún mes viejo tiene `totalRetiroAhorro > 0`, agregá una fila extra
> «− Sacaste del ahorro» en esta escalera y «+ Sacaste del ahorro» en la de
> plata, para que sigan cerrando. Con datos nuevos siempre será 0.

Las dos identidades se cumplen siempre:

```
saldoInicial  + totalIngresos − totalGastos − totalAhorro
              + totalRetiroAhorro                          = saldoFinal
ahorroInicial + totalAhorro − totalGastoDesdeAhorro
              − totalRetiroAhorro                           = ahorroAcumulado
```

## Los dos totales de arriba

- **Tu plata** = `saldoFinal` · subtítulo *«lo que podés usar hoy»*
- **Tus ahorros** = `ahorroAcumulado` · subtítulo *«lo que tenés apartado»*

**Quitar de la pantalla** (siguen viniendo en la respuesta, pero ya no se muestran como tarjetas): `disponible`, `libreParaGastar` («Puedo gastar hasta»), `patrimonio`, `balance`, `balanceMes`, `variacionSaldo`, `tasaAhorro`, `tasaAhorroBruta`, `ahorroNetoMes`, `totalEgresos`. Los mensajes inteligentes ya cuentan esa historia en palabras.

## El formulario

```
  ¿Qué hiciste?
   [ 💰 Entró plata ]  [ 🛒 Gasté ]  [ 🐷 Ahorré ]

  ¿De dónde salió la plata?          ← solo si es "Gasté"
   ( ) De mi plata    ( ) De mis ahorros

  ¿De cuál ahorro?                   ← solo si eligió "De mis ahorros"
   [ Ahorro MEP ▾ ]

  ¿En qué?    [ Compras personales ▾ ]
  ¿Cuánto?    ₡ 291.200
  Detalle     (opcional)

  [ Guardar ]
```

Etiqueta del campo de categoría según el botón:
- Entró plata → **¿De dónde vino?**
- Gasté → **¿En qué?**
- Ahorré → **¿A cuál ahorro?**

### Qué se manda

`POST /api/finanzas-personales` (y `PUT /:id` para editar):

```json
{ "tipo": "egreso", "categoria": "Compras personales", "monto": 291200,
  "fondo": "ahorro", "bolsaAhorro": "Ahorro MEP",
  "mes": 8, "anio": 2026, "descripcion": "Teléfono nuevo" }
```

- `fondo`: `"mes"` (default) o `"ahorro"`. **Mandalo siempre explícito**, también al editar.
- `bolsaAhorro`: obligatorio si `fondo: "ahorro"`. Valores en `GET /categorias` → `bolsasAhorro`.
- El botón **Ahorré** manda `tipo: "egreso"` con una categoría de `bolsasAhorro` y `fondo: "mes"`.

### ⚠️ Trampa importante al editar

Al pasar un movimiento viejo de «sacar del ahorro» a **Gasté**, la categoría queda en una de ahorro (ej. `Ahorro MEP`) y entonces la app lo guarda como *«aparté más ahorro»* — que fue exactamente el error que rompió agosto del dueño.

Con los tres botones esto ya no debería pasar, pero **por las dudas**: si el botón es 🛒 Gasté y la categoría seleccionada está en `categoriasSinFondoAhorro`, no dejes guardar y mostrá *«Esa categoría es de ahorro. Si guardaste plata, usá el botón 🐷 Ahorré.»*

### Validación

El backend rechaza con **400** si se paga con ahorro que no alcanza:

```json
{ "message": "Solo podés pagar con el ahorro ₡449.500: es lo que te queda...",
  "disponible": 449500, "acumulado": 500000 }
```

`disponible` es el tope de **ese** movimiento — usalo para limitar el campo. Mostrá el `message` tal cual, ya viene redactado en español.

## Mensajes inteligentes — «Qué te dicen tus números»

`GET /recomendaciones?mes=&anio=` → `{ recomendaciones: [{ nivel, icono, mensaje }] }`

Siguen igual, pero ahora vienen **hasta 5** (antes 4). Niveles: `critico`, `advertencia`, `consejo`, `bien`, `info`. En el mockup se pintan como una lista con el icono y una barrita de color a la izquierda según el nivel.

Hay un mensaje nuevo 🏦 que explica los pagos hechos con el ahorro — es el que evita que el dueño se pregunte por qué las tarjetas del mes no se movieron.

## Desgloses disponibles

`GET /resumen` trae en `desglose`:

| Clave | Qué es |
| --- | --- |
| `ingreso` | por categoría de ingreso |
| `egreso` | gastos y ahorro pagados con plata del mes |
| `gastoAhorro` | lo pagado con ahorros, **en qué** se fue |
| `gastoAhorroPorBolsa` | lo pagado con ahorros, **de cuál bolsa** salió |
| `retiro` | retiros viejos (vacío de acá en adelante) |

En la lista de movimientos, marcá los que tengan `fondo === "ahorro"` con una etiqueta tipo **«pagado con Ahorro MEP»** y el color del ahorro, para que se distingan de un gasto normal.

## Reporte anual

`GET /resumen-anual?anio=` ya trae `totales.totalGastoDesdeAhorro`, `totales.gastoTotalConAhorro`, `desglose.gastoAhorro`, `desglose.gastoAhorroPorBolsa`, `destacados.mesMasGastoDesdeAhorro` y, por mes, `totalGastoDesdeAhorro` / `gastoTotalConAhorro` / `ahorroNetoMes`. Aplicá el mismo criterio: dos escaleras, sin «retiros».

## Notas

- El módulo es **solo admin**: todas las rutas piden Bearer token + rol admin.
- Todo en colones. El soporte de USD (`moneda`, `montoOriginal`, `tipoCambio`) sigue igual, no lo toques.
- La referencia completa de la API está en `FINANZAS_PERSONALES.md` del repo del backend (§6 es la del gasto pagado con el ahorro).
- Si algo del backend te falta para armar la pantalla, decilo: se agrega. No inventes cálculos en el frontend — todos los números deben venir de la API.
