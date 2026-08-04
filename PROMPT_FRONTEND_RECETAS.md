# Prompt para el Claude del FRONTEND — Recetas: arreglo + rediseño de la interfaz

> Copiá y pegá TODO este documento como prompt.

---

## 0. Contexto: qué pasó y por qué te estoy pidiendo esto

El backend tiene un módulo de **recetas** (productos compuestos que no tienen stock propio, sino que descuentan sus ingredientes al venderse). Ejemplo: "Helado con Gelatina" = 1 vaso + 1 cuchara + 100 g de helado + 50 g de gelatina.

Pasó un problema real: el dueño creó la receta **"Helado con Gelatina" (₡700)** y **nunca apareció en la pantalla de ventas ni en el catálogo**. No daba ningún error, simplemente no existía.

La causa fueron **dos cosas**:

1. **Datos mal digitados por culpa de la interfaz.** En el formulario de la receta se puso "44 vasos", "50 cucharas" y "1000 gramos de gelatina" **por cada helado**. El dueño creyó que ahí se anotaba *el paquete que compró* (las cucharas vienen en paquete de 100, la gelatina en paquete de 1000 g), pero ese campo es **cuánto se gasta en UN solo helado**. Como pedía 44 vasos y solo había 40 en stock, el sistema calculó que no alcanzaba ni para uno.

2. **El backend escondía las recetas que no se podían preparar.** Si el cálculo daba 0, la receta se descartaba en silencio: no llegaba al frontend. Además, todos los endpoints devolvían `cantidad: 0` para las recetas (en la base de datos las recetas guardan 0 porque no tienen stock propio), así que cualquier pantalla que mirara `cantidad` las veía agotadas aunque hubiera ingredientes de sobra.

**El punto 2 ya está arreglado en el backend** (te paso el contrato nuevo abajo). El punto 1 es tu trabajo: **la interfaz tiene que hacer imposible ese error**.

### Lo que el dueño pide explícitamente

> "Que sea fácil de usar en la interfaz, ahorita lo noto bastante difícil, y que el usuario no tenga que escribir casi, sino que haya botones y desplegables con opciones."

Tenelo como requisito de primera clase, no como un extra. El dueño **no es técnico**, usa el sistema **desde el celular**, y a veces lo usan colaboradores. La regla es:

> **Escribir con el teclado debe ser la excepción. Todo lo que se pueda elegir con un botón, un desplegable o un +/−, se elige.**

Todo en **español de Costa Rica** y montos en **colones (₡)** con separador de miles (₡2.056).

---

## 1. Contrato nuevo de la API (backend ya desplegado con estos cambios)

### 1.1 Campos nuevos que vienen en CADA producto

Todos los endpoints de productos ahora devuelven estos campos extra:

| Campo | Tipo | En quién viene | Qué significa |
|---|---|---|---|
| `tipo` | `'producto'` \| `'receta'` | todos | Si no viene, asumí `'producto'` (hay ítems viejos sin el campo) |
| `cantidad` | número | todos | **Para recetas ya viene CALCULADO** (cuántas se pueden preparar con el stock actual de ingredientes). Ya no es 0. |
| `agotado` | booleano | todos | `true` si no se puede vender/preparar |
| `stockCalculado` | número | solo recetas | Igual que `cantidad`, explícito |
| `motivoAgotado` | texto \| `null` | solo recetas | Texto listo para mostrar: `'No alcanza "Vasos": hay 40 unidades y cada unidad necesita 44.'` |
| `ingredienteLimitante` | objeto \| `null` | solo recetas | `{ nombre, disponible, requeridoPorUnidad, unidad }` — el ingrediente que topa la producción |
| `precioCompra` | número | todos | **Para recetas es el costo calculado** de preparar una unidad (suma de sus ingredientes) |
| `unidad` | texto | productos simples | `'unidades'`, `'gramos'`, `'mililitros'`… |
| `cantidadPorEnvase` | número \| `null` | productos simples | Cuántas unidades trae 1 envase (ej. 100 cucharas por paquete) |
| `nombreEnvase` | texto \| `null` | productos simples | `'paquete'`, `'balde'`, `'botella'`… |
| `receta` | arreglo | solo recetas | `[{ ingredienteId, nombre, cantidad }]` — `cantidad` es **por unidad vendida** |

