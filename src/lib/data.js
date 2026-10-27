import { evalMeasure, finalize } from './formula.js';
// Lectura, limpieza y agregación de datos. Todo ocurre en el navegador.

export const MAX_FILE_MB = 30;
export const MAX_ROWS = 300000;
// ---------- Lectura de archivos ----------

function detectDelimiter(text) {
  const firstLines = text.split(/\r?\n/).slice(0, 5).join('\n');
  const candidates = [',', ';', '\t', '|'];
  let best = ',', bestCount = 0;
  for (const d of candidates) {
    let count = 0, inQ = false;
    for (const ch of firstLines) {
      if (ch === '"') inQ = !inQ;
      else if (ch === d && !inQ) count++;
    }
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = detectDelimiter(text);
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === d) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
      if (rows.length > MAX_ROWS + 1) break;
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function decodeText(buffer) {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  // Si hay caracteres de reemplazo, probablemente es un CSV de Excel en Windows-1252.
  if (utf8.includes('�')) {
    try { return new TextDecoder('windows-1252').decode(buffer); } catch { /* sin soporte */ }
  }
  return utf8;
}

/** Devuelve { sheets: [{ name, aoa }] } */
export async function readFile(file) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    throw new Error(`El archivo pesa ${(file.size / 1048576).toFixed(1)} MB. El máximo es ${MAX_FILE_MB} MB.`);
  }
  const name = file.name.toLowerCase();
  const buffer = await file.arrayBuffer();
  if (/\.(csv|txt|tsv)$/.test(name)) {
    return { sheets: [{ name: file.name.replace(/\.[^.]+$/, ''), aoa: parseCSV(decodeText(buffer)) }] };
  }
  if (/\.(xls|xlsb)$/.test(name)) {
    throw new Error('Los archivos .xls antiguos no son compatibles. Ábrelo en Excel y usa «Guardar como» .xlsx o CSV.');
  }
  if (!/\.(xlsx|xlsm|ods)$/.test(name)) {
    throw new Error('Formato no compatible. Usa .xlsx, .ods o .csv.');
  }
  const { readWorkbook } = await import('./xlsx.js');
  const sheets = await readWorkbook(buffer, name.split('.').pop(), MAX_ROWS + 1);
  return { sheets };
}

// ---------- Construcción de la tabla ----------

const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

export function buildTable(aoa) {
  // Encabezado: primera fila con al menos 2 celdas llenas dentro de las 10 primeras.
  let headerIdx = 0;
  for (let i = 0; i < Math.min(10, aoa.length); i++) {
    if (aoa[i].filter((c) => !isBlank(c)).length >= 2) { headerIdx = i; break; }
  }
  const rawHeader = aoa[headerIdx] || [];
  const body = aoa.slice(headerIdx + 1).filter((r) => r.some((c) => !isBlank(c)));
  const width = Math.max(rawHeader.length, ...body.slice(0, 200).map((r) => r.length));
  const seen = new Map();
  const headers = [];
  for (let c = 0; c < width; c++) {
    let h = String(rawHeader[c] ?? '').trim() || `Columna ${colLetter(c)}`;
    if (seen.has(h)) { seen.set(h, seen.get(h) + 1); h = `${h} (${seen.get(h)})`; } else seen.set(h, 1);
    headers.push(h);
  }
  // Quitar columnas totalmente vacías
  const keep = headers.map((_, c) => body.some((r) => !isBlank(r[c])));
  const cols = headers.filter((_, c) => keep[c]);
  const truncated = body.length > MAX_ROWS;
  const rows = body.slice(0, MAX_ROWS).map((r) => headers.map((_, c) => r[c]).filter((_, c) => keep[c]));
  const columns = profileColumns(cols, rows);
  // Normalizar valores según el tipo detectado
  columns.forEach((col, ci) => {
    if (col.type === 'number') for (const r of rows) r[ci] = toNumber(r[ci], col.decimalComma);
    else if (col.type === 'date') for (const r of rows) r[ci] = toDate(r[ci], col.dayFirst);
    else for (const r of rows) r[ci] = isBlank(r[ci]) ? '' : String(r[ci]).trim();
  });
  columns.forEach((col, ci) => {
    const set = new Set();
    for (const r of rows) set.add(r[ci] instanceof Date ? r[ci].getTime() : r[ci]);
    col.unique = set.size;
  });
  return { columns, rows, truncated };
}

