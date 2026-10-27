// Configuración de visuales del tablero, sugerencias automáticas y cálculo de cada vista.
import { pivot, stats, autoGranularity, AGG_LABELS, AGG_LABELS_ALL } from '../lib/data.js';
import { evalMeasure, finalize } from '../lib/formula.js';
import { findMeasure, isMeasureRef } from '../lib/model.js';

export const THEMES = {
  datalite: { name: 'DataLite', colors: ['#0E7A55', '#2F6FDE', '#E2A41B', '#D2554B', '#7A5CC9', '#1B9AA3', '#9A7446', '#C2489B', '#5E8C2E', '#6B7C93'] },
  oceano: { name: 'Océano', colors: ['#1D4E89', '#00A6A6', '#F2A541', '#E4572E', '#4F6D7A', '#6CA6C1', '#9BC53D', '#C3423F', '#5B5F97', '#A0A4B8'] },
  atardecer: { name: 'Atardecer', colors: ['#C8553D', '#F28F3B', '#588B8B', '#2D3047', '#E0A458', '#93B7BE', '#8C5383', '#4A6C6F', '#D9B26F', '#7D8491'] },
  corporativo: { name: 'Corporativo', colors: ['#1F3A5F', '#4D7EA8', '#9EB3C2', '#C9A227', '#5C946E', '#A23B72', '#6D6875', '#3E92CC', '#B56576', '#8D99AE'] },
  accesible: { name: 'Accesible (daltonismo)', colors: ['#0072B2', '#E69F00', '#009E73', '#D55E00', '#CC79A7', '#56B4E9', '#F0E442', '#000000', '#999999', '#882255'] },
};

export const VISUAL_TYPES = [
  { id: 'bar', label: 'Columnas', group: 'Gráficos' },
  { id: 'hbar', label: 'Barras', group: 'Gráficos' },
  { id: 'line', label: 'Línea', group: 'Gráficos' },
  { id: 'area', label: 'Área', group: 'Gráficos' },
  { id: 'combo', label: 'Combinado', group: 'Gráficos', two: true },
  { id: 'pie', label: 'Torta', group: 'Gráficos', noSplit: true },
  { id: 'donut', label: 'Dona', group: 'Gráficos', noSplit: true },
  { id: 'treemap', label: 'Mapa de árbol', group: 'Gráficos', noSplit: true },
  { id: 'scatter', label: 'Dispersión', group: 'Gráficos', two: true, noSplit: true },
  { id: 'kpi', label: 'Tarjeta', group: 'Indicadores', noGroup: true },
  { id: 'gauge', label: 'Medidor', group: 'Indicadores', noGroup: true },
  { id: 'matrix', label: 'Matriz', group: 'Tablas' },
];
export const typeInfo = (t) => VISUAL_TYPES.find((v) => v.id === t) || VISUAL_TYPES[0];
export const CHART_SVG = new Set(['bar', 'hbar', 'line', 'area', 'pie', 'donut', 'treemap', 'combo', 'scatter', 'gauge']);

let seq = 0;
export const newId = () => `v${Date.now().toString(36)}${(seq++).toString(36)}`;

export function metricLabel(model, metric, agg) {
  const m = findMeasure(model, metric);
  if (m) return m.name;
  if (agg === 'COUNT' || metric === -1 || metric === undefined) return 'Cantidad de filas';
  return `${AGG_LABELS[agg] || AGG_LABELS_ALL[agg] || 'Suma'} de ${model.columns[metric]?.name || ''}`;
}

function pv(rows, model, cfg, metric, agg) {
  const m = findMeasure(model, metric);
  return pivot(rows, model.columns, { ...cfg, metric: m ? -1 : metric, agg: m ? 'SUM' : agg, measure: m ? m.ast : null });
}

/** Valor total de una métrica sobre todas las filas recibidas. */
export function metricTotal(rows, model, metric, agg) {
  const m = findMeasure(model, metric);
  if (m) { const v = finalize(evalMeasure(m.ast, rows, null)); return typeof v === 'number' ? v : 0; }
  if (agg === 'COUNT' || metric < 0) return rows.length;
  if (agg === 'DISTINCT') return new Set(rows.map((r) => String(r[metric]))).size;
  const s = stats(rows, metric);
  return { SUM: s.sum, AVG: s.avg, MIN: s.min, MAX: s.max }[agg] ?? s.sum;
}

