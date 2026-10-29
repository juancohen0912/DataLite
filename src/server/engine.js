// Motor de reportes y alertas para el servidor: el mismo lector y cálculo del tablero, sin navegador.
// Se empaqueta con esbuild en api/_lib/engine.js (build.mjs).
import { readFile, buildTable, applyFilters, pivot, fmt, fmtShort } from '../lib/data.js';
import { buildModel, findMeasure } from '../lib/model.js';
import { deserializeVisuals, deserializeFilters, computeView, metricTotal, metricLabel } from '../app/visuals.js';

/** Lee el archivo descargado y arma el modelo con las fórmulas y filtros guardados del proyecto. */
export async function loadDataset(buffer, fileName, state) {
  const { sheets } = await readFile(new File([buffer], fileName));
  const want = state?.source?.sheet || state?.sheet;
  let idx = sheets.findIndex((s) => s.name === want);
  if (idx < 0) idx = sheets.reduce((best, s, i) => (s.aoa.length > sheets[best].aoa.length ? i : best), 0);
  const t = buildTable(sheets[idx].aoa);
  if (!t.rows.length) throw new Error('La hoja no tiene filas con datos.');
  const model = buildModel(t, state?.formulas || {});
  const filters = deserializeFilters(state?.filters || [], model.columns);
  const rows = filters.length ? applyFilters(model.rows, filters) : model.rows;
  return { model, rows, sheet: sheets[idx].name };
}

/** Contenido del reporte: indicadores y los principales gráficos como listas de valores. */
export function reportData(state, ds, { maxCharts = 6, maxItems = 8 } = {}) {
  const visuals = deserializeVisuals(state?.visuals || [], ds.model.columns);
  const kpis = [], charts = [];
  for (const v of visuals) {
    let view;
    try { view = computeView(ds.model, () => ds.rows, ds.rows, v); } catch { continue; }
    if (view.kind === 'kpi' || view.kind === 'gauge') {
      let delta = null;
      const tr = view.trend?.items;
      if (tr && tr.length >= 2) { const a = tr[tr.length - 1].value, b = tr[tr.length - 2].value; if (b) delta = ((a - b) / Math.abs(b)) * 100; }
      kpis.push({ title: view.title, value: view.value, text: fmtShort(view.value), full: fmt(view.value), delta, target: view.target || 0 });
    } else if (charts.length < maxCharts && view.items?.length) {
      const items = view.items.filter((d) => typeof d.value === 'number').slice(0, view.isDate ? 12 : maxItems);
      const series = view.isDate ? items.slice(-12) : items;
      charts.push({ title: view.title, kind: view.kind, isDate: !!view.isDate, items: series.map((d) => ({ label: String(d.label), value: d.value, text: fmtShort(d.value) })) });
    }
  }
  return { kpis: kpis.slice(0, 8), charts, rows: ds.rows.length };
}

const colIndex = (model, name) => {
  if (name === -1 || name === null || name === undefined) return -1;
  if (typeof name === 'string' && name.startsWith('m:')) return name;
  const i = model.columns.findIndex((c) => c.name.toLocaleLowerCase('es') === String(name).toLocaleLowerCase('es'));
  return i;
};

/**
 * Evalúa una alerta. rule: { metric, agg, mode: 'total' | 'change', dateCol?, gran?, op: 'gt' | 'lt', threshold }
 * - total: valor de la métrica (con los filtros guardados) frente al umbral.
 * - change: variación % del último periodo con datos frente al anterior.
 */
export function evaluateAlert(rule, ds) {
  const metric = colIndex(ds.model, rule.metric);
  if (metric !== -1 && typeof metric === 'number' && metric < 0) throw new Error(`La columna «${rule.metric}» ya no existe en la hoja.`);
  if (typeof metric === 'string' && !findMeasure(ds.model, metric)) throw new Error(`La medida «${rule.metric.slice(2)}» ya no existe.`);
  const agg = rule.agg || 'SUM';
  const label = metricLabel(ds.model, metric, agg);
  let value, detail;
  if (rule.mode === 'change') {
    const dateCol = colIndex(ds.model, rule.dateCol);
    if (typeof dateCol !== 'number' || dateCol < 0 || ds.model.columns[dateCol].type !== 'date') throw new Error('La alerta necesita una columna de fecha.');
    const m = findMeasure(ds.model, metric);
    const p = pivot(ds.rows, ds.model.columns, { group: dateCol, gran: rule.gran || 'month', sort: 'chrono', topN: 'ALL', split: -1, metric: m ? -1 : metric, agg: m ? 'SUM' : agg, measure: m ? m.ast : null });
    const items = p.items.filter((d) => typeof d.value === 'number');
    if (items.length < 2) throw new Error('Aún no hay dos periodos con datos para comparar.');
    const last = items[items.length - 1], prev = items[items.length - 2];
    value = prev.value ? ((last.value - prev.value) / Math.abs(prev.value)) * 100 : (last.value ? 100 : 0);
    detail = { last: { label: String(last.label), value: last.value, text: fmt(last.value) }, prev: { label: String(prev.label), value: prev.value, text: fmt(prev.value) } };
  } else {
    value = metricTotal(ds.rows, ds.model, metric, agg);
  }
  const thr = Number(rule.threshold);
  const triggered = rule.op === 'lt' ? value < thr : value > thr;
  return { label, value, text: rule.mode === 'change' ? `${value >= 0 ? '+' : ''}${value.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %` : fmt(value), triggered, detail };
}

export { fmt, fmtShort };
