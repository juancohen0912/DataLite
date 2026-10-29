// Reconoce departamentos y municipios de Colombia en una columna, aunque se escriban distinto
// («Valle», «Bogotá D.C.», «Cúcuta», «05», «San Andrés»). Sin coordenadas: el dibujo se carga aparte.
import { DEPT_LIST, MUNI_LIST } from './geo-names.js';

export const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[.,()]/g, ' ').replace(/\b(departamento|depto|dpto|del|de|y)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();

const DEPT_ALIASES = {
  '11': ['bogota', 'bogota d c', 'bogota dc', 'santafe bogota', 'santa fe bogota', 'distrito capital', 'dc'],
  '76': ['valle', 'valle cauca'],
  '88': ['san andres', 'san andres providencia', 'archipielago san andres', 'san andres isla', 'san andres providencia santa catalina'],
  '44': ['guajira', 'la guajira'],
  '54': ['norte santander', 'n santander'],
  '63': ['quindio'],
};
const deptByKey = new Map();
for (const [code, name] of DEPT_LIST) {
  deptByKey.set(norm(name), code);
  deptByKey.set(code, code);
  deptByKey.set(String(Number(code)), code);
}
for (const [code, list] of Object.entries(DEPT_ALIASES)) for (const a of list) deptByKey.set(norm(a), code);

// Municipios: nombre normalizado → código DIVIPOLA. Si un nombre se repite, gana la capital o el más conocido.
const PREFERRED = new Set(['05615', '05088', '76001', '13001', '47189', '25307', '76147', '41298']);
const CITY_ALIASES = {
  bogota: '11001', 'bogota d c': '11001', 'bogota dc': '11001', 'santafe bogota': '11001', cartagena: '13001', cucuta: '54001',
  tumaco: '52835', buga: '76111', mompox: '13468', 'santiago cali': '76001', 'santa marta': '47001', 'san andres': '88001',
  'san jose guaviare': '95001', 'puerto carreno': '99001', inirida: '94001',
};
const muniByKey = new Map();
const muniName = new Map();
for (const entry of MUNI_LIST.split('|')) {
  const i = entry.indexOf(':');
  const code = entry.slice(0, i), name = entry.slice(i + 1);
  muniName.set(code, name);
  const k = norm(name);
  const prev = muniByKey.get(k);
  if (!prev || PREFERRED.has(code) || (code.endsWith('001') && !PREFERRED.has(prev) && !prev.endsWith('001'))) muniByKey.set(k, code);
  muniByKey.set(code, code);
}
for (const [a, code] of Object.entries(CITY_ALIASES)) muniByKey.set(norm(a), code);

export const deptCode = (v) => deptByKey.get(norm(v)) || null;
export const muniCode = (v) => {
  const n = norm(v);
  if (muniByKey.has(n)) return muniByKey.get(n);
  // «Medellín, Antioquia» o «Medellín - Antioquia»: probar la primera parte
  const first = norm(String(v).split(/[,\-/]/)[0]);
  return muniByKey.get(first) || null;
};
export const muniLabel = (code) => muniName.get(code) || code;

/** Nivel geográfico de una lista de valores: 'dept', 'city' o null (si menos del 60 % se reconoce). */
export function detectGeo(values) {
  const vals = [...new Set(values.filter((v) => v !== null && v !== undefined && v !== '').map(String))].slice(0, 400);
  if (vals.length < 3) return null;
  const d = vals.filter((v) => deptCode(v)).length / vals.length;
  const c = vals.filter((v) => muniCode(v)).length / vals.length;
  if (d >= 0.6 && d >= c) return 'dept';
  if (c >= 0.6) return 'city';
  return null;
}

/** Columna con nombre o valores geográficos: devuelve { col, level } o null. */
export function findGeoColumn(columns, rows) {
  const hint = /(departamento|depto|dpto|regi[oó]n|ciudad|municipio|poblaci[oó]n|sede|plaza)/i;
  const order = columns.map((c, i) => i).filter((i) => columns[i].type === 'text').sort((a, b) => (hint.test(columns[b].name) ? 1 : 0) - (hint.test(columns[a].name) ? 1 : 0));
  for (const i of order) {
    const sample = [];
    for (let r = 0; r < rows.length && sample.length < 3000; r += Math.max(1, Math.floor(rows.length / 3000))) sample.push(rows[r][i]);
    const level = detectGeo(sample);
    if (level) return { col: i, level };
  }
  return null;
}