/** Calcula lo que necesita un visual para dibujarse. rowsFor(col) aplica los filtros (sin el de la propia columna). */
export function computeView(model, rowsFor, allRows, cfg) {
  const info = typeInfo(cfg.type);
  const label = metricLabel(model, cfg.metric, cfg.agg);
  const groupName = model.columns[cfg.group]?.name || '';
  const autoTitle = info.noGroup ? label : `${label} por ${groupName}${cfg.split >= 0 && !info.noSplit ? ` y ${model.columns[cfg.split]?.name}` : ''}`;
  const title = cfg.title?.trim() || autoTitle;

  if (info.noGroup) {
    const rows = allRows;
    const value = metricTotal(rows, model, cfg.metric, cfg.agg);
    const dateCol = model.columns.findIndex((c) => c.type === 'date');
    let trend = null;
    if (cfg.type === 'kpi' && dateCol >= 0) trend = pv(rows, model, { group: dateCol, gran: autoGranularity(rows, dateCol), sort: 'chrono', topN: 'ALL', split: -1 }, cfg.metric, cfg.agg);
    return { kind: cfg.type, title, label, value, trend, target: +cfg.target || 0, isDate: false, items: [], series: [] };
  }

  const rows = rowsFor(cfg.group);
  const split = info.noSplit ? -1 : cfg.split;
  const p = pv(rows, model, { group: cfg.group, split, gran: cfg.gran, sort: cfg.sort, topN: cfg.type === 'matrix' ? (cfg.topN === 'ALL' ? 'ALL' : cfg.topN) : cfg.topN, topSeries: cfg.type === 'matrix' ? 12 : 6 }, cfg.metric, cfg.agg);
  const out = { ...p, kind: cfg.type, title, label, valueLabel: label, groupName, metricName: label };
  if (info.two) {
    const label2 = metricLabel(model, cfg.metric2, cfg.agg2);
    const p2 = pv(rows, model, { group: cfg.group, split: -1, gran: cfg.gran, sort: 'label', topN: 'ALL' }, cfg.metric2, cfg.agg2);
    out.items2 = p2.items; out.label2 = label2;
    if (!cfg.title?.trim()) out.title = `${label} y ${label2} por ${groupName}`;
  }
  return out;
}

const RATE = /(%|porcentaje|tasa|bsw|ratio|promedio|precio|unitari|edad)/i;
export const defaultAgg = (model, metric) => (typeof metric === 'number' && metric >= 0 && RATE.test(model.columns[metric]?.name || '') ? 'AVG' : 'SUM');