**Programá defensivo:** usá `item.agotado ?? (item.cantidad ?? 0) <= 0` por si algún endpoint viejo no manda la bandera.

### 1.2 `GET /api/products/para-venta` — pantalla de VENTAS ⚠️ **AHORA PIDE TOKEN**

🔴 **CAMBIO QUE ROMPE:** este endpoint era público. Devolvía el `precioCompra` de cada producto y la receta completa con el costo de cada ingrediente, así que cualquiera con la URL podía leer los márgenes del negocio. **Ahora exige `Authorization: Bearer <token>`** y sin token responde `401`. Mandá el token igual que en `/list`.

Además, **si el usuario es rol `vendedor` la respuesta viene sin costos**: no trae `precioCompra` ni el `precioCompra` de los ingredientes. Sí trae todo lo demás (`cantidad`, `agotado`, `motivoAgotado`, `ingredienteLimitante`), así que la pantalla de ventas funciona igual. No asumas que `precioCompra` existe: puede venir `undefined` según el rol.

Devuelve productos simples con stock **y todas las recetas activas, incluidas las agotadas** (marcadas). Las agotadas vienen **al final del arreglo**.

```json
{
  "productos": [
    {
      "_id": "69ff9ab5fd44928cfde4803e",
      "nombre": "Helado con Gelatina",
      "tipo": "receta",
      "precioVenta": 700,
      "precioCompra": 453,
      "cantidad": 20,
      "stockCalculado": 20,
      "agotado": false,
      "motivoAgotado": null,
      "ingredienteLimitante": { "nombre": "Gelafina Fresa", "disponible": 1001, "requeridoPorUnidad": 50, "unidad": "gramos" },
      "imagen": null,
      "seVende": true,
      "totalVendido": 0,
      "receta": [
        { "nombre": "Vasos", "cantidad": 1, "ingredienteId": { "_id": "...", "nombre": "Vasos", "cantidad": 40, "precioCompra": 40, "unidad": "unidades" } }
      ]
    },
    {
      "_id": "...",
      "nombre": "Otra receta",
      "tipo": "receta",
      "cantidad": 0,
      "agotado": true,
      "motivoAgotado": "No alcanza \"Vasos\": hay 40 unidades y cada unidad necesita 44.",
      "ingredienteLimitante": { "nombre": "Vasos", "disponible": 40, "requeridoPorUnidad": 44, "unidad": "unidades" }
    }
  ],
  "totalEncontrados": 42
}
```

⚠️ **CRÍTICO: no filtres por `cantidad > 0` en el frontend.** Ese filtro es justamente lo que haría que el arreglo del backend no se note. Mostrá los agotados deshabilitados con su motivo.

### 1.3 `GET /api/products/public` — menú del cliente (única ruta sin token)

Devuelve `{ productos: [{_id, nombre, imagen, precioVenta, cantidad, tipo, agotado, motivoAgotado}], pagination: {...} }`.

- `tipo` **sí se agregó**, para que puedas distinguir una receta en el menú.
- Por defecto **se esconde lo agotado** (productos sin stock y recetas que no se pueden preparar).
- Con **`?incluirAgotados=true`** vienen también los agotados, con `agotado: true` y `motivoAgotado: "Temporalmente agotado"`, ordenados al final. Útil si querés mostrar el ítem en gris en vez de esconderlo.

