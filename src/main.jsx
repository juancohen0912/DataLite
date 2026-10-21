import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  readFile, buildTable, suggest, pivot, applyFilters, distinctValues, stats, autoGranularity,
  fmt, fmtShort, AGG_LABELS, keyOf, MAX_FILE_MB,
} from './lib/data.js';
import { SAMPLES, makeSample } from './lib/samples.js';
import { Chart, svgToPng } from './lib/Chart.jsx';
import { downloadDataUrl, exportPivotXlsx, exportPptx, safeName } from './lib/exporters.js';

const track = (name, data) => { try { window.va?.('event', { name, data }); } catch { /* sin analítica */ } };

const CHART_TYPES = [
  ['bar', 'Columnas'], ['hbar', 'Barras'], ['line', 'Línea'], ['area', 'Área'], ['pie', 'Torta'], ['donut', 'Dona'],
];
const TYPE_LABEL = { number: 'Número', date: 'Fecha', text: 'Texto' };

// ---------------------------------------------------------------- Carga

function Dropzone({ onFile, onSample, busy, error }) {
  const [over, setOver] = useState(false);
  const input = useRef(null);
  const cols = ['A', 'B', 'C', 'D', 'E', 'F'];
  return (
    <div
      className={`sheet${over ? ' is-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
    >
      <div className="sheet-grid" aria-hidden="true">
        <span className="corner" />
        {cols.map((c) => <span key={c} className="col-h">{c}</span>)}
        {Array.from({ length: 9 }).map((_, r) => (
          <React.Fragment key={r}>
            <span className="row-h">{r + 1}</span>
            {cols.map((c) => <span key={c} className="cell" />)}
          </React.Fragment>
        ))}
        <span className="selection" />
      </div>
      <div className="sheet-body">
        <p className="sheet-title">{busy ? 'Leyendo tu archivo…' : 'Suelta aquí tu Excel o CSV'}</p>
        <p className="sheet-sub">o elige uno desde tu equipo. .xlsx, .ods y .csv hasta {MAX_FILE_MB} MB.</p>
        <div className="sheet-actions">
          <button type="button" className="btn btn-primary" onClick={() => input.current?.click()} disabled={busy}>Elegir archivo</button>
          <input ref={input} type="file" hidden accept=".xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
        </div>
        <div className="samples">
          <span>¿Sin archivo a la mano? Prueba con un ejemplo:</span>
          <div className="sample-list">
            {SAMPLES.map((s) => (
              <button key={s.id} type="button" className="sample" onClick={() => onSample(s.id)} disabled={busy}>
                <strong>{s.label}</strong><small>{s.hint}</small>
              </button>
            ))}
          </div>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <p className="privacy-note">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 1 3 3v4c0 3.3 2.1 6.3 5 7 2.9-.7 5-3.7 5-7V3L8 1Zm-1 9.4L4.8 8.2l1-1L7 8.4l3.2-3.2 1 1L7 10.4Z" /></svg>
          Tu archivo se procesa en tu navegador. No lo subimos a ningún servidor.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Filtros

function FilterBar({ columns, rows, filters, setFilters }) {
  const [open, setOpen] = useState(false);
  const [col, setCol] = useState(-1);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(new Set());
  const pop = useRef(null);
  const options = columns.map((c, i) => ({ ...c, i })).filter((c) => c.type === 'text' && c.unique <= 2000);
  const values = useMemo(() => (col >= 0 ? distinctValues(rows, col, 1000) : []), [rows, col]);
  const shown = values.filter(([v]) => v.toLowerCase().includes(q.toLowerCase())).slice(0, 200);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (pop.current && !pop.current.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  function startEdit(i) {
    setCol(i); setQ('');
    setPicked(new Set(filters.find((f) => f.col === i)?.values || []));
    setOpen(true);
  }
  function apply() {
    const next = filters.filter((f) => f.col !== col);
    if (picked.size) next.push({ col, values: [...picked] });
    setFilters(next); setOpen(false); track('filtro_aplicado');
  }

  return (
    <div className="filterbar">
      <span className="fb-label">Filtros</span>
      {filters.map((f) => (
        <span key={f.col} className="chip">
          <button type="button" className="chip-main" onClick={() => startEdit(f.col)}>
            <b>{columns[f.col].name}:</b> {f.values.length > 2 ? `${f.values.slice(0, 2).join(', ')} +${f.values.length - 2}` : f.values.join(', ')}
          </button>
          <button type="button" className="chip-x" aria-label={`Quitar filtro ${columns[f.col].name}`} onClick={() => setFilters(filters.filter((x) => x !== f))}>×</button>
        </span>
      ))}
      <div className="fb-add" ref={pop}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCol(-1); setOpen((o) => !o); }} aria-expanded={open}>+ Agregar filtro</button>
        {filters.length > 0 && <button type="button" className="btn btn-link btn-sm" onClick={() => setFilters([])}>Quitar todos</button>}
        {open && (
          <div className="popover" role="dialog" aria-label="Agregar filtro">
            {col < 0 ? (
              <>
                <p className="pop-title">Filtrar por columna</p>
                {options.length === 0 && <p className="muted">No hay columnas de texto para filtrar.</p>}
                <ul className="pop-list">
                  {options.map((c) => (
                    <li key={c.i}><button type="button" onClick={() => startEdit(c.i)}>{c.name}<small>{c.unique} valores</small></button></li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p className="pop-title">{columns[col].name}</p>
                <input className="input" placeholder="Buscar valor…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
                <div className="pop-tools">
                  <button type="button" className="btn btn-link btn-sm" onClick={() => setPicked(new Set(shown.map(([v]) => v)))}>Seleccionar visibles</button>
                  <button type="button" className="btn btn-link btn-sm" onClick={() => setPicked(new Set())}>Limpiar</button>
                </div>
                <ul className="pop-list checks">
                  {shown.map(([v, n]) => (
                    <li key={v}>
                      <label>
                        <input type="checkbox" checked={picked.has(v)} onChange={(e) => {
                          const s = new Set(picked); e.target.checked ? s.add(v) : s.delete(v); setPicked(s);
                        }} />
                        <span>{v}</span><small>{n.toLocaleString('es-CO')}</small>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="pop-foot">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCol(-1)}>Atrás</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={apply}>Aplicar filtro</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Editor de gráfico

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function ChartEditor({ columns, rows, cfg, setCfg, filters, onToggleFilter, chartRef, view }) {
  const isDate = columns[cfg.group]?.type === 'date';
  const metricOpts = columns.map((c, i) => ({ ...c, i })).filter((c) => c.type === 'number');
  const selected = useMemo(() => new Set(filters.find((f) => f.col === cfg.group)?.values || []), [filters, cfg.group]);
  const [q, setQ] = useState('');
  const tableItems = view.items.filter((d) => d.label.toLowerCase().includes(q.toLowerCase()));
  const needsMetric = !['COUNT', 'DISTINCT'].includes(cfg.agg);

  return (
    <section className="card editor" aria-label="Editor de gráfico">
      <div className="editor-controls">
        <Field label="Agrupar por">
          <select value={cfg.group} onChange={(e) => {
            const g = +e.target.value;
            const date = columns[g].type === 'date';
            setCfg({ ...cfg, group: g, gran: date ? autoGranularity(rows, g) : cfg.gran, type: date ? 'line' : (['line', 'area'].includes(cfg.type) ? 'bar' : cfg.type), split: cfg.split === g ? -1 : cfg.split });
          }}>
            {columns.map((c, i) => <option key={i} value={i}>{c.name} ({TYPE_LABEL[c.type]})</option>)}
          </select>
        </Field>
        {isDate && (
          <Field label="Periodo">
            <select value={cfg.gran} onChange={(e) => setCfg({ ...cfg, gran: e.target.value })}>
              <option value="day">Día</option><option value="month">Mes</option><option value="quarter">Trimestre</option><option value="year">Año</option>
            </select>
          </Field>
        )}
        <Field label="Cálculo">
          <select value={cfg.agg} onChange={(e) => {
            const agg = e.target.value;
            let metric = cfg.metric;
            if (agg === 'COUNT') metric = -1;
            else if (agg === 'DISTINCT') metric = metric >= 0 ? metric : cfg.group;
            else if (metric < 0 || columns[metric].type !== 'number') metric = metricOpts[0]?.i ?? -1;
            setCfg({ ...cfg, agg, metric });
          }}>
            {Object.entries(AGG_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label={cfg.agg === 'DISTINCT' ? 'Contar valores únicos de' : 'Valor'}>
          <select value={cfg.metric} onChange={(e) => setCfg({ ...cfg, metric: +e.target.value })} disabled={cfg.agg === 'COUNT'}>
            {cfg.agg === 'COUNT' && <option value={-1}>Filas</option>}
            {(cfg.agg === 'DISTINCT' ? columns.map((c, i) => ({ ...c, i })) : metricOpts).map((c) => <option key={c.i} value={c.i}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Dividir por">
          <select value={cfg.split} onChange={(e) => setCfg({ ...cfg, split: +e.target.value, type: +e.target.value >= 0 && ['pie', 'donut'].includes(cfg.type) ? 'bar' : cfg.type })}>
            <option value={-1}>Ninguno</option>
            {columns.map((c, i) => ({ ...c, i })).filter((c) => c.type === 'text' && c.i !== cfg.group && c.unique <= 200)
              .map((c) => <option key={c.i} value={c.i}>{c.name}</option>)}
          </select>
        </Field>
        {!isDate && (
          <Field label="Mostrar">
            <select value={cfg.topN} onChange={(e) => setCfg({ ...cfg, topN: e.target.value })}>
              <option value="5">Top 5</option><option value="10">Top 10</option><option value="15">Top 15</option><option value="25">Top 25</option><option value="ALL">Todos</option>
            </select>
          </Field>
        )}
        <Field label="Ordenar">
          <select value={cfg.sort} onChange={(e) => setCfg({ ...cfg, sort: e.target.value })}>
            <option value="auto">Automático</option><option value="value-desc">Mayor a menor</option><option value="value-asc">Menor a mayor</option><option value="label">Alfabético</option>{isDate && <option value="chrono">Cronológico</option>}
          </select>
        </Field>
      </div>

      <div className="type-switch" role="radiogroup" aria-label="Tipo de gráfico">
        {CHART_TYPES.map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={cfg.type === k}
            className={cfg.type === k ? 'on' : ''} disabled={cfg.split >= 0 && ['pie', 'donut'].includes(k)}
            onClick={() => setCfg({ ...cfg, type: k })}>
            <ChartGlyph type={k} />{l}
          </button>
        ))}
      </div>

      {needsMetric && cfg.metric < 0 ? (
        <p className="empty">Tu archivo no tiene columnas numéricas. Cambia el cálculo a <b>Conteo</b> para contar filas por categoría.</p>
      ) : (
        <div className="editor-body">
          <div className="editor-chart">
            <h2 className="chart-title">{view.title}</h2>
            {view.fullCount > view.items.length && !isDate && (
              <p className="hint">{view.fullCount} categorías en total. Se agrupan las menores en «Otros» para que el gráfico se lea bien.</p>
            )}
            <Chart ref={chartRef} type={cfg.type} items={view.items} series={view.series} height={380}
              valueLabel={view.valueLabel} selected={isDate ? null : selected}
              onSelect={isDate ? null : (k) => onToggleFilter(cfg.group, k)} />
            {!isDate && <p className="hint subtle">Haz clic en una barra o porción para filtrar todo el tablero.</p>}
          </div>
          <div className="editor-table">
            <div className="table-head">
              <h3>Tabla dinámica</h3>
              <input className="input input-sm" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar en la tabla" />
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{columns[cfg.group]?.name}</th><th className="num">{view.valueLabel}</th><th className="num">%</th></tr></thead>
                <tbody>
                  {tableItems.map((d) => (
                    <tr key={d.key}>
                      <td>{d.label}</td>
                      <td className="num">{fmt(d.value)}</td>
                      <td className="num muted">{view.total && ['SUM', 'COUNT'].includes(view.agg) ? ((d.value / view.total) * 100).toFixed(1) : ''}</td>
                    </tr>
                  ))}
                </tbody>
                {['SUM', 'COUNT'].includes(view.agg) && (
                  <tfoot><tr><td>Total</td><td className="num">{fmt(view.total)}</td><td className="num muted">100</td></tr></tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ChartGlyph({ type }) {
  const p = {
    bar: 'M3 13V8M7 13V4M11 13V9', hbar: 'M3 4h7M3 8h10M3 12h5', line: 'M2 12l4-5 3 3 5-7', area: 'M2 13l4-5 3 3 5-7v9z',
    pie: 'M8 2a6 6 0 1 0 6 6H8z', donut: 'M8 2a6 6 0 1 1-6 6',
  }[type];
  return <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d={p} fill={['area', 'pie'].includes(type) ? 'currentColor' : 'none'} fillOpacity=".25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

// ---------------------------------------------------------------- Vistas

function makeView(rows, columns, cfg) {
  const p = pivot(rows, columns, cfg);
  const metricName = p.agg === 'COUNT' ? 'filas' : columns[cfg.metric]?.name || '';
  const valueLabel = p.agg === 'COUNT' ? 'Cantidad de filas' : `${AGG_LABELS[p.agg]} de ${metricName}`;
  const groupName = columns[cfg.group]?.name || '';
  return { ...p, metricName, valueLabel, groupName, title: `${valueLabel} por ${groupName}${cfg.split >= 0 ? ` y ${columns[cfg.split].name}` : ''}`, type: cfg.type };
}

function autoConfigs(columns, rows, sug) {
  const out = [];
  const m = sug.metric;
  const base = { agg: m >= 0 ? 'SUM' : 'COUNT', metric: m, split: -1, topN: '10', sort: 'auto' };
  if (sug.dates.length) {
    const g = sug.dates[0];
    out.push({ ...base, group: g, type: 'area', gran: autoGranularity(rows, g) });
  }
  sug.categories.slice(0, 3).forEach((g, idx) => {
    const u = columns[g].unique;
    if (idx === 0) out.push({ ...base, group: g, type: u > 8 ? 'hbar' : 'bar' });
    else if (u <= 8) out.push({ ...base, group: g, type: 'donut' });
    else out.push({ ...base, group: g, type: 'hbar', agg: 'COUNT', metric: -1 });
  });
  if (sug.metrics.length > 1 && sug.categories.length) {
    out.push({ ...base, group: sug.categories[0], metric: sug.metrics[1], agg: 'AVG', type: 'bar' });
  }
  return out.slice(0, 5);
}

function Dashboard({ ds, onReset, onSheet }) {
  const { columns, rows } = ds;
  const sug = useMemo(() => suggest(columns, rows), [columns, rows]);
  const autos = useMemo(() => autoConfigs(columns, rows, sug), [columns, rows, sug]);
  const mainIdx = useMemo(() => Math.max(0, autos.findIndex((a) => columns[a.group].type !== 'date')), [autos, columns]);
  const [cfg, setCfg] = useState(() => {
    const first = autos[mainIdx];
    return first ? { ...first, gran: first.gran || 'month' } : { group: 0, metric: sug.metric, agg: sug.metric >= 0 ? 'SUM' : 'COUNT', split: -1, type: 'bar', topN: '10', sort: 'auto', gran: 'month' };
  });
  const [filters, setFilters] = useState([]);
  const [busy, setBusy] = useState('');
  const [menu, setMenu] = useState(false);
  const chartRef = useRef(null);
  const adRef = useRef(null);
  const menuRef = useRef(null);

  const fRows = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  // Cada gráfico ignora el filtro de su propia columna: así resalta la selección en lugar de ocultar el resto (como Power BI).
  const rowsFor = useCallback((col) => (filters.some((f) => f.col === col) ? applyFilters(rows, filters.filter((f) => f.col !== col)) : fRows), [rows, filters, fRows]);
  const view = useMemo(() => makeView(rowsFor(cfg.group), columns, cfg), [rowsFor, columns, cfg]);
  const autoViews = useMemo(() => autos.filter((_, i) => i !== mainIdx).slice(0, 4).map((a) => ({ cfg: a, view: makeView(rowsFor(a.group), columns, { gran: 'month', ...a }) })), [autos, mainIdx, rowsFor, columns]);
  const st = useMemo(() => (cfg.metric >= 0 && columns[cfg.metric]?.type === 'number' ? stats(fRows, cfg.metric) : null), [fRows, cfg.metric, columns]);

  useEffect(() => { window.DataLiteAds?.fill(adRef.current); }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const toggleFilter = useCallback((col, key) => {
    setFilters((fs) => {
      const cur = fs.find((f) => f.col === col);
      const vals = new Set(cur?.values || []);
      vals.has(key) ? vals.delete(key) : vals.add(key);
      const rest = fs.filter((f) => f.col !== col);
      return vals.size ? [...rest, { col, values: [...vals] }] : rest;
    });
    track('filtro_clic');
  }, []);

  const kpis = [
    { label: filters.length ? `Filas filtradas de ${rows.length.toLocaleString('es-CO')}` : 'Filas', value: fRows.length.toLocaleString('es-CO') },
    st && { label: `Total ${columns[cfg.metric].name}`, value: fmtShort(st.sum) },
    st && { label: `Promedio ${columns[cfg.metric].name}`, value: fmtShort(st.avg) },
    st ? { label: `Máximo ${columns[cfg.metric].name}`, value: fmtShort(st.max) } : { label: `Categorías en ${columns[cfg.group].name}`, value: view.fullCount.toLocaleString('es-CO') },
  ].filter(Boolean);

  async function run(kind) {
    setMenu(false); setBusy(kind);
    try {
      if (kind === 'png') {
        const svg = chartRef.current?.svg();
        if (svg) downloadDataUrl(await svgToPng(svg, { title: view.title }), `DataLite_${safeName(view.groupName)}.png`);
      } else if (kind === 'pptx') {
        await exportPptx([view, ...autoViews.map((a) => a.view)], ds.fileName, kpis);
      } else if (kind === 'xlsx') {
        await exportPivotXlsx(view, ds.fileName);
      } else if (kind === 'pdf') {
        window.print();
      }
      track('exportar', { tipo: kind });
    } catch (e) {
      alert(`No se pudo exportar: ${e.message}`);
    } finally { setBusy(''); }
  }

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="file-info">
          <p className="file-name">{ds.fileName}</p>
          <p className="muted small">
            {rows.length.toLocaleString('es-CO')} filas, {columns.length} columnas
            {ds.truncated && ' (se leyeron las primeras 300.000 filas)'}
          </p>
        </div>
        {ds.sheets.length > 1 && (
          <label className="field field-inline"><span>Hoja</span>
            <select value={ds.sheetIdx} onChange={(e) => onSheet(+e.target.value)}>
              {ds.sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
            </select>
          </label>
        )}
        <div className="dash-actions">
          <div className="menu" ref={menuRef}>
            <button type="button" className="btn btn-primary" aria-expanded={menu} onClick={() => setMenu((m) => !m)} disabled={!!busy}>
              {busy ? 'Exportando…' : 'Exportar'}
            </button>
            {menu && (
              <ul className="menu-list" role="menu">
                <li><button role="menuitem" type="button" onClick={() => run('pptx')}>PowerPoint<small>Gráficos editables, una diapositiva por gráfico</small></button></li>
                <li><button role="menuitem" type="button" onClick={() => run('png')}>Imagen PNG<small>El gráfico principal en alta resolución</small></button></li>
                <li><button role="menuitem" type="button" onClick={() => run('xlsx')}>Tabla en Excel<small>La tabla dinámica actual</small></button></li>
                <li><button role="menuitem" type="button" onClick={() => run('pdf')}>PDF<small>Usa «Guardar como PDF» al imprimir</small></button></li>
              </ul>
            )}
          </div>
          <button type="button" className="btn btn-ghost" onClick={onReset}>Cargar otro archivo</button>
        </div>
      </div>

      <FilterBar columns={columns} rows={rows} filters={filters} setFilters={setFilters} />

      <div className="kpis">
        {kpis.map((k) => (
          <div key={k.label} className="kpi"><p className="kpi-v">{k.value}</p><p className="kpi-l">{k.label}</p></div>
        ))}
      </div>

      <ChartEditor columns={columns} rows={fRows} cfg={cfg} setCfg={setCfg} filters={filters}
        onToggleFilter={toggleFilter} chartRef={chartRef} view={view} />

      {autoViews.length > 0 && (
        <section className="suggested" aria-labelledby="sug-h">
          <h2 id="sug-h" className="section-h">Gráficos sugeridos para tus datos</h2>
          <div className="sug-grid">
            {autoViews.map(({ cfg: c, view: v }, i) => (
              <article key={i} className="card sug">
                <div className="sug-head">
                  <h3>{v.title}</h3>
                  <button type="button" className="btn btn-link btn-sm" onClick={() => { setCfg({ gran: 'month', ...c }); document.querySelector('.editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); track('abrir_sugerido'); }}>Editar</button>
                </div>
                <Chart type={c.type} items={v.items} series={v.series} height={260} compact valueLabel={v.valueLabel}
                  selected={v.isDate ? null : new Set(filters.find((f) => f.col === c.group)?.values || [])}
                  onSelect={v.isDate ? null : (k) => toggleFilter(c.group, k)} />
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="ad-slot" data-slot="dashboard" ref={adRef} />

      <section className="card preview" aria-labelledby="prev-h">
        <div className="table-head"><h2 id="prev-h" className="section-h">Tus datos</h2><span className="muted small">Primeras 50 filas{filters.length ? ' con los filtros aplicados' : ''}</span></div>
        <div className="table-wrap tall">
          <table>
            <thead><tr>{columns.map((c) => <th key={c.name} className={c.type === 'number' ? 'num' : ''}>{c.name}<span className={`badge t-${c.type}`}>{TYPE_LABEL[c.type]}</span></th>)}</tr></thead>
            <tbody>
              {fRows.slice(0, 50).map((r, ri) => (
                <tr key={ri}>{r.map((v, ci) => <td key={ci} className={columns[ci].type === 'number' ? 'num' : ''}>{v instanceof Date ? v.toLocaleDateString('es-CO') : typeof v === 'number' ? fmt(v) : v}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="pro-nudge">
        <p><b>¿Te sirvió?</b> Estamos preparando DataLite Pro: guardar tableros, compartirlos con un enlace y exportar sin marca de agua.</p>
        <a className="btn btn-ghost btn-sm" href="/#planes" onClick={() => track('interes_pro')}>Ver planes</a>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- App

function App() {
  const [ds, setDs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const top = useRef(null);

  useEffect(() => {
    document.body.classList.toggle('has-data', !!ds);
    if (ds) document.getElementById('demo-video')?.pause();
    if (ds) top.current?.scrollIntoView({ block: 'start' });
  }, [!!ds]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('ejemplo');
    if (id && SAMPLES.some((x) => x.id === id)) onSample(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function load(fileName, sheets, sheetIdx = 0) {
    const t = buildTable(sheets[sheetIdx].aoa);
    if (!t.rows.length || !t.columns.length) throw new Error('No encontramos filas con datos. Revisa que la primera fila tenga los encabezados.');
    setDs({ fileName, sheets, sheetIdx, ...t, key: `${fileName}-${sheetIdx}-${Date.now()}` });
  }

  async function onFile(file) {
    setBusy(true); setError('');
    try {
      const { sheets } = await readFile(file);
      // Elegir la hoja con más filas por defecto
      const idx = sheets.reduce((best, s, i) => (s.aoa.length > sheets[best].aoa.length ? i : best), 0);
      load(file.name.replace(/\.[^.]+$/, ''), sheets, idx);
      track('archivo_cargado', { ext: file.name.split('.').pop().toLowerCase() });
    } catch (e) {
      setError(e.message || 'No pudimos leer el archivo.');
    } finally { setBusy(false); }
  }

  function onSample(id) {
    setError('');
    const s = makeSample(id);
    load(s.name, [{ name: s.name, aoa: s.aoa }]);
    track('ejemplo_cargado', { id });
  }

  return (
    <div ref={top} className="app">
      {ds
        ? <Dashboard key={ds.key} ds={ds} onReset={() => setDs(null)} onSheet={(i) => { try { load(ds.fileName, ds.sheets, i); } catch (e) { alert(e.message); } }} />
        : <Dropzone onFile={onFile} onSample={onSample} busy={busy} error={error} />}
    </div>
  );
}

// ---------------------------------------------------------------- Video de demostración

function initDemo() {
  const fig = document.querySelector('.demo');
  const video = document.getElementById('demo-video');
  if (!fig || !video) return;
  const toggle = fig.querySelector('.demo-toggle');
  const bar = fig.querySelector('.demo-progress i');
  const steps = [...fig.querySelectorAll('.demo-steps button')];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let userPaused = false, tracked = false;

  const sync = () => {
    const playing = !video.paused;
    fig.classList.toggle('is-playing', playing);
    toggle.setAttribute('aria-label', playing ? 'Pausar la demostración' : 'Reproducir la demostración');
  };
  const play = () => video.play().catch(() => {});
  const userPlay = () => { userPaused = false; play(); if (!tracked) { tracked = true; track('demo_video'); } };
  const togglePlay = () => { if (video.paused) userPlay(); else { userPaused = true; video.pause(); } };

  video.addEventListener('play', sync);
  video.addEventListener('pause', sync);
  video.addEventListener('click', togglePlay);
  toggle.addEventListener('click', togglePlay);
  fig.querySelector('.demo-full')?.addEventListener('click', () => {
    const el = video.requestFullscreen ? video : video.webkitEnterFullscreen ? video : null;
    if (!el) return;
    userPlay();
    if (video.requestFullscreen) video.requestFullscreen().catch(() => {}); else video.webkitEnterFullscreen();
    track('demo_pantalla_completa');
  });
  video.addEventListener('timeupdate', () => {
    const t = video.currentTime;
    if (video.duration) bar.style.width = `${(t / video.duration) * 100}%`;
    let active = -1;
    steps.forEach((s, i) => { if (t >= +s.dataset.t) active = i; });
    if (t >= 31) active = -1; // tarjeta del autor
    steps.forEach((s, i) => s.classList.toggle('on', i === active));
  });
  steps.forEach((s) => s.addEventListener('click', () => { video.currentTime = +s.dataset.t; userPlay(); }));

  // Reproduce en silencio solo cuando está a la vista y si la persona no prefiere menos movimiento.
  if (!reduced && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !userPaused && !document.body.classList.contains('has-data')) play();
      else if (!e.isIntersecting) video.pause();
    }, { threshold: 0.5 }).observe(video);
  }
}
initDemo();

const mount = document.getElementById('tool');
if (mount) {
  mount.innerHTML = '';
  createRoot(mount).render(<App />);
}
