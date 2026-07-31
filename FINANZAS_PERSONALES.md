# Finanzas Personales — Saldo de apertura, Reporte anual y Retiros de ahorro

Módulo `/api/finanzas-personales` (**solo administrador**: todas las rutas exigen
Bearer token + rol admin). Es un módulo **aparte de la sala de juegos**: no se
cruza con ventas, plays, ganancias ni con el Estado de Resultados del negocio.

Este documento cubre lo que se agregó: **cómo se guardan los reportes**, el
**saldo de apertura** (la plata que se traía de antes) y el **reporte anual**.

---

## 1. Cómo se calculan los reportes (Patrón A)

Antes, cada vez que se abría el resumen del mes se recorrían todos los
movimientos: los del mes, más **todos los anteriores** para el saldo acumulado.
Eso crece para siempre y el reporte anual habría multiplicado el problema por 12.

Ahora se usa el mismo patrón que el Estado de Resultados del negocio
(«genera y guarda»):

- Colección **`ResumenPersonalMes`**: un snapshot por `{usuario, año, mes}` con
  los totales ya sumados y el desglose por categoría.
- Se regenera **automáticamente** al crear, editar o borrar un movimiento (solo
  el mes afectado; si el movimiento cambia de mes, los dos meses). Se espera a
  que termine antes de responder, así que si el frontend recarga el resumen
  después de guardar, ya ve el número nuevo.
- Los **GET solo leen**. El reporte anual es **una consulta** que trae como
  máximo 24 documentos chiquitos (el año y el anterior) y suma en memoria: no
  toca los movimientos ni una vez.
- Si un mes se queda sin movimientos, su snapshot **se borra** (no queda basura).

Lo que **no** se guarda, porque es acumulado y habría que regenerar en cascada al
editar un mes viejo (se deriva al leer sumando los snapshots, que son 12 por año):

- Saldo Inicial / Saldo Final
- Ahorro Acumulado

**Red de seguridad** (no hace falta tocar nada normalmente):

- La primera lectura de cada proceso verifica que no falte ningún snapshot y
  genera los que falten (`asegurarSnapshots`). Esto es lo que hace que funcione
  en producción, donde las tareas de arranque están apagadas.
- `POST /api/finanzas-personales/regenerar[?anio=2026]` fuerza el recálculo desde
  los movimientos. Solo sirve si se editó la base a mano. Se puede exponer como
  un botón «Regenerar» escondido en ajustes, o no exponerlo.

---

## 2. Saldo de apertura — la plata que se traía de antes

**El problema.** Al empezar a usar el módulo ya había ₡945.000 ahorrados de meses
anteriores que nunca se registraron. Meterlos como un ingreso normal rompe el
mes: los mensajes inteligentes calculan casi todo como **% de los ingresos del
mes** (tasa de ahorro, peso de los gastos fijos, peso de las deudas) y comparan
**contra el mes anterior**. Un ingreso gigante de una sola vez dispararía la tasa
de ahorro, desinflaría los porcentajes y al mes siguiente avisaría
«📉 tus ingresos bajaron 90%».

**La solución.** El saldo de apertura vive en su propia colección
(`AperturaPersonal`, **uno por usuario**) y **no es un movimiento**: se excluye
del resumen del mes, del desglose por categoría, de la lista de movimientos y de
todas las comparaciones. Solo alimenta los acumulados:

| Campo             | Qué es                              | A dónde va                          |
| ----------------- | ----------------------------------- | ----------------------------------- |
| `montoAhorro`     | Lo que ya estaba **apartado**       | **Ahorro Acumulado** (no al saldo)  |
| `montoDisponible` | Lo que estaba **a mano** (gastable) | **Saldo Inicial**                   |
| `mesCorte`/`anioCorte` | Desde qué mes aplica           | —                                   |

`montoAhorro` no suma al saldo disponible **a propósito**: es dinero apartado,
igual que la categoría «Ahorro» de cualquier mes (que también resta del saldo).
Se muestra en su propia tarjeta.

### Endpoints

```
GET    /api/finanzas-personales/apertura
PUT    /api/finanzas-personales/apertura     ← crea o actualiza (uno por usuario)
DELETE /api/finanzas-personales/apertura
```

**`PUT /apertura`** — body:

```json
{
  "montoAhorro": 945000,
  "montoDisponible": 0,
  "mes": 7,
  "anio": 2026,
  "descripcion": "Ahorros de antes de usar la app"
}
```

- `mes` y `anio` son obligatorios (el mes desde el que aplica; no puede ser futuro).
- Al menos uno de los dos montos debe ser > 0. Ambos ≥ 0, en colones.
- Es **upsert**: volver a llamarlo reemplaza el valor anterior, no lo suma.