⚠️ **Lo que NO va a venir nunca acá, y es a propósito:** `receta`, `precioCompra` e `ingredienteLimitante`. Esta es la única ruta sin token: esos campos revelarían el costo de cada ingrediente y el stock interno del negocio a cualquiera con la URL. Por eso el motivo en el menú público es genérico ("Temporalmente agotado") y no dice qué ingrediente falta. **El motivo detallado existe solo en `/para-venta` y `/list`, que piden token.** Si en algún momento hace falta el detalle en una pantalla, esa pantalla tiene que estar detrás del login y usar `/para-venta`.

### 1.4 `GET /api/products/list?page=1&limit=12&search=&disponible=` — catálogo admin (con token)

`{ productos: [...], pagination: { currentPage, totalPages, totalProducts, productsPerPage, hasNextPage, hasPrevPage } }`. Cada producto trae además `imagenOptimizada` e `imagenOriginal`. **Las recetas ya traen su `cantidad` real calculada.**

### 1.5 `GET /api/products/:id` — para el formulario de edición (con token)

`{ producto: {...} }` con `receta[].ingredienteId` ya poblado (`nombre`, `cantidad`, `precioCompra`, `precioVenta`, `imagen`, `seVende`, `tipo`, `unidad`).

### 1.6 `GET /api/products/ingredientes?search=` — lista para armar recetas (con token)

✅ **Confirmado: sin el parámetro `search` devuelve la lista COMPLETA** (verificado contra la base: 75 ítems, ordenados por nombre, sin recetas). El formulario puede cargar todo al abrirse y dejar que el usuario elija sin teclear, que es justo lo que se busca. `search` es opcional y solo filtra.

```json
{ "ingredientes": [
    { "_id": "...", "nombre": "Cucharas", "cantidad": 75, "precioCompra": 13, "unidad": "unidades",
      "cantidadPorEnvase": 100, "nombreEnvase": "paquete", "imagen": null, "seVende": false, "tipo": "producto" }
  ], "total": 9 }
```

Ordenado por nombre. Excluye las recetas (una receta no puede ser ingrediente de otra).

### 1.7 `POST /api/products` — crear (con token)

Para **receta**:
```json
{ "tipo": "receta", "nombre": "Helado con Gelatina", "precioVenta": 700, "seVende": true,
  "receta": [ { "ingredienteId": "...", "cantidad": 1 }, { "ingredienteId": "...", "cantidad": 100 } ],
  "imagenBase64": "data:image/jpeg;base64,..." }
```
- La imagen es **opcional** en recetas (obligatoria en productos simples).
- No mandes `cantidad` ni `precioCompra`: se fuerzan a 0 (el costo se calcula solo).
- Respuesta `201`: `{ message, producto, advertencia? }`. **Si viene `advertencia`, mostrala** — significa que la receta se creó pero no se puede preparar todavía.

Para **producto simple**: `{ nombre, cantidad, precioCompra, precioVenta, seVende, unidad, cantidadPorEnvase, nombreEnvase, imagenBase64 }` (imagen obligatoria).

### 1.8 `PUT /api/products/:id` — editar (con token)

Ahora es **parcial**: solo se modifica lo que mandés. (Antes, si no mandabas `seVende`, el producto **se apagaba solo**, y si no mandabas los precios **se ponían en ₡0**. Ya está arreglado en el backend, pero de todos modos mandá siempre los campos que el usuario vio en pantalla.)

- Ingredientes: `{ "receta": [ { "ingredienteId": "...", "cantidad": 1 } ] }`
- Reposición de stock (**solo productos simples**, nunca recetas): `cantidadAAgregar` (unidades sueltas) **o** `envasesAAgregar` (se multiplica por `cantidadPorEnvase`). **Nunca sobreescribe: suma.**
- En recetas, `precioCompra` se ignora y la reposición también.

**🔴 Cambiar la `unidad` de un producto que se usa en recetas está BLOQUEADO.** Las recetas guardan la cantidad en la unidad que el ingrediente tenía cuando se armaron ("100 gramos de Helado Combinado"). Si la unidad cambia a kilos, ese 100 pasa a significar 100 kilos y la receta queda mal costeada y mal descontada, en silencio. Es la misma familia del error de los 44 vasos. El backend responde `400`:

