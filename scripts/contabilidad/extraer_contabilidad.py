# scripts/contabilidad/extraer_contabilidad.py
# Lee "Contabilidad Sala de Juegos Ruiz.xlsb" (SOLO lectura) y deja un JSON
# intermedio con los renglones a cargar. Lo consume importarContabilidadExcel.js.
#
# Uso:  python -I extraer_contabilidad.py <ruta.xlsb> <salida.json> <contabilidad_por_mes.csv>
# (el CSV es el resumen mensual ya conciliado contra la hoja "Ingresos mens. x activ";
#  de ahi salen maquinas, futbolin, peluches y torneos. Plays, gastos e inventario
#  se re-extraen aca renglon por renglon.)
import sys, re, json, csv, datetime
sys.path.append(r"C:\Users\antoy\AppData\Local\Packages\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\LocalCache\local-packages\Python313\site-packages")
from pyxlsb import open_workbook

RUTA, SALIDA, CSV_MES = sys.argv[1], sys.argv[2], sys.argv[3]


def load():
    d = {}
    with open_workbook(RUTA) as wb:
        for h in wb.sheets:
            g = {}
            with wb.get_sheet(h) as sh:
                for row in sh.rows():
                    for c in row:
                        if c.v not in (None, ""):
                            g[(c.r, c.c)] = c.v
            d[h] = g
    return d


D = load()
names = list(D.keys())
SHEETS = [h for h in names[names.index('Mar'):names.index('MAY-26') + 1] if h != 'RESUMEN 2021']


def norm(s):
    return re.sub(r'[^a-z0-9/ ]', '', str(s).lower()).strip()


def serial(v):
    return datetime.date(1899, 12, 30) + datetime.timedelta(days=int(v))


MESES = {}