export function colLetter(i) {
  let s = '';
  i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

// ---------- Tipos ----------

const NUM_RE = /^[\s(]*[-+]?[\s$€£¥]*(?:COP|USD|EUR|MXN)?\s*[\d.,\s']+\s*%?[)\s]*$/i;
const DATE_ISO = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
const DATE_DMY = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

function profileColumns(names, rows) {
  const sample = rows.length > 3000 ? rows.filter((_, i) => i % Math.ceil(rows.length / 3000) === 0) : rows;
  return names.map((name, ci) => {
    let filled = 0, nums = 0, dates = 0, commaDec = 0, dotDec = 0, dayFirstVotes = 0, monthFirstVotes = 0;
    for (const r of sample) {
      const v = r[ci];
      if (isBlank(v)) continue;
      filled++;
      if (v instanceof Date) { dates++; continue; }
      if (typeof v === 'number') { nums++; continue; }
      const s = String(v).trim();
      if (DATE_ISO.test(s)) { dates++; continue; }
      const m = s.match(DATE_DMY);
      if (m) {
        dates++;
        if (+m[1] > 12) dayFirstVotes++; else if (+m[2] > 12) monthFirstVotes++;
        continue;
      }
      if (NUM_RE.test(s) && /\d/.test(s)) {
        nums++;
        if (/\d,\d{1,2}\s*%?\)?$/.test(s) || /\d\.\d{3},/.test(s)) commaDec++;
        else if (/\d\.\d{1,2}\s*%?\)?$/.test(s) || /\d,\d{3}\./.test(s)) dotDec++;
        else if (/^\d{1,3}(\.\d{3})+$/.test(s)) commaDec++;
        else if (/^\d{1,3}(,\d{3})+$/.test(s)) dotDec++;
      }
    }
    let type = 'text';
    if (filled && dates / filled >= 0.8) type = 'date';
    else if (filled && nums / filled >= 0.85) type = 'number';
    // Columnas de códigos (IDs, NIT, teléfonos) se tratan como texto
    if (type === 'number' && /(^|\b)(id|c[oó]d(igo)?|nit|c[eé]dula|tel[eé]fono|celular|documento|zip|postal)(\b|$)/i.test(name)) type = 'text';
    return {
      name,
      type,
      filled,
      nulls: sample.length - filled,
      decimalComma: commaDec > dotDec,
      dayFirst: dayFirstVotes >= monthFirstVotes, // en Latinoamérica predomina dd/mm/aaaa
    };
  });
}

export function toNumber(v, decimalComma = false) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (isBlank(v) || v instanceof Date) return null;
  let s = String(v).trim();
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[\s$€£¥]/g, ''));
  const pct = s.includes('%');
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (decimalComma) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  let n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  if (neg) n = -n;
  if (pct) n = n / 100;
  return n;
}

function toDate(v, dayFirst = true) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (isBlank(v)) return null;
  if (typeof v === 'number') return null;
  const s = String(v).trim();
  let m = s.match(DATE_ISO);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  m = s.match(DATE_DMY);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    const a = +m[1], b = +m[2];
    const [d, mo] = dayFirst ? [a, b] : [b, a];
    return new Date(y, mo - 1, d, +(m[4] || 0), +(m[5] || 0));
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

// ---------- Sugerencias automáticas ----------