```json
{ "error": "No se puede cambiar la unidad de \"Helado Combinado\" de gramos a kilos: se usa como ingrediente en \"Helado con Gelatina\", \"Conos con helado\". Esas recetas tienen anotada la cantidad en gramos y quedarían mal costeadas. Primero ajustá las cantidades en esas recetas, o creá un producto nuevo con la unidad correcta.",
  "code": "UNIDAD_EN_USO_EN_RECETAS",
  "recetasAfectadas": ["Helado con Gelatina", "Conos con helado"] }
```

En la interfaz: si el producto se usa en recetas, mostrá el desplegable de unidad **deshabilitado** con la nota *"No se puede cambiar: se usa en {recetas}"*. Mandar la misma unidad no cuenta como cambio (no falla), así que podés seguir enviando el campo sin problema.

**Borrar un producto usado como ingrediente también está bloqueado** (`400`, `code: 'INGREDIENTE_EN_USO'`, con `recetasAfectadas`). Antes se borraba y dejaba las recetas apuntando a un ítem inexistente.

**`unidad` y `nombreEnvase` se validan contra listas cerradas** y se guardan en minúscula. Un valor fuera de la lista devuelve `400` con `code: 'UNIDAD_INVALIDA'` o `'ENVASE_INVALIDO'` y el mensaje incluye las opciones válidas. Podés mandar `"PAQUETE"` y se guarda `"paquete"`, pero **usá exactamente los valores de la lista** en tus desplegables.

### 1.9 `POST /api/sales` — errores propios de recetas

El servidor revalida todo. Puede responder `400` con:

```json
{ "error": "Stock insuficiente de \"Vasos\" para preparar \"Helado con Gelatina\"",
  "producto": { "receta": "Helado con Gelatina", "ingrediente": "Vasos", "necesario": 44, "disponible": 40 } }
```

Otros: `La receta "X" no tiene ingredientes configurados.` / `Un ingrediente de la receta "X" ya no existe en inventario.` / `"X" no está disponible para venta` / `El precio de "X" ha cambiado`. Mostrá `error` tal cual en un toast y, si viene `producto`, agregá el detalle del ingrediente.

---

## 2. Pantalla de VENTAS

1. **Quitá cualquier filtro local por `cantidad > 0`.**
2. Ítems con `agotado: true`: se muestran **deshabilitados** (opacidad ~45%, sin sombra, no clickeables), con una cinta o etiqueta **"AGOTADO"** y debajo, en letra pequeña, el `motivoAgotado`. Si es largo, mostralo en un tooltip / al tocar un ícono ⓘ.
3. Las recetas llevan un distintivo visual (ej. chip 🍨 **"Receta"**) para que se entienda que su stock depende de ingredientes.
4. En cada tarjeta mostrá `Disponibles: {cantidad}`. Para recetas agregá en letra chica: `Topado por {ingredienteLimitante.nombre}`.
5. **Tope del carrito:** no se puede agregar más de `cantidad` unidades. Al llegar al tope, el botón `+` se deshabilita y aparece: *"Solo hay 20 disponibles"*.
6. **Muy importante — refrescá después de cada venta:** vender un cono descuenta helado, y eso cambia cuántos "Helado con Gelatina" se pueden hacer. Volvé a pedir `/para-venta` cuando la venta se registre con éxito. **No** actualices el stock de recetas solo restando localmente: no da el número correcto.
7. Si el carrito lleva **dos recetas que comparten un ingrediente**, el frontend no puede calcular el tope combinado. Dejá que el backend rechace y mostrá el error del punto 1.9.

---

## 3. Catálogo de productos (admin)