**`GET /apertura`** → `{ "data": null }` si nunca se registró, o
`{ "data": { montoDisponible, montoAhorro, montoTotal, mesCorte, anioCorte, nombreMesCorte, descripcion } }`.

### Formulario sugerido

Un formulario chico en ajustes del módulo (o un botón «Ya tenía ahorros»):

- **«¿Cuánto tenías ya ahorrado?»** → `montoAhorro` (acá van los ₡945.000)
- **«¿Cuánto tenías a mano / disponible?»** → `montoDisponible` (puede ser 0)
- **«¿Desde qué mes llevás las cuentas acá?»** → `mes` / `anio`
- Texto de ayuda: *«Esto no cuenta como ingreso de ningún mes: solo le dice al
  sistema con cuánto arrancaste, para que el ahorro acumulado y el colchón de
  emergencia salgan bien.»*

---

## 3. Campos nuevos en el resumen mensual

`GET /api/finanzas-personales/resumen?mes=&anio=` sigue devolviendo todo lo de
antes y agrega:

| Campo             | Qué es                                                     |
| ----------------- | ---------------------------------------------------------- |
| `ahorroAcumulado` | Total apartado hasta el cierre de ese mes, ya **neto** de retiros (incluye la apertura) |
| `patrimonio`      | `saldoFinal + ahorroAcumulado` → lo que hay a mano **más** lo apartado |
| `apertura`        | `{ montoDisponible, montoAhorro, mesCorte, anioCorte, vigente }` o `null` |
| `totalRetiroAhorro` | Plata sacada del ahorro en el mes (ver §5)                |
| `ahorroNetoMes`   | `totalAhorro − totalRetiroAhorro` (puede ser negativo)     |
| `balanceMes`      | `ingresos − egresos`: lo que el mes generó por sí solo, **sin** retiros |
| `variacionSaldo`  | `balanceMes + totalRetiroAhorro` = `saldoFinal − saldoInicial` |
| `tasaAhorro`      | % sobre el ahorro **neto** (la que vale)                   |
| `tasaAhorroBruta` | % sobre lo apartado, para medir el hábito                  |

Sugerencia de tarjeta nueva: **«Ahorro acumulado»** con `ahorroAcumulado`, y como
subtítulo `patrimonio` («total con lo que tenés a mano»).

`GET /recomendaciones` no cambia de forma. El único mensaje que cambió es el del
colchón de emergencia (🛟), que ahora nombra las dos partes por separado:

> 🛟 Tu colchón (₡440.000 a mano + ₡1.105.000 ahorrados) cubre 3 meses de gastos.

Antes solo miraba la plata a mano, así que con los ahorros apartados habría
seguido diciendo «no tenés colchón», que es falso.

---

## 4. Reporte anual

```
GET /api/finanzas-personales/resumen-anual?anio=2026
```

Para el selector de años: `GET /api/finanzas-personales/anios-disponibles`
(devuelve `{ anios: [2026, ...] }`, siempre incluye el año actual).

### Respuesta