/** Tablero inicial: tarjetas, tendencia, ranking, participación y matriz, según las columnas detectadas. */
export function autoVisuals(model, sug) {
  const out = [];
  const m = sug.metric;
  const agg = m >= 0 ? defaultAgg(model, m) : 'COUNT';
  const base = { agg, metric: m, split: -1, topN: '10', sort: 'auto', gran: 'month', title: '', size: 'half' };
  const cats = sug.categories;
  // Tarjetas
  out.push({ ...base, id: newId(), type: 'kpi', metric: -1, agg: 'COUNT', size: 'quarter', title: 'Filas' });
  if (m >= 0) {
    out.push({ ...base, id: newId(), type: 'kpi', size: 'quarter' });
    out.push({ ...base, id: newId(), type: 'kpi', agg: agg === 'SUM' ? 'AVG' : 'MAX', size: 'quarter' });
  }
  if (sug.metrics[1] !== undefined) out.push({ ...base, id: newId(), type: 'kpi', metric: sug.metrics[1], agg: defaultAgg(model, sug.metrics[1]), size: 'quarter' });
  else if (cats[0] !== undefined) out.push({ ...base, id: newId(), type: 'kpi', metric: cats[0], agg: 'DISTINCT', size: 'quarter' });
  // Tendencia
  if (sug.dates.length) {
    const g = sug.dates[0];
    const two = sug.metrics[1] !== undefined;
    out.push({ ...base, id: newId(), type: two ? 'combo' : 'area', group: g, gran: autoGranularity(model.rows, g), size: 'full', metric2: two ? sug.metrics[1] : undefined, agg2: two ? defaultAgg(model, sug.metrics[1]) : undefined });
  }
  // Ranking y participación
  if (cats[0] !== undefined) out.push({ ...base, id: newId(), type: model.columns[cats[0]].unique > 8 ? 'hbar' : 'bar', group: cats[0] });
  if (cats[1] !== undefined) out.push({ ...base, id: newId(), type: model.columns[cats[1]].unique <= 8 ? 'donut' : 'treemap', group: cats[1] });
  if (cats[0] !== undefined && cats[2] !== undefined && model.columns[cats[2]].unique <= 12) {
    out.push({ ...base, id: newId(), type: 'matrix', group: cats[0], split: cats[2], size: 'full', heat: true });
  } else if (cats[0] !== undefined && cats[1] !== undefined && model.columns[cats[1]].unique <= 12) {
    out.push({ ...base, id: newId(), type: 'matrix', group: cats[0], split: cats[1], size: 'full', heat: true });
  }
  if (!out.some((v) => !typeInfo(v.type).noGroup)) out.push({ ...base, id: newId(), type: 'bar', group: 0, metric: -1, agg: 'COUNT' });
  return out;
}

/** Visual nuevo a partir de otro (o de las sugerencias). */
export function blankVisual(model, sug) {
  const g = sug.categories[0] ?? sug.dates[0] ?? 0;
  const m = sug.metric;
  return { id: newId(), type: model.columns[g]?.type === 'date' ? 'line' : 'bar', group: g, metric: m, agg: m >= 0 ? defaultAgg(model, m) : 'COUNT', split: -1, topN: '10', sort: 'auto', gran: model.columns[g]?.type === 'date' ? autoGranularity(model.rows, g) : 'month', title: '', size: 'half' };
}

// ------------------------------------------------------------------ Guardar y abrir: referencias por nombre

export function serializeVisuals(visuals, columns) {
  const nameOf = (i) => (typeof i === 'number' && i >= 0 ? columns[i]?.name ?? null : i);
  return visuals.map((v) => ({ ...v, group: nameOf(v.group), split: v.split >= 0 ? nameOf(v.split) : null, metric: isMeasureRef(v.metric) ? v.metric : v.metric >= 0 ? nameOf(v.metric) : -1, metric2: v.metric2 === undefined ? undefined : isMeasureRef(v.metric2) ? v.metric2 : v.metric2 >= 0 ? nameOf(v.metric2) : -1 }));
}
export function deserializeVisuals(saved, columns) {
  const idx = new Map(columns.map((c, i) => [c.name.toLocaleLowerCase('es'), i]));
  const find = (n) => (typeof n === 'string' && !n.startsWith('m:') ? idx.get(n.toLocaleLowerCase('es')) ?? null : n);
  const out = [];
  for (const v of saved || []) {
    const info = typeInfo(v.type);
    const group = info.noGroup ? (find(v.group) ?? 0) : find(v.group);
    if (group === null || group === undefined) continue;
    const metric = v.metric === -1 || v.metric === null ? -1 : find(v.metric);
    if (metric === null || metric === undefined) continue;
    const split = v.split === null || v.split === undefined ? -1 : find(v.split) ?? -1;
    const metric2 = v.metric2 === undefined ? undefined : v.metric2 === -1 ? -1 : find(v.metric2) ?? -1;
    out.push({ ...v, id: v.id || newId(), group, metric, split, metric2 });
  }
  return out;
}
export function serializeFilters(filters, columns) { return filters.map((f) => ({ ...f, col: columns[f.col]?.name })).filter((f) => f.col); }
export function deserializeFilters(saved, columns) {
  const idx = new Map(columns.map((c, i) => [c.name.toLocaleLowerCase('es'), i]));
  return (saved || []).map((f) => ({ ...f, col: idx.get(String(f.col).toLocaleLowerCase('es')) })).filter((f) => f.col !== undefined);
}