1. Las recetas ya traen `cantidad` real → mostrala como cualquier producto. **No las trates como stock 0.**
2. Columna/etiqueta de **tipo**: `Producto` / `Receta`.
3. En las recetas mostrá el **costo calculado** (`precioCompra`) y la **ganancia** (`precioVenta - precioCompra`).
4. 🔴 **Alerta de pérdida:** si `precioCompra >= precioVenta`, marcá la fila en rojo con *"Estás vendiendo con pérdida"*. Esto es lo que habría cantado el error de los 1000 g de gelatina (costaba ₡2.056 y se vendía en ₡700).
5. Las recetas **no** muestran botón de "reponer stock" (no tienen stock propio). En su lugar: **"Ver/editar ingredientes"**.
6. Las agotadas se muestran con su `motivoAgotado` visible, no escondidas.

---

## 4. Formulario de RECETA — el rediseño más importante

Este formulario fue el que causó el problema. Rehacelo como **asistente de 3 pasos**, pensado para el celular y **sin teclado salvo el nombre**.

### Paso 1 — Nombre y precio

- **Nombre**: único campo de texto libre (inevitable).
- **Precio de venta**: NO un input pelado. Poné:
  - Botones de precios comunes: `₡100` `₡200` `₡300` `₡500` `₡600` `₡700` `₡1.000`
  - Un stepper `− ₡50` / `+ ₡50` para ajustar
  - Y un enlace pequeño *"escribir otro monto"* como salida de emergencia
- **¿Se vende?**: interruptor (switch), nunca texto.
- **Foto**: opcional en recetas. Botón grande "Tomar foto / Elegir imagen".

### Paso 2 — Ingredientes (el corazón del asunto)

**Cero escritura.** Así:

**a) Agregar ingrediente:** botón grande `+ Agregar ingrediente` que abre un **desplegable buscable** (bottom sheet en celular) alimentado por `/api/products/ingredientes`. Cada opción muestra:

```
🥤 Vasos            hay 40 unidades      ₡40 c/u
🥄 Cucharas         hay 75 unidades      ₡13 c/u   (paquete de 100)
🍦 Helado Combinado hay 5169 gramos      ₡3 el gramo (balde de 5200)
```

Los ya agregados se muestran deshabilitados (el backend rechaza duplicados).

**b) La cantidad — acá estuvo el error.** El rótulo tiene que ser inequívoco:

> ### ¿Cuánto **Helado Combinado** se gasta en **UN solo** Helado con Gelatina?

Y debajo, cuando el ingrediente tenga envase, la advertencia preventiva:

> ⚠️ *No pongás el paquete completo. El balde trae 5200 gramos, pero acá va lo que lleva **un** helado.*

El control **no es un campo de texto**, son **botones de valores comunes según la unidad** + stepper:

| Unidad del ingrediente | Botones rápidos | Stepper |
|---|---|---|
| `unidades` | `1` `2` `3` `4` | `−1` / `+1` |
| `gramos` | `25 g` `50 g` `100 g` `150 g` `200 g` | `−10` / `+10` |
| `mililitros` | `50 ml` `100 ml` `200 ml` `250 ml` | `−10` / `+10` |

El valor elegido se ve grande y claro: **100 gramos**. Un enlace chico *"otra cantidad"* abre el input manual para casos raros.

**c) Dos validaciones que hay que mostrar SÍ O SÍ** (no bloquean, pero avisan fuerte):

- Si `cantidad >= ingrediente.cantidadPorEnvase`:
  > 🚨 **¿Seguro?** Estás diciendo que **1 Helado con Gelatina se lleva un paquete entero** de Cucharas (100 unidades). Lo normal es 1 o 2.
- Si `cantidad > ingrediente.cantidad` (stock actual):
  > ⚠️ No hay tanto en inventario (hay 40 y estás pidiendo 44 por unidad). La receta va a quedar agotada y **no va a aparecer para vender**.