```jsonc
{
  "anio": 2026,
  "enCurso": true,                  // el año todavía no termina

  "totales": {
    "totalIngresos": 1600000,
    "totalGastos": 1120000,         // egresos SIN ahorro (consumo)
    "totalAhorro": 150000,
    "totalEgresos": 1270000,        // gastos + ahorro
    "balance": 330000,              // ingresos − egresos
    "tasaAhorro": 9.4,              // % con 1 decimal
    "movimientos": 10
  },

  "saldoInicialAnio": 0,            // saldo al 1 de enero
  "saldoFinalAnio": 330000,         // = saldoFinal de diciembre
  "ahorroInicioAnio": 0,
  "ahorroFinalAnio": 1095000,
  "patrimonioFinal": 1425000,       // saldoFinal + ahorroFinal

  // Solo si el mes de corte de la apertura cae DENTRO de este año. Es la línea
  // que hace cuadrar los números:
  //   saldoFinalAnio = saldoInicialAnio + apertura.montoDisponible + totales.balance
  "apertura": { "montoDisponible": 0, "montoAhorro": 945000, "mesCorte": 7, "nombreMesCorte": "Julio" },

  // Siempre 12 filas (para la tabla y el gráfico de barras)
  "meses": [
    {
      "anio": 2026, "mes": 7, "nombreMes": "Julio",
      "totalIngresos": 800000, "totalGastos": 500000, "totalAhorro": 100000,
      "totalEgresos": 600000, "balanceMes": 200000,
      "saldoInicial": 0, "saldoFinal": 200000,   // saldo arrastrado mes a mes
      "ahorroAcumulado": 1045000,
      "movimientos": 5,
      "registrado": true,                        // false = mes sin movimientos
      "aperturaAplicada": true                   // acá entró el saldo de apertura
    }
    // ... los 12
  ],

  "desglose": {
    "ingreso": [{ "categoria": "Salario MEP", "total": 1600000, "cantidad": 2, "porcentaje": 100 }],
    "gasto":   [{ "categoria": "Supermercado", "total": 720000, "cantidad": 17, "porcentaje": 64.3 }],
    "ahorro":  [{ "categoria": "Ahorro", "total": 150000, "cantidad": 2, "porcentaje": 100 }]
  },

  "promedios": { "mesesConMovimiento": 2, "ingresos": 800000, "gastos": 560000, "ahorro": 75000 },

  "destacados": {
    "mejorMes":     { "mes": 7, "nombreMes": "Julio", "monto": 200000 },   // mayor balance
    "peorMes":      { "mes": 8, "nombreMes": "Agosto", "monto": 130000 },
    "mesMasCaro":   { "mes": 8, "nombreMes": "Agosto", "monto": 620000 },
    "mesMasIngresos": { "mes": 7, "nombreMes": "Julio", "monto": 800000 },
    "mesMasAhorro": { "mes": 7, "nombreMes": "Julio", "monto": 100000 },
    "categoriaTopGasto": { "categoria": "Supermercado", "total": 720000, "porcentaje": 64.3 },
    "mesesEnRojo": [ /* { mes, nombreMes, balanceMes } de los meses que cerraron negativos */ ]
  },

  // null si el año anterior no tiene datos
  "comparativo": {
    "anio": 2025,
    "totalIngresos": 0, "totalGastos": 0, "totalAhorro": 0, "totalEgresos": 0, "balance": 0,
    "mesesConMovimiento": 0,
    "variacion": { "ingresos": 12.5, "gastos": -3.2, "ahorro": null }  // % (null si no hay base)
  },

  // Mensajes inteligentes del año (máximo 6, ya ordenados por urgencia)
  "mensajes": [{ "nivel": "bien", "icono": "📅", "mensaje": "2026 va bien: tu saldo pasó de ..." }]
}
```

`nivel` es `critico | advertencia | consejo | bien | info` (los mismos que en el
mes, para reusar los colores que ya tenés).

### Notas para la pantalla

- **Promedios**: se calculan solo sobre los meses **con movimientos**
  (`promedios.mesesConMovimiento`), para que un mes vacío no baje el promedio.
- **Meses sin registrar**: vienen en la lista con todo en 0 y `registrado: false`.
  Conviene pintarlos apagados y no como «gastó ₡0».
- **Año en curso** (`enCurso: true`): los totales van solo hasta hoy. La
  comparación contra el año pasado lo aclara en el propio mensaje.
- **Reconciliación**: si `apertura` no es `null`, la fila del mes de corte tiene
  `aperturaAplicada: true` y su `saldoInicial` ya la incluye. Para que el usuario
  entienda de dónde salió el número, vale mostrar una línea
  «Saldo de apertura (julio): ₡945.000 apartados» en la tabla del año.
- **Recorrido del saldo**: el objeto `recorridoSaldo` trae los cuatro términos ya
  listos, y la identidad exacta es:

  ```
  saldoInicialAnio + aperturaDisponible + balance + retiroAhorro = saldoFinalAnio
  ```

  `balance` es `ingresos − egresos` y **no** incluye los retiros: van como término
  aparte a propósito, para que «lo que el año generó» no se confunda con plata que
  solo cambió de bolsillo. Si preferís un solo número, `totales.variacionSaldo` ya
  es `balance + retiroAhorro`.

---

## 5. Retiros de ahorro (`retiro_ahorro`)

Un **tercer tipo de movimiento**, además de `ingreso` y `egreso`. Sacar plata del
ahorro es un **traslado** del bolsillo «apartado» al bolsillo «a mano», no plata
nueva ni un gasto:

| | Efecto |
| --- | --- |
| Saldo a mano (`saldoFinal`) | **+** monto |
| Ahorro acumulado | **−** monto |
| Patrimonio (a mano + apartado) | **0** (no cambia) |
| `totalIngresos` | **no lo toca** |
| `totalGastos` / `totalEgresos` | **no lo tocan** |
| `libreParaGastar` | **no lo toca** |