const ID_LIKE = /(^|\b)(id|n[uú]mero|no\.?|#|item|consecutivo|a[nñ]o|year|mes|d[ií]a)(\b|$)/i;

export function suggest(columns, rows) {
  const n = rows.length || 1;
  const cats = columns
    .map((c, i) => ({ ...c, i }))
    .filter((c) => c.type === 'text' && c.unique >= 2 && c.unique <= Math.max(60, n * 0.2))
    .sort((a, b) => score(a) - score(b));
  function score(c) {
    // Preferimos entre 3 y 15 categorías, con pocos vacíos
    const ideal = c.unique >= 3 && c.unique <= 15 ? 0 : Math.abs(c.unique - 9);
    return ideal + c.nulls / n * 20;
  }
  const metrics = columns
    .map((c, i) => ({ ...c, i }))
    .filter((c) => c.type === 'number' && !ID_LIKE.test(c.name) && c.unique > 2);
  // Preferir métricas con nombres de negocio
  metrics.sort((a, b) => metricRank(b) - metricRank(a));
  function metricRank(c) {
    let r = 0;
    if (/(venta|ingreso|total|valor|monto|importe|facturad|utilidad|ganancia|revenue|sales|amount|producci[oó]n|crudo|bbl|barril)/i.test(c.name)) r += 6;
    else if (/(cantidad|unidades|gasto|costo)/i.test(c.name)) r += 3;
    // Precios unitarios, tasas y porcentajes no deben sumarse
    if (/(unitari|precio|tasa|%|porcentaje|bsw|ratio|promedio|edad)/i.test(c.name)) r -= 4;
    return r + Math.min(c.unique / 50, 3);
  }
  const dates = columns.map((c, i) => ({ ...c, i })).filter((c) => c.type === 'date');
  return {
    group: cats[0]?.i ?? columns.findIndex((c) => c.type === 'text') ?? 0,
    metric: metrics[0]?.i ?? -1,
    categories: cats.map((c) => c.i),
    metrics: metrics.map((c) => c.i),
    dates: dates.map((c) => c.i),
  };
}

// ---------- Filtros y agregación ----------

// Filtros: por valores ({col, values}) o por rango de fechas ({col, from, to} en formato AAAA-MM-DD)
const dayStart = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
export function applyFilters(rows, filters) {
  const tests = [];
  for (const f of filters) {
    if (f.values && f.values.length) { const set = new Set(f.values); tests.push((r) => set.has(keyOf(r[f.col]))); }
    else if (f.from || f.to) {
      const lo = f.from ? dayStart(f.from) : -Infinity;
      const hi = f.to ? dayStart(f.to) + 86400000 : Infinity;
      tests.push((r) => { const d = r[f.col]; if (!(d instanceof Date)) return false; const t = d.getTime(); return t >= lo && t < hi; });
    }
  }
  if (!tests.length) return rows;
  return rows.filter((r) => tests.every((t) => t(r)));
}

export function dateRange(rows, col) {
  let min = Infinity, max = -Infinity;
  for (const r of rows) { const d = r[col]; if (d instanceof Date) { const t = d.getTime(); if (t < min) min = t; if (t > max) max = t; } }
  if (!Number.isFinite(min)) return null;
  return { min: new Date(min), max: new Date(max) };
}
export const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function keyOf(v) {
  if (v instanceof Date) return isoDay(v);
  if (v === null || v === undefined || v === '') return '(vacío)';
  return String(v);
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function dateBucket(d, gran) {
  if (!(d instanceof Date)) return { key: '(sin fecha)', label: '(sin fecha)' };
  const y = d.getFullYear(), m = d.getMonth();
  if (gran === 'year') return { key: `${y}`, label: `${y}` };
  if (gran === 'quarter') { const q = Math.floor(m / 3) + 1; return { key: `${y}-Q${q}`, label: `T${q} ${y}` }; }
  if (gran === 'day') {
    const k = `${y}-${String(m + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { key: k, label: `${d.getDate()} ${MONTHS[m]} ${y}` };
  }
  return { key: `${y}-${String(m + 1).padStart(2, '0')}`, label: `${MONTHS[m]} ${y}` };
}

export function autoGranularity(rows, col) {
  let min = Infinity, max = -Infinity;
  for (const r of rows) { const d = r[col]; if (d instanceof Date) { const t = d.getTime(); if (t < min) min = t; if (t > max) max = t; } }
  if (!Number.isFinite(min)) return 'month';
  const days = (max - min) / 86400000;
  if (days <= 62) return 'day';
  if (days <= 365 * 3) return 'month';
  if (days <= 365 * 8) return 'quarter';
  return 'year';
}

function newAcc() { return { sum: 0, count: 0, n: 0, min: Infinity, max: -Infinity, distinct: null }; }
function feed(acc, v, agg) {
  acc.count++;
  if (agg === 'DISTINCT') { (acc.distinct ||= new Set()).add(keyOf(v)); return; }
  if (typeof v === 'number') { acc.sum += v; acc.n++; if (v < acc.min) acc.min = v; if (v > acc.max) acc.max = v; }
}
function finish(acc, agg) {
  switch (agg) {
    case 'COUNT': return acc.count;
    case 'DISTINCT': return acc.distinct ? acc.distinct.size : 0;
    case 'AVG': return acc.n ? acc.sum / acc.n : 0;
    case 'MIN': return acc.n ? acc.min : 0;
    case 'MAX': return acc.n ? acc.max : 0;
    default: return acc.sum;
  }
}

/**
 * Tabla dinámica: agrupa por una columna (y opcionalmente por una serie) y calcula la métrica.
 * Devuelve { items: [{key,label,value,byS:{}}], series: [nombres], total }
 */
export function pivot(rows, columns, { group, metric, agg = 'SUM', split = -1, gran = 'month', sort = 'auto', topN = 'ALL', topSeries = 6, measure = null }) {
  if (measure) return pivotMeasure(rows, columns, { group, split, gran, sort, topN, topSeries, measure });
  const isDate = columns[group]?.type === 'date';
  const metricCol = metric >= 0 ? metric : group;
  const effAgg = metric < 0 ? 'COUNT' : agg;
  const map = new Map();
  const totalsBySeries = new Map();
  const overall = newAcc();
  for (const r of rows) {
    let key, label;
    if (isDate) ({ key, label } = dateBucket(r[group], gran));
    else { key = keyOf(r[group]); label = key; }
    let g = map.get(key);
    if (!g) { g = { key, label, acc: newAcc(), series: split >= 0 ? new Map() : null }; map.set(key, g); }
    const v = r[metricCol];
    feed(g.acc, v, effAgg);
    feed(overall, v, effAgg);
    if (split >= 0) {
      const s = keyOf(r[split]);
      let sa = g.series.get(s); if (!sa) { sa = newAcc(); g.series.set(s, sa); }
      feed(sa, v, effAgg);
      let ts = totalsBySeries.get(s); if (!ts) { ts = newAcc(); totalsBySeries.set(s, ts); }
      feed(ts, v, effAgg);
    }
  }
  let series = [];
  if (split >= 0) {
    const ranked = [...totalsBySeries.entries()].map(([k, a]) => [k, finish(a, effAgg)]).sort((a, b) => b[1] - a[1]);
    series = ranked.slice(0, topSeries).map((x) => x[0]);
    if (ranked.length > topSeries) series.push('Otros');
  }
  let items = [...map.values()].map((g) => {
    const it = { key: g.key, label: g.label, value: finish(g.acc, effAgg) };
    if (split >= 0) {
      it.byS = Object.create(null);
      const others = newAcc();
      let hasOthers = false;
      for (const [s, a] of g.series) {
        if (series.includes(s)) it.byS[s] = finish(a, effAgg);
        else { hasOthers = true; mergeAcc(others, a); }
      }
      if (hasOthers) it.byS.Otros = finish(others, effAgg);
    }
    return it;
  });
  // Orden
  if (sort === 'auto') sort = isDate ? 'chrono' : 'value-desc';
  if (sort === 'chrono') items.sort((a, b) => a.key.localeCompare(b.key, 'es', { numeric: true }));
  else if (sort === 'label') items.sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true }));
  else if (sort === 'value-asc') items.sort((a, b) => a.value - b.value);
  else items.sort((a, b) => b.value - a.value);

  const fullCount = items.length;
  if (topN !== 'ALL' && !isDate && items.length > +topN && ['SUM', 'COUNT'].includes(effAgg)) {
    const head = items.slice(0, +topN);
    const tail = items.slice(+topN);
    const other = { key: '__otros__', label: `Otros (${tail.length})`, value: tail.reduce((s, x) => s + x.value, 0), isOther: true };
    if (split >= 0) {
      other.byS = Object.create(null);
      for (const s of series) other.byS[s] = tail.reduce((acc, x) => acc + (x.byS?.[s] || 0), 0);
    }
    items = [...head, other];
  } else if (topN !== 'ALL' && !isDate && items.length > +topN) {
    items = items.slice(0, +topN);
  }
  return { items, series, total: finish(overall, effAgg), fullCount, isDate, agg: effAgg };
}

// Versión para medidas: cada grupo guarda sus filas y la medida se evalúa sobre ellas (como en Power BI)
const measureValue = (measure, rows, idx) => { const v = finalize(evalMeasure(measure, rows, idx)); return typeof v === 'number' ? v : 0; };
function pivotMeasure(rows, columns, { group, split, gran, sort, topN, topSeries, measure }) {
  const isDate = columns[group]?.type === 'date';
  const map = new Map();
  const bySeries = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let key, label;
    if (isDate) ({ key, label } = dateBucket(r[group], gran));
    else { key = keyOf(r[group]); label = key; }
    let g = map.get(key);
    if (!g) { g = { key, label, idx: [], series: split >= 0 ? new Map() : null }; map.set(key, g); }
    g.idx.push(i);
    if (split >= 0) {
      const s = keyOf(r[split]);
      let a = g.series.get(s); if (!a) { a = []; g.series.set(s, a); } a.push(i);
      let t = bySeries.get(s); if (!t) { t = []; bySeries.set(s, t); } t.push(i);
    }
  }
  let series = [];
  if (split >= 0) {
    const ranked = [...bySeries.entries()].map(([k, idx]) => [k, measureValue(measure, rows, idx)]).sort((a, b) => b[1] - a[1]);
    series = ranked.slice(0, topSeries).map((x) => x[0]);
    if (ranked.length > topSeries) series.push('Otros');
  }
  const seriesOf = (seriesMap) => {
    const byS = Object.create(null);
    const others = [];
    for (const [s, idx] of seriesMap) { if (series.includes(s)) byS[s] = measureValue(measure, rows, idx); else others.push(...idx); }
    if (others.length) byS.Otros = measureValue(measure, rows, others);
    return byS;
  };
  let items = [...map.values()].map((g) => {
    const it = { key: g.key, label: g.label, value: measureValue(measure, rows, g.idx), _idx: g.idx };
    if (split >= 0) it.byS = seriesOf(g.series);
    return it;
  });
  if (sort === 'auto') sort = isDate ? 'chrono' : 'value-desc';
  if (sort === 'chrono') items.sort((a, b) => a.key.localeCompare(b.key, 'es', { numeric: true }));
  else if (sort === 'label') items.sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true }));
  else if (sort === 'value-asc') items.sort((a, b) => a.value - b.value);
  else items.sort((a, b) => b.value - a.value);
  const fullCount = items.length;
  if (topN !== 'ALL' && !isDate && items.length > +topN) {
    const tail = items.slice(+topN);
    const idx = tail.flatMap((x) => x._idx);
    const other = { key: '__otros__', label: `Otros (${tail.length})`, value: measureValue(measure, rows, idx), isOther: true };
    if (split >= 0) {
      const m = new Map();
      for (const i of idx) { const s = keyOf(rows[i][split]); let a = m.get(s); if (!a) { a = []; m.set(s, a); } a.push(i); }
      other.byS = seriesOf(m);
    }
    items = [...items.slice(0, +topN), other];
  }
  for (const it of items) delete it._idx;
  return { items, series, total: measureValue(measure, rows, null), fullCount, isDate, agg: 'MEASURE' };
}

function mergeAcc(t, a) {
  t.sum += a.sum; t.count += a.count; t.n += a.n;
  t.min = Math.min(t.min, a.min); t.max = Math.max(t.max, a.max);
  if (a.distinct) { t.distinct ||= new Set(); a.distinct.forEach((x) => t.distinct.add(x)); }
}

export function stats(rows, col) {
  let sum = 0, n = 0, min = Infinity, max = -Infinity;
  for (const r of rows) { const v = r[col]; if (typeof v === 'number') { sum += v; n++; if (v < min) min = v; if (v > max) max = v; } }
  return { sum, n, avg: n ? sum / n : 0, min: n ? min : 0, max: n ? max : 0 };
}

export function distinctValues(rows, col, limit = 500) {
  const counts = new Map();
  for (const r of rows) { const k = keyOf(r[col]); counts.set(k, (counts.get(k) || 0) + 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

// ---------- Formato ----------

const nf = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
export const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) >= 1000 ? nf0.format(v) : nf.format(v)) : String(v ?? ''));
export function fmtShort(v) {
  if (typeof v !== 'number') return String(v);
  const a = Math.abs(v);
  if (a >= 1e9) return nf.format(+(v / 1e9).toFixed(1)) + ' mil M';
  if (a >= 1e6) return nf.format(+(v / 1e6).toFixed(1)) + ' M';
  if (a >= 1e4) return nf.format(+(v / 1e3).toFixed(1)) + ' k';
  return fmt(v);
}

export const AGG_LABELS_ALL = { MEASURE: 'Medida' };
export const AGG_LABELS = {
  SUM: 'Suma', AVG: 'Promedio', COUNT: 'Conteo', DISTINCT: 'Conteo único', MIN: 'Mínimo', MAX: 'Máximo',
};