**d) Cada ingrediente agregado se ve como una tarjeta** con: nombre, la cantidad elegida bien grande, `× ₡precio = ₡subtotal`, `alcanza para N`, botón editar y botón quitar.

### Paso 3 — Resumen antes de guardar (panel fijo, siempre visible)

Este panel es la red de seguridad. Calculalo **en vivo** con los datos que ya tenés de `/ingredientes`:

```
┌─────────────────────────────────────────┐
│  Costo por unidad      ₡453             │
│  Precio de venta       ₡700             │
│  Ganancia              ₡247  (35%)  ✅  │
│                                         │
│  Podés preparar        20 unidades      │
│  Topado por            Gelafina Fresa   │
└─────────────────────────────────────────┘
```

Fórmulas:
- `costo = Σ (ingrediente.precioCompra × cantidad)`
- `puedePreparar = min( floor(ingrediente.cantidad / cantidad) )` sobre todos los ingredientes
- `limitante` = el ingrediente con ese mínimo

Estados del panel:
- Ganancia positiva → **verde ✅**
- Ganancia menor al 10% del precio → **amarillo ⚠️** *"Te queda muy poca ganancia"*
- `costo >= precioVenta` → **rojo 🔴** *"Vas a perder ₡1.356 en cada uno"* y el botón Guardar pide confirmación explícita
- `puedePreparar === 0` → **rojo 🔴** *"Con el inventario de hoy no se puede preparar ninguno; no va a aparecer para vender hasta que repongas {limitante}"*

### Modo edición

Mismo formulario precargado desde `GET /api/products/:id`. Mostrá arriba el estado real (`cantidad`, `agotado`, `motivoAgotado`). Al guardar, mandá en el PUT `nombre`, `precioVenta`, `seVende` y `receta` juntos.

---

## 5. Formulario de producto simple y reposición (misma filosofía)

1. **`unidad`**: desplegable cerrado, **nunca texto libre**. Los valores **exactos** que acepta el backend son: `unidades`, `gramos`, `kilos`, `mililitros`, `litros`, `onzas`. (Los datos viejos ya se normalizaron a minúscula; el backend ahora rechaza cualquier otro valor.) Recordá que el desplegable va **deshabilitado** si el producto se usa en recetas.
2. **`nombreEnvase`**: desplegable — valores exactos: `paquete`, `balde`, `botella`, `caja`, `bolsa`, `saco`, `tarro`, `sobre`, `bandeja`.
3. **`cantidadPorEnvase`**: botones `12` `24` `50` `100` `500` `1000` + stepper. Explicalo así: *"¿Cuántas unidades trae un paquete?"*.
4. **Reposición** (solo productos simples): dos botones grandes
   - **Por paquetes** → stepper de paquetes, y debajo en vivo: *"2 paquetes × 100 = 200 cucharas. Vas a quedar en 275."* (usa `envasesAAgregar`) — deshabilitado si `cantidadPorEnvase` es `null`, con la nota *"Primero configurá cuántas unidades trae el paquete"*.
   - **Por unidades sueltas** → stepper (usa `cantidadAAgregar`)
   - Nunca un campo que reemplace el stock: la reposición **suma**.
5. **Aviso útil:** el producto **"Vasos"** hoy no tiene `cantidadPorEnvase`, así que solo se puede reponer por unidades. Invitá a configurarlo con un chip *"Configurar paquete"* en la tarjeta de todo producto que tenga `cantidadPorEnvase: null`.

---

## 6. Componentes reutilizables que conviene crear

- `<SelectorCantidad unidad valor onChange presets step />` — botones de presets + stepper + "otra cantidad". Se usa en recetas, reposición y carrito.
- `<SelectorMonto valor onChange />` — chips de precios + stepper ±50.
- `<SelectorIngrediente />` — bottom sheet buscable con stock, precio y envase.
- `<EstadoDisponibilidad item />` — resuelve `agotado` / `motivoAgotado` / `ingredienteLimitante` en una etiqueta uniforme. Usalo en ventas, catálogo y formularios para que el mensaje sea siempre el mismo.
- `<PanelRentabilidad costo precioVenta puedePreparar limitante />` — el resumen del paso 3.