Que no entre en `totalIngresos` es lo que evita que se rompan los porcentajes del
mes y la comparación contra el mes anterior (si contara como ingreso, el mes
siguiente avisaría «tus ingresos bajaron 80%»). Y que no infle `libreParaGastar`
es lo que evita que la tarjeta «Puedo gastar hasta» premie sacar del ahorro. Si
después esa plata se gasta, eso se registra aparte como el egreso que sea.

### Alta, edición y borrado

`POST /` y `PUT /:id` aceptan `tipo: "retiro_ahorro"`. Body igual que cualquier
movimiento:

```json
{ "tipo": "retiro_ahorro", "categoria": "Ahorro", "monto": 200000, "mes": 7, "anio": 2026,
  "descripcion": "Para la reparación del carro" }
```

- `categoria` debe ser una de las de ahorro (de qué bolsa salió la plata):
  `Ahorro`, `Ahorro CreAI`, `Ahorro MEP`. Vienen en `GET /categorias` bajo la
  clave `retiro_ahorro`.
- Dólares igual que el resto: `moneda: "USD"` + `montoOriginal` + `tipoCambio`.
- `GET /` (lista del mes) los devuelve como cualquier movimiento, con su `tipo`.
  El filtro `?tipo=retiro_ahorro` también funciona.

### Validación: el ahorro nunca puede quedar negativo

No se puede retirar más de lo acumulado. El chequeo no mira solo el mes del
retiro: recorre **todos** los meses, porque bajar el ahorro de un mes viejo puede
romper un retiro posterior. Devuelve **400** con un `message` ya redactado para
mostrárselo al usuario, más el número exacto para limitar el campo:

```json
{ "message": "Solo podés sacar ₡449.500: es lo que te queda en el ahorro a junio 2026.",
  "disponible": 449500, "acumulado": 500000 }
```

| Campo | Qué es |
| --- | --- |
| `disponible` | **Tope de ESTE movimiento.** Ojo: no es el acumulado del mes — si ya había otros retiros ese mes, lo que queda es menos. Este es el número para limitar el input. |
| `acumulado` | Ahorro acumulado a ese mes, informativo |
| `minimo` | En vez de `disponible` cuando el problema es que se está **bajando** un ahorro o el saldo de apertura: el valor más bajo al que puede quedar |

Se valida en las cuatro puertas:

| Acción | Se rechaza si… | Trae |
| --- | --- | --- |
| Crear un retiro | pasa lo que queda acumulado a ese mes | `disponible` |
| Editar un retiro (monto o mes) | el cambio deja algún mes en negativo | `disponible` |
| Bajar o reclasificar un **ahorro** | un retiro posterior ya usaba esa plata | `minimo` |
| Borrar un movimiento de **ahorro** | ídem (dice qué retiro tocar primero) | `minimo` |
| Bajar / mover / borrar el saldo de apertura | un retiro ya usaba ese ahorro | `minimo` |

### Mensajes inteligentes

- Mensaje nuevo 🏧 cuando hubo retiro en el mes (y su versión anual).
- El aviso 🚨 de sobregiro ahora dice la verdad: si el hueco se tapó con un
  retiro, lo nombra en vez de decir «lo estás tapando con el saldo de meses
  anteriores».
- Las tasas de ahorro y el colchón 🛟 usan el acumulado **neto**.

### Ejemplo real: `GET /resumen?mes=7&anio=2026`

Junio: ingresos ₡800.000, gastos ₡500.000, ahorro ₡100.000.
Julio: ingresos ₡800.000, gastos ₡900.000, **retiro ₡200.000**.
Apertura: ₡945.000 apartados desde junio.

```json
{
  "mes": 7, "anio": 2026,
  "saldoInicial": 200000,
  "totalIngresos": 800000,
  "totalRetiroAhorro": 200000,
  "disponible": 1200000,
  "totalGastos": 900000,
  "totalAhorro": 0,
  "ahorroNetoMes": -200000,
  "totalEgresos": 900000,
  "saldoFinal": 300000,
  "balance": 300000,
  "balanceMes": -100000,
  "variacionSaldo": 100000,
  "libreParaGastar": -100000,
  "ahorroAcumulado": 845000,
  "patrimonio": 1145000,
  "tasaAhorro": -25,
  "tasaAhorroBruta": 0,
  "desglose": {
    "ingreso": [{ "categoria": "Salario MEP", "total": 800000, "cantidad": 1 }],
    "egreso": [
      { "categoria": "Supermercado", "total": 400000, "cantidad": 9 },
      { "categoria": "Salud", "total": 500000, "cantidad": 1 }
    ],
    "retiro": [{ "categoria": "Ahorro", "total": 200000, "cantidad": 1, "porcentaje": 100 }]
  },
  "apertura": { "montoDisponible": 0, "montoAhorro": 945000, "mesCorte": 6, "anioCorte": 2026, "vigente": true }
}
```

