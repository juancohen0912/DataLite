"""Genera src/lib/geo-colombia.js: contornos simplificados de departamentos (SVG) y centroides de municipios.
Fuente: DANE, Marco Geoestadístico Nacional 2018 (vía github.com/caticoa3/colombia_mapa)."""
import json, math, sys

SRC = sys.argv[1]
OUT = sys.argv[2]
dep = json.load(open(SRC + '/co_2018_MGN_DPTO_POLITICO.geojson'))
mun = json.load(open(SRC + '/co_2018_MGN_MPIO_POLITICO.geojson'))

SA = '88'  # San Andrés: recuadro aparte
LAT0 = 4.5
K = math.cos(math.radians(LAT0))
W = 1000.0

def rings(geom):
    if geom['type'] == 'Polygon': return [geom['coordinates']]
    return geom['coordinates']

# extensión continental
xs, ys = [], []
for f in dep['features']:
    if f['properties']['DPTO_CCDGO'] == SA: continue
    for poly in rings(f['geometry']):
        for lon, lat in poly[0]:
            xs.append(lon * K); ys.append(lat)
minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
S = W / (maxx - minx)
H = (maxy - miny) * S
def proj(lon, lat):
    return ((lon * K - minx) * S, (maxy - lat) * S)

# recuadro de San Andrés (arriba a la izquierda)
sa_pts = [(lon * K, lat) for f in dep['features'] if f['properties']['DPTO_CCDGO'] == SA for poly in rings(f['geometry']) for r in poly for lon, lat in r]
sminx, smaxx = min(p[0] for p in sa_pts), max(p[0] for p in sa_pts)
sminy, smaxy = min(p[1] for p in sa_pts), max(p[1] for p in sa_pts)
INSET = (20, 20, 120, 150)  # x, y, w, h en coordenadas del mapa
ss = min(INSET[2] / (smaxx - sminx), INSET[3] / (smaxy - sminy)) * 0.8
def proj_sa(lon, lat):
    return (INSET[0] + 12 + (lon * K - sminx) * ss, INSET[1] + 12 + (smaxy - lat) * ss)

def dp(points, eps):
    if len(points) < 3: return points
    a, b = points[0], points[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    nrm = math.hypot(dx, dy) or 1e-9
    imax, dmax = 0, 0
    for i in range(1, len(points) - 1):
        p = points[i]
        d = abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / nrm if (dx or dy) else math.hypot(p[0] - a[0], p[1] - a[1])
        if d > dmax: imax, dmax = i, d
    if dmax > eps:
        return dp(points[:imax + 1], eps)[:-1] + dp(points[imax:], eps)
    return [a, b]

def path(geom, pj, eps, minarea):
    out = []
    for poly in rings(geom):
        for ring in poly[:1]:  # solo anillo exterior (sin huecos)
            pts = [pj(lon, lat) for lon, lat in ring]
            area = abs(sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts)))) / 2
            if area < minarea: continue
            s = dp(pts, eps)
            if len(s) < 3: continue
            out.append('M' + 'L'.join(f'{x:.0f},{y:.0f}' for x, y in s) + 'Z')
    return ''.join(out)

def centroid(geom, pj):
    best, cx, cy = 0, 0, 0
    for poly in rings(geom):
        pts = [pj(lon, lat) for lon, lat in poly[0]]
        a = sum(pts[i - 1][0] * pts[i][1] - pts[i][0] * pts[i - 1][1] for i in range(len(pts))) / 2
        if abs(a) > best:
            best = abs(a)
            cx = sum((pts[i - 1][0] + pts[i][0]) * (pts[i - 1][0] * pts[i][1] - pts[i][0] * pts[i - 1][1]) for i in range(len(pts))) / (6 * a)
            cy = sum((pts[i - 1][1] + pts[i][1]) * (pts[i - 1][0] * pts[i][1] - pts[i][0] * pts[i - 1][1]) for i in range(len(pts))) / (6 * a)
    return round(cx), round(cy)

deps = []
for f in sorted(dep['features'], key=lambda f: (f['properties']['DPTO_CCDGO'] == '11', f['properties']['DPTO_CCDGO'])):
    p = f['properties']; code = p['DPTO_CCDGO']
    pj = proj_sa if code == SA else proj
    d = path(f['geometry'], pj, 1.6 if code != SA else 0.6, 6 if code != SA else 0.5)
    cx, cy = centroid(f['geometry'], pj)
    deps.append({'c': code, 'n': p['DPTO_CNMBR'], 'd': d, 'x': cx, 'y': cy})

muns = []
for f in mun['features']:
    p = f['properties']; code = p['DPTO_CCDGO']
    pj = proj_sa if code == SA else proj
    x, y = centroid(f['geometry'], pj)
    muns.append([p['MPIO_CCNCT'], p['MPIO_CNMBR'], x, y])
muns.sort()

js = f"""// Generado por build_geo.py. Fuente: DANE, Marco Geoestadístico Nacional 2018 (información pública).
// Contornos simplificados en coordenadas SVG (proyección equirectangular a {LAT0}° N).
export const GEO_SOURCE = 'Fuente: DANE, MGN 2018';
export const VIEW = {{ w: {W:.0f}, h: {H:.0f} }};
export const SA_INSET = {{ x: {INSET[0]}, y: {INSET[1]}, w: {INSET[2]}, h: {INSET[3]} }};
// [código, nombre, path, centroideX, centroideY]
export const DEPARTMENTS = {json.dumps([[d['c'], d['n'], d['d'], d['x'], d['y']] for d in deps], ensure_ascii=False, separators=(',', ':'))};
// [código DIVIPOLA, nombre, x, y] (centroide del municipio)
export const MUNICIPALITIES = {json.dumps(muns, ensure_ascii=False, separators=(',', ':'))};
"""
open(OUT, 'w', encoding='utf-8').write(js)
print('bytes', len(js.encode()), 'H', round(H), 'deps', len(deps), 'muns', len(muns))

# Índice liviano de nombres para la detección (sin coordenadas)
names_js = "// Generado por build_geo.py. Fuente: DANE, MGN 2018.\n"
names_js += "export const DEPT_LIST = " + json.dumps([[d['c'], d['n']] for d in deps], ensure_ascii=False, separators=(',', ':')) + ";\n"
names_js += "export const MUNI_LIST = " + json.dumps('|'.join(f'{m[0]}:{m[1]}' for m in muns), ensure_ascii=False) + ";\n"
open(OUT.replace('geo-colombia.js', 'geo-names.js'), 'w', encoding='utf-8').write(names_js)
print('names bytes', len(names_js.encode()))
