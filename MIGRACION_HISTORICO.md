# 📚 Migración del histórico del Excel (mar 2024 – feb 2026)

Antes de este sistema, el control de la sala se llevaba en un Excel
(`Sala de juegos Oficial.xlsx`), una hoja por mes. En **julio 2026** se importaron
esos datos históricos a la base para que los reportes muestren la historia completa.

- **Qué se importó:** cada **sesión (play) real** de marzo 2024 a febrero 2026 →
  **3.501 sesiones**, total **₡3.516.535** (sin helados).
- **Cómo quedan marcadas:** cada registro migrado tiene el campo
  **`origen: 'excel_historico'`** en la colección `plays`. Los plays normales del
  sistema tienen `origen: null`.
- **Helados/gelatinas:** se **omitieron** (no calzan en el modelo de plays; eran
  ventas sin costo registrado).
- **Febrero 2026:** se conservaron los ₡4.500 de plays reales que ya existían; el
  mes quedó en **₡104.350** (₡99.850 migrados + ₡4.500 reales).

Los scripts viven en `scripts/`:
- `scripts/parseHistoricoExcel.js` — lee el Excel (24 hojas, 3 layouts distintos) y
  reconcilia cada mes contra los totales auditados.
- `scripts/migrarHistoricoExcel.js` — comandos `parse | backup | verificar | migrar | rollback`.

---

## ⚠️ Caso importante: ¿qué pasa si la base se llena algún día?

El plan gratuito de MongoDB Atlas (M0) tiene **512 MB**. Las 3.501 sesiones
históricas ocupan solo **~2 a 4 MB** (menos del 1%), así que **por espacio no hay
urgencia**. Pero si en el futuro la base se acerca al límite, se puede recuperar ese
espacio borrando los datos históricos. **Esa es una decisión con consecuencias** que
conviene entender antes de tomarla.

### Cómo borrar el histórico (si algún día se decide)

Desde una terminal PowerShell normal, en la carpeta del proyecto:

```bash
node scripts/migrarHistoricoExcel.js rollback
```

Esto borra **solo** los registros con `origen: 'excel_historico'` (no toca ninguna
sesión real) y regenera los reportes de esos 24 meses.

> 💡 **Nota de conexión:** la máquina local puede fallar con
> `querySrv ECONNREFUSED` porque algunos ISP/routers no resuelven `mongodb+srv`.
> El script ya fuerza DNS público (Google/Cloudflare) para evitarlo. Los comandos
> se corren en una terminal normal de Windows, **no** dentro de Claude (Claude no
> tiene salida de red hacia Atlas).

### 🔴 Consecuencia: se pierde la historia en los reportes

Los reportes **se calculan a partir de las sesiones**; las sesiones son la fuente de
verdad. Si se borran los plays históricos:

| Reporte | Qué pasa al borrar los plays |
|---|---|
| **Mensual de plays / ganancia por consola / comparativo anual** | Quedan guardados y **siguen mostrando** los números… hasta que algo los regenere (editar una sesión de ese mes, o un backfill futuro). Datos "huérfanos" e inconsistentes. |
| **Estado de resultados** | **Se recalcula a ₡0** en el próximo reinicio del servidor. Tiene una "red de seguridad" (`backfillEstadoResultados`) que al arrancar regenera todos los meses desde los datos crudos, para que el reporte financiero **nunca muestre números falsos**. Al no haber sesiones, da cero. |

En resumen: **borrar el histórico = perder la historia en los reportes.** No es un
bug; el sistema está hecho para que los reportes reflejen siempre la realidad.

### ✅ Mejor alternativa si la molestia es "ver muchas sesiones viejas"

Si el problema NO es espacio sino que las 3.500 sesiones históricas ensucian la lista
de plays del día a día, **no hace falta borrarlas**. La marca `origen='excel_historico'`
permite **filtrarlas/ocultarlas en el frontend**: la lista diaria muestra solo lo
nuevo, pero los reportes siguen usando todo el histórico. (Además, la lista va
ordenada de más nueva a más vieja, así que las históricas ya quedan al final.)

---

## 🔁 Cómo volver a importar (si hiciera falta)

El proceso es idempotente. Con el Excel en la raíz del proyecto:

```bash
node scripts/migrarHistoricoExcel.js parse      # 1. lee y reconcilia (NO toca la base)
node scripts/migrarHistoricoExcel.js backup     # 2. respalda los reportes actuales
node scripts/migrarHistoricoExcel.js migrar     # 3. reconcilia + inserta + regenera + verifica
```

`migrar` **aborta solo** si algún mes no cuadra contra los totales auditados
(checksum **₡3.516.535**), así nunca importa datos que no sumen.


---

# 📒 Segunda importación: libro de contabilidad (mar 2021 – mar 2026)

Además del Excel de plays, la sala llevó un **libro de contabilidad**
(`Contabilidad Sala de Juegos Ruiz.xlsb`, una hoja por mes). Esta segunda
importación **solo AGREGA lo que el sistema no tiene**; lo que ya existe es lo real
y no se modifica ni se borra. Todo lo agregado lleva **`origen: 'excel_contabilidad'`**
(plays, ganancias, pagos, activos y las fichas de juego nuevas), así `rollback`
borra únicamente eso.

## Qué se carga

| Qué | Cómo queda en el sistema |
|---|---|
| **Plays** mar-2021 a feb-2024 (₡3.397.710) | Un play por día con su monto (si el día trae PS4 y PS5, uno por consola). Antes de 2023-10 el Excel no distingue consola: quedan como Play 4. Cliente y atendió = "Histórico". |
| **Máquinas** | `Ganancia` mensual: `Maquinas Chinos` (2021-04..2025-10), `Maquinas Zapata` (2024-07..2025-10), `Futbolin` (2021-05..2025-10), más Zapata/Futbolín de los meses de 2025-11 a 2026-04 donde el sistema solo tenía Chinos (si el sistema ya tiene ese tipo en el mes, no se agrega). |
| **Peluches** y **Torneos** | `Ganancia` con los tipos nuevos `Peluches` y `Torneos`. |
| **Gastos** | `PagoServicio` (Luz, Internet, Patente, Mantenimiento General y el servicio nuevo `Otros`) hasta 2026-03, incluidos los personales. **No** se cargan las cuotas de la Pantalla Xiaomi (el activo ya está en el sistema) ni la Regleta General Electric (se carga como activo). |
| **Activos** | 55 del inventario del Excel sin pareja en el sistema. Los juegos se ligan a la ficha del catálogo si ya existe (no se duplican) y solo se crean fichas para los juegos que faltan. Placa: la siguiente del contador, igual que al crear un activo a mano. |
| **No se carga** | Ventas 2021-2025, ahorro, mayo 2026 (copia de abril), ping pong, y los activos dudosos. |

Se agregó `origen` (default `null`) a `Ganancia`, `PagoServicio` y `ActivoSala`, y
los valores nuevos `Peluches`/`Torneos` (ganancias), `Otros` (pagos) y
`excel_contabilidad` (origen de fichas de juego).

## Comandos

El .xlsb no se lee desde Node: primero un paso en Python lo vuelca a un JSON.

```bash
# 1. Excel -> JSON intermedio (no toca la base)
python -I scripts/contabilidad/extraer_contabilidad.py <ruta.xlsb> <salida.json> <contabilidad_por_mes.csv>

# 2. PRUEBA (dry-run): arma todo, cuadra totales, compara contra la base. SOLO LEE.
node scripts/importarContabilidadExcel.js prueba [salida.json] [resumen.md]

# 3. Solo si la prueba cuadra y el dueño aprueba:
node scripts/importarContabilidadExcel.js cargar      # backup + inserta + regenera reportes + verifica

# 4. Volver atrás: borra solo origen 'excel_contabilidad' y regenera reportes
node scripts/importarContabilidadExcel.js rollback
```

- `prueba` escribe un resumen (categorías, cuadre, estado de resultados antes/después,
  tabla de juegos, activos y placas) y **no escribe nada en la base**.
- `cargar` aborta si el cuadre no da diferencia 0 o si las placas chocan; es
  idempotente (si ya hay registros con ese origen, no los duplica).
- `rollback` conserva una ficha de juego si algún activo la usa y no baja el
  contador de placas (quedan huecos, es inocuo).
- También existen `backup` y `verificar`.