Comprobaciones: `disponible` = 200.000 + 800.000 + 200.000. `saldoFinal` =
1.200.000 − 900.000. El patrimonio no cambió por retirar (era 100.000 + 1.045.000
al cerrar junio, ahora 300.000 + 845.000 = 1.145.000 en julio, más el flujo del mes).

### Ejemplo real: `GET /resumen-anual?anio=2026` (mismo escenario)

```json
{
  "anio": 2026, "enCurso": true,
  "totales": {
    "totalIngresos": 1600000, "totalGastos": 1400000,
    "totalAhorro": 100000, "totalRetiroAhorro": 200000, "ahorroNeto": -100000,
    "totalEgresos": 1500000, "movimientos": 10,
    "balance": 100000, "variacionSaldo": 300000,
    "tasaAhorro": -6.3, "tasaAhorroBruta": 6.3
  },
  "saldoInicialAnio": 0, "saldoFinalAnio": 300000,
  "ahorroInicioAnio": 0, "ahorroFinalAnio": 845000,
  "patrimonioFinal": 1145000,
  "recorridoSaldo": {
    "saldoInicialAnio": 0, "aperturaDisponible": 0,
    "balance": 100000, "retiroAhorro": 200000, "saldoFinalAnio": 300000
  },
  "apertura": { "montoDisponible": 0, "montoAhorro": 945000, "mesCorte": 6, "nombreMesCorte": "Junio" },
  "meses": [
    { "anio": 2026, "mes": 6, "nombreMes": "Junio", "totalIngresos": 800000, "totalGastos": 500000,
      "totalAhorro": 100000, "totalRetiroAhorro": 0, "ahorroNetoMes": 100000, "totalEgresos": 600000,
      "balanceMes": 200000, "variacionSaldo": 200000, "saldoInicial": 0, "saldoFinal": 200000,
      "ahorroAcumulado": 1045000, "movimientos": 5, "aperturaAplicada": true, "registrado": true },
    { "anio": 2026, "mes": 7, "nombreMes": "Julio", "totalIngresos": 800000, "totalGastos": 900000,
      "totalAhorro": 0, "totalRetiroAhorro": 200000, "ahorroNetoMes": -200000, "totalEgresos": 900000,
      "balanceMes": -100000, "variacionSaldo": 100000, "saldoInicial": 200000, "saldoFinal": 300000,
      "ahorroAcumulado": 845000, "movimientos": 5, "aperturaAplicada": false, "registrado": true }
  ],
  "desglose": {
    "ingreso": [{ "categoria": "Salario MEP", "total": 1600000, "cantidad": 2, "porcentaje": 100 }],
    "gasto": [
      { "categoria": "Supermercado", "total": 700000, "cantidad": 17, "porcentaje": 50 },
      { "categoria": "Salud", "total": 500000, "cantidad": 1, "porcentaje": 35.7 },
      { "categoria": "Vivienda/Alquiler", "total": 200000, "cantidad": 1, "porcentaje": 14.3 }
    ],
    "ahorro": [{ "categoria": "Ahorro", "total": 100000, "cantidad": 1, "porcentaje": 100 }],
    "retiro": [{ "categoria": "Ahorro", "total": 200000, "cantidad": 1, "porcentaje": 100 }]
  },
  "promedios": { "mesesConMovimiento": 2, "ingresos": 800000, "gastos": 700000, "ahorro": 50000 },
  "destacados": {
    "mejorMes": { "mes": 6, "nombreMes": "Junio", "monto": 200000 },
    "peorMes": { "mes": 7, "nombreMes": "Julio", "monto": -100000 },
    "mesMasCaro": { "mes": 7, "nombreMes": "Julio", "monto": 900000 },
    "mesMasIngresos": { "mes": 6, "nombreMes": "Junio", "monto": 800000 },
    "mesMasAhorro": { "mes": 6, "nombreMes": "Junio", "monto": 100000 },
    "mesMasRetiro": { "mes": 7, "nombreMes": "Julio", "monto": 200000 },
    "categoriaTopGasto": { "categoria": "Supermercado", "total": 700000, "cantidad": 17, "porcentaje": 50 },
    "mesesEnRojo": [{ "mes": 7, "nombreMes": "Julio", "balanceMes": -100000 }]
  },
  "comparativo": null,
  "mensajes": [ /* … */ ]
}
```

`mesMasRetiro` es `null` si el año no tuvo retiros. En `comparativo` se agregaron
`totalRetiroAhorro` y `ahorroNeto`, y `variacion.ahorro` compara **neto contra
neto**.