def seq(ns, y, m0=1):
    for i, n in enumerate(ns):
        mm = m0 + i - 1
        MESES[n] = (y + mm // 12, mm % 12 + 1)


seq(['Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'], 2021, 3)
seq(['Ene', 'Feb', 'Marz', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiemb', 'Octub', 'Noviem', 'Diciem'], 2022)
for i, n in enumerate(['Ene-23', 'Feb-23', 'Mar-23', 'Abr-23', 'May-23', 'Jun-23', 'Jul-23', 'Ago-23', 'Set-23', 'Oct-23', 'Nov-23', 'Dic-23']):
    MESES[n] = (2023, i + 1)
for y in (24, 25):
    for m in range(1, 13):
        MESES['%02d-%d' % (m, y)] = (2000 + y, m)
for i, n in enumerate(['ENE-26', 'FEB-26', 'MAR-26', 'ABR-26', 'MAY-26']):
    MESES[n] = (2026, i + 1)


def hoja_info(h):
    g = D[h]
    hr = min(r for (r, c), v in g.items() if isinstance(v, str) and 'PLAY STATION' in v.upper())
    # primer renglon de datos: primera fecha numerica en la columna A debajo del encabezado
    start = min(r for (r, c), v in g.items() if c == 0 and r > hr and isinstance(v, (int, float)) and v > 40000)
    maxr = max(r for r, c in g)
    end = None
    for r in range(start, maxr + 1):
        v = g.get((r, 0))
        if isinstance(v, str) and re.match(r'\s*(sub\s*total|total)\b', v.lower()):
            end = r
            break
    return g, hr, start, end


def cols_play(g, hr):
    """Devuelve dict col -> 'ps4'|'ps5'|'ctrl' segun el layout de la hoja."""
    r1 = hr + 1
    lab = {c: norm(g[(r1, c)]) for c in range(0, 6) if isinstance(g.get((r1, c)), str)}
    if 'ps4' in lab.values():  # layout 2023-10+: B PS4, C PS5, D controles
        m = {}
        for c, l in lab.items():
            if l == 'ps4':
                m[c] = 'ps4'
            elif l == 'ps5':
                m[c] = 'ps5'
            elif l.startswith('controles'):
                m[c] = 'ctrl'
        return m
    # layouts viejos: B = monto de PlayStation sin desglose; C = control adicional si existe el bloque
    bloques = sorted((c, norm(v)) for (r, c), v in g.items() if r == hr and isinstance(v, str))
    m = {1: 'ps4'}
    for c, b in bloques:
        if b == 'control adicional':
            m[c] = 'ctrl'
    return m


out = {'plays': [], 'gastos': [], 'activos_inventario': [], 'resumen_mes': {}}

# ---- PLAYS por dia (2021-03 .. 2024-02) ----
for h in SHEETS:
    y, m = MESES[h]
    if (y, m) >= (2024, 3):
        continue
    g, hr, start, end = hoja_info(h)
    cm = cols_play(g, hr)
    por_dia = {}
    for r in range(start, end):
        f = g.get((r, 0))
        if not isinstance(f, (int, float)) or f < 40000:
            continue
        d = serial(f)
        reg = por_dia.setdefault(d.isoformat(), {'ps4': 0, 'ps5': 0, 'ctrl': 0})
        for c, k in cm.items():
            v = g.get((r, c))
            if isinstance(v, (int, float)):
                reg[k] += v
    for fecha, reg in sorted(por_dia.items()):
        tot = reg['ps4'] + reg['ps5'] + reg['ctrl']
        if tot <= 0:
            continue
        out['plays'].append({'fecha': fecha, 'hoja': h, 'mes_hoja': '%d-%02d' % (y, m),
                             'ps4': reg['ps4'], 'ps5': reg['ps5'], 'ctrl': reg['ctrl'],
                             'sin_desglose': (y, m) < (2023, 10)})


# ---- GASTOS (bloque Gastos de cada hoja; el filtro de meses lo hace Node) ----
def find_text(g, r0, pat):
    return sorted((r, c) for (r, c), v in g.items() if r >= r0 and isinstance(v, str) and re.match(pat, norm(v)))


def tot_row(g, start):
    for r in range(start, max(r for r, c in g) + 1):
        v = g.get((r, 0))
        if isinstance(v, str) and re.match(r'\s*total\s*$', v.lower()):
            return r


def clasif(t):
    t = norm(t)
    if re.search(r'luz|electric', t): return 'luz'
    if 'agua' in t: return 'agua'
    if 'internet' in t: return 'internet'
    if 'patente' in t: return 'patente'
    if re.search(r'aseo|limpieza', t): return 'aseo'
    if re.search(r'gelat|conos', t): return 'insumos_helados'
    if 'chapia' in t: return 'chapia'
    if re.search(r'^plan|^u |compu|prestamo|peluquiar|carne|moto|pantalla', t): return 'personal_otros'
    if re.search(r'pago|estiven|leda|antoyef|jared', t): return 'pago_personas'
    return 'otros'


for h in SHEETS:
    y, m = MESES[h]
    g, hr, start, end = hoja_info(h)
    tr = tot_row(g, start) or end
    gas = find_text(g, tr + 1, r'gastos$')
    if not gas:
        continue
    r0, c0 = gas[0]
    for r in range(r0 + 1, r0 + 40):
        lab = g.get((r, c0))
        if isinstance(lab, str) and norm(lab).startswith('total'):
            break
        amt = g.get((r, c0 + 2))
        dt = g.get((r, c0 + 1))
        if isinstance(amt, (int, float)):
            f_usada = None
            if isinstance(dt, (int, float)) and dt > 40000:
                d = serial(dt)
                if (d.year, d.month) == (y, m):
                    f_usada = d.isoformat()
            if f_usada is None:
                f_usada = datetime.date(y, m, 15).isoformat()
            if isinstance(dt, (int, float)) and dt > 40000:
                raw = serial(dt).isoformat()
            else:
                raw = str(dt) if dt is not None else None
            out['gastos'].append({'mes_hoja': '%d-%02d' % (y, m),
                                  'concepto': str(lab).strip() if lab is not None else '',
                                  'clase': clasif(str(lab) if lab is not None else ''),
                                  'monto': amt, 'fecha_raw': raw, 'fecha': f_usada})

# ---- Resumen mensual (maquinas, futbolin, peluches, torneos) ----
with open(CSV_MES, encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        def n(k):
            v = row.get(k, '')
            return float(v) if v not in ('', None) else 0.0
        out['resumen_mes'][row['mes']] = {
            'plays_total': n('plays_total'), 'monedas': n('maq_monedas') + n('maq_chino'), 'zapata': n('maq_zapata'),
            'futbolin': n('futbolin'), 'peluches': n('maq_peluches'), 'torneos': n('torneos'),
            'pingpong': n('maq_pingpong'), 'gastos_total': n('gastos_total')}

# ---- INVENTARIO (hoja Inventario) ----
g = D['Inventario']


def sd(v):
    return str(serial(v)) if isinstance(v, (int, float)) else None


sec = None
for r in range(4, 142):
    e = g.get((r, 4))
    dcol = g.get((r, 3))
    l = g.get((r, 11))
    if isinstance(e, str) and dcol is None and l is None and g.get((r, 0)) is None:
        sec = e.strip()
        continue
    if not isinstance(e, str) or e.strip().lower() == 'total' or not isinstance(l, (int, float)):
        continue
    out['activos_inventario'].append({'fila': r + 1, 'seccion': sec, 'nombre': e.strip(), 'costo': l,
                                      'compra': sd(g.get((r, 0))), 'proveedor': g.get((r, 5)), 'serie': g.get((r, 6)),
                                      'modelo': g.get((r, 7)), 'marca': g.get((r, 8)), 'carac': g.get((r, 9)),
                                      'notas': g.get((r, 10))})
json.dump(out, open(SALIDA, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=str)
print('plays', len(out['plays']), 'gastos', len(out['gastos']), 'inventario', len(out['activos_inventario']))