---

## 7. Reglas de UX generales

- **Mobile first.** Botones de mínimo 44×44 px, separados. Nada de inputs numéricos chiquitos.
- **El teclado no debe aparecer** salvo en: nombre del producto y el escape de "otra cantidad".
- Todo número con **unidad visible al lado** (`100 gramos`, no `100`).
- Los montos siempre con **₡** y separador de miles.
- Nada de errores en crudo ni códigos: mensajes en español, con el nombre del producto o ingrediente adentro.
- Mostrá **el porqué**, nunca esconder: si algo no se puede vender, la interfaz dice cuál ingrediente falta y cuánto falta.
- Confirmación explícita solo para lo grave: guardar con pérdida, y borrar.

---

## 8. Checklist de aceptación

Probalo contra los datos reales que hay hoy:

- [ ] **"Helado con Gelatina" (₡700) aparece en la pantalla de ventas con 20 disponibles.**
- [ ] "Conos con helado" aparece con 6 disponibles.
- [ ] Una receta agotada **aparece** deshabilitada, con "AGOTADO" y el motivo — no desaparece.
- [ ] Las recetas también aparecen en el catálogo admin con su stock real (no en 0).
- [ ] En el catálogo, una receta con costo ≥ precio sale marcada en rojo.
- [ ] Armando una receta y poniendo **44** en Vasos (hay 40), salta el aviso de que no hay tanto y que va a quedar agotada.
- [ ] Poniendo **100** en Cucharas (paquete de 100), salta el aviso "¿seguro? un paquete entero".
- [ ] El panel de resumen muestra costo ₡453 / ganancia ₡247 (35%) / 20 unidades / topado por Gelafina Fresa, para la receta actual.
- [ ] Editar **solo los ingredientes** de una receta **no** apaga el producto ni le borra el precio.
- [ ] Después de registrar una venta, los disponibles de las recetas se refrescan pidiendo `/para-venta` de nuevo.
- [ ] Las recetas **no** muestran opción de reponer stock.
- [ ] En todo el flujo de crear una receta, el teclado solo aparece para el nombre.
- [ ] `/para-venta` se llama **con token** (si no, la pantalla de ventas queda vacía con 401).
- [ ] Con un usuario rol **vendedor**, la pantalla de ventas funciona aunque `precioCompra` venga `undefined` (no debe mostrar NaN ni ₡undefined).
- [ ] El desplegable de unidad aparece **deshabilitado** en un producto que se usa en recetas (probá con "Helado Combinado", que lo usan las dos).
- [ ] Intentar borrar "Cucharas" muestra el mensaje de que se usa en "Helado con Gelatina", no un error genérico.

## 9. Datos reales para probar

| Ítem | Tipo | Stock | Unidad | Precio compra | Envase |
|---|---|---|---|---|---|
| Vasos | producto | 40 | unidades | ₡40 | *sin configurar* |
| Cucharas | producto | 75 | unidades | ₡13 | paquete de 100 |
| Helado Combinado | producto | 5169 | gramos | ₡3 | balde de 5200 |
| Gelafina Fresa | producto | 1001 | gramos | ₡2 | paquete de 1000 |
| Conos | producto | 6 | unidades | ₡180 | paquete de 12 |
| Servilletas | producto | 69 | unidades | ₡4 | paquete de 100 |
| **Helado con Gelatina** | **receta** | **20 calculadas** | — | **₡453 costo** | vende ₡700 |
| **Conos con helado** | **receta** | **6 calculadas** | — | **₡187 costo** | vende ₡500 |

Receta actual de "Helado con Gelatina": 1 vaso + 1 cuchara + 100 g de Helado Combinado + 50 g de Gelafina Fresa.
