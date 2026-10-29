import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sourceRef, sourceLabel } from '../lib/connectors.js';
import { suggest, applyFilters, fmt } from '../lib/data.js';
import { buildModel } from '../lib/model.js';
import { svgToPng } from '../lib/Chart.jsx';
import { downloadDataUrl, exportWorkbook, exportPptx, safeName } from '../lib/exporters.js';
import { THEMES, computeView, autoVisuals, blankVisual, typeInfo, newId, deserializeVisuals, deserializeFilters, serializeVisuals, serializeFilters } from './visuals.js';
import { FilterBar } from './FilterBar.jsx';
import { VisualTile } from './VisualTile.jsx';
import { VisualPanel } from './VisualPanel.jsx';
import { FormulaPanel } from './FormulaPanel.jsx';
import { Icon, Menu, track, useToast } from './ui.jsx';

const TYPE_LABEL = { number: 'Número', date: 'Fecha', text: 'Texto' };
const EMPTY_FORMULAS = { columns: [], measures: [], functions: [] };

/**
 * Tablero estilo Power BI.
 * cloud: { project, role, pro, onSave(state, name), onShare(), onOpenProjects(), saving } — opcional.
 */
export function Dashboard({ ds, initial, onReset, onSheet, onRefresh, cloud }) {
  const readOnly = cloud?.role === 'viewer';
  const [formulas, setFormulas] = useState(() => ({ ...EMPTY_FORMULAS, ...(initial?.formulas || {}) }));
  const model = useMemo(() => buildModel(ds, formulas), [ds, formulas]);
  const sug = useMemo(() => suggest(ds.columns, ds.rows), [ds]);
  const [visuals, setVisuals] = useState(() => {
    if (initial?.visuals) { const v = deserializeVisuals(initial.visuals, buildModel(ds, { ...EMPTY_FORMULAS, ...(initial.formulas || {}) }).columns); if (v.length) return v; }
    return autoVisuals(model, sug);
  });
  const [filters, setFilters] = useState(() => (initial?.filters ? deserializeFilters(initial.filters, model.columns) : []));
  const [theme, setTheme] = useState(initial?.theme && THEMES[initial.theme] ? initial.theme : 'datalite');
  const [editingId, setEditingId] = useState(null);
  const [showFormulas, setShowFormulas] = useState(false);
  const [busy, setBusy] = useState('');
  const [dirty, setDirty] = useState(false);
  const [toast, showToast] = useToast();
  const refs = useRef(new Map());
  const adRef = useRef(null);
  const palette = THEMES[theme].colors;
  const first = useRef(true);

  useEffect(() => { if (first.current) { first.current = false; return; } setDirty(true); }, [formulas, visuals, theme]);
  useEffect(() => { window.DataLiteAds?.fill(adRef.current); }, []);
  useEffect(() => {
    if (!dirty || !cloud?.project) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, cloud?.project]);

  // Si una fórmula se borra, los visuales que la usaban quedan en «Cantidad de filas»
  useEffect(() => {
    const names = new Set(model.measures.filter((m) => m.ast).map((m) => `m:${m.name}`.toLocaleLowerCase('es')));
    const n = model.columns.length;
    setVisuals((vs) => {
      let changed = false;
      const next = vs.map((v) => {
        const fix = (m) => (typeof m === 'string' ? (names.has(m.toLocaleLowerCase('es')) ? m : -1) : m >= n ? -1 : m);
        const out = { ...v, metric: fix(v.metric), metric2: v.metric2 === undefined ? undefined : fix(v.metric2), group: v.group >= n ? 0 : v.group, split: v.split >= n ? -1 : v.split };
        if (out.metric !== v.metric) out.agg = 'COUNT';
        if (out.metric !== v.metric || out.metric2 !== v.metric2 || out.group !== v.group || out.split !== v.split) changed = true;
        return out;
      });
      return changed ? next : vs;
    });
  }, [model]);

  const fRows = useMemo(() => applyFilters(model.rows, filters), [model.rows, filters]);
  // Cada visual ignora el filtro de su propia columna: resalta la selección en vez de ocultar el resto (como Power BI)
  const rowsFor = useCallback((col) => (filters.some((f) => f.col === col && f.values) ? applyFilters(model.rows, filters.filter((f) => !(f.col === col && f.values))) : fRows), [model.rows, filters, fRows]);
  const views = useMemo(() => visuals.map((v) => computeView(model, rowsFor, fRows, v)), [visuals, model, rowsFor, fRows]);

  const toggleFilter = useCallback((col, key) => {
    setFilters((fs) => {
      const cur = fs.find((f) => f.col === col && f.values);
      const vals = new Set(cur?.values || []);
      vals.has(key) ? vals.delete(key) : vals.add(key);
      const rest = fs.filter((f) => f.col !== col);
      return vals.size ? [...rest, { col, values: [...vals] }] : rest;
    });
    track('filtro_clic');
  }, []);

  const refFor = (id) => { let r = refs.current.get(id); if (!r) { r = { current: null }; refs.current.set(id, r); } return r; };
  const update = (id, cfg) => setVisuals((vs) => vs.map((v) => (v.id === id ? cfg : v)));
  const remove = (id) => { setVisuals((vs) => vs.filter((v) => v.id !== id)); if (editingId === id) setEditingId(null); };
  const duplicate = (id) => setVisuals((vs) => { const i = vs.findIndex((v) => v.id === id); const copy = { ...vs[i], id: newId(), title: vs[i].title ? `${vs[i].title} (copia)` : '' }; const out = vs.slice(); out.splice(i + 1, 0, copy); return out; });
  const move = (id, dir) => setVisuals((vs) => { const i = vs.findIndex((v) => v.id === id); const j = i + dir; if (j < 0 || j >= vs.length) return vs; const out = vs.slice(); [out[i], out[j]] = [out[j], out[i]]; return out; });
  const add = () => { const v = blankVisual(model, sug); setVisuals((vs) => [...vs, v]); setEditingId(v.id); track('visual_agregado'); setTimeout(() => document.getElementById(`tile-${v.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); };
  const resetBoard = () => { setVisuals(autoVisuals(model, suggest(model.columns, model.rows))); setEditingId(null); };

  const watermark = !cloud?.pro;
  // Descargar pide cuenta y descuenta del cupo gratis (lo decide la app: cloud.onExport)
  const allowExport = async (kind) => (cloud?.onExport ? cloud.onExport(kind) : true);
  async function pngOf(id) {
    const i = visuals.findIndex((v) => v.id === id);
    const svg = refFor(id).current?.svg?.();
    if (!svg) { showToast('Este visual no se puede descargar como imagen. Usa Excel o PowerPoint.', 'warn'); return; }
    if (!(await allowExport('png'))) return;
    downloadDataUrl(await svgToPng(svg, { title: views[i].title, watermark: watermark ? 'Hecho con DataLite · data-lite.vercel.app' : '' }), `DataLite_${safeName(views[i].title)}.png`);
    track('exportar', { tipo: 'png' });
  }
  async function run(kind) {
    if (!(await allowExport(kind))) return;
    setBusy(kind);
    try {
      const name = cloud?.project?.name || ds.fileName;
      if (kind === 'pptx') await exportPptx(views, name, { palette, watermark });
      else if (kind === 'xlsx') await exportWorkbook(views, name, { columns: model.columns, rows: model.rows });
      else if (kind === 'pdf') window.print();
      track('exportar', { tipo: kind });
    } catch (e) {
      showToast(`No se pudo exportar: ${e.message}`, 'error');
    } finally { setBusy(''); }
  }

  const getState = () => ({
    v: 1, fileName: ds.fileName, sheet: ds.sheets?.[ds.sheetIdx]?.name || null, theme,
    formulas, visuals: serializeVisuals(visuals, model.columns), filters: serializeFilters(filters, model.columns),
    source: ds.source ? sourceRef(ds.source, ds.sheets?.[ds.sheetIdx]?.name || ds.source.sheet) : null,
  });
  async function save(asNew = false) {
    if (!cloud) return;
    const ok = await cloud.onSave(getState(), { asNew });
    if (ok) setDirty(false);
  }
  useEffect(() => { if (cloud) cloud.registerGetState?.(getState); });

  const left = cloud?.exports ? Math.max(0, cloud.exports.limit - cloud.exports.used) : null;
  const exportNote = !cloud || cloud.pro ? null
    : !cloud.signedIn ? 'Descargar requiere una cuenta gratis'
      : left === null ? null
        : left === 0 ? `Usaste tus ${cloud.exports.limit} descargas gratis de este mes`
          : `Te ${left === 1 ? 'queda 1 descarga gratis' : `quedan ${left} descargas gratis`} este mes`;

  const editing = visuals.find((v) => v.id === editingId);
  const editIndex = visuals.findIndex((v) => v.id === editingId);
  const calcCount = model.calc.filter((c) => !c.error).length;
  const formulaErrors = [...model.calc, ...model.measures, ...model.functions].filter((x) => x.error).length;
  const totalFormulas = formulas.columns.length + formulas.measures.length + formulas.functions.length;

  return (
    <div className={`dash${editing ? ' with-panel' : ''}`}>
      <div className="dash-top">
        <div className="file-info">
          <p className="file-name">{cloud?.project?.name || ds.fileName}{dirty && cloud?.project && !readOnly && <span className="unsaved" title="Hay cambios sin guardar"> •</span>}</p>
          <p className="muted small">
            {ds.rows.length.toLocaleString('es-CO')} filas, {model.columns.length} columnas{calcCount ? ` (${calcCount} calculadas)` : ''}
            {ds.truncated && ' · se leyeron las primeras 300.000 filas'}
            {ds.source && <> · Conectado a {sourceLabel(ds.source)}</>}
            {cloud?.project && <> · {readOnly ? `Compartido por ${cloud.project.owner_email} (solo lectura)` : cloud.role === 'editor' ? `Compartido por ${cloud.project.owner_email}` : 'Guardado en tu cuenta'}</>}
          </p>
        </div>
        {ds.sheets?.length > 1 && !cloud?.project && (
          <label className="field field-inline"><span>Hoja</span>
            <select value={ds.sheetIdx} onChange={(e) => onSheet(+e.target.value)}>
              {ds.sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
            </select>
          </label>
        )}
        <div className="dash-actions">
          {!readOnly && (
            <button type="button" className="btn btn-ghost" onClick={() => { setShowFormulas(true); track('abrir_formulas'); }}>
              <Icon name="fx" /> Fórmulas{totalFormulas ? <span className="count">{totalFormulas}</span> : null}{formulaErrors ? <span className="count bad" title="Fórmulas con error">!</span> : null}
            </button>
          )}
          {!readOnly && (
            <Menu label={<><Icon name="palette" /> Tema</>} buttonClass="btn btn-ghost" items={Object.entries(THEMES).map(([k, t]) => ({
              label: <span className="theme-opt">{t.colors.slice(0, 5).map((c) => <i key={c} style={{ background: c }} />)}{t.name}{k === theme ? ' ✓' : ''}</span>,
              onClick: () => setTheme(k),
            }))} />
          )}
          {cloud && !readOnly && (
            <div className="btn-split">
              <button type="button" className="btn btn-ghost" onClick={() => save(false)} disabled={!!cloud.saving}>
                <Icon name={cloud.pro ? 'save' : 'lock'} /> {cloud.saving ? 'Guardando…' : 'Guardar'}
              </button>
              {cloud.project && cloud.role === 'owner' && <Menu icon="more" label="Más opciones de guardado" buttonClass="btn btn-ghost btn-split-more" items={[{ label: 'Guardar como copia', onClick: () => save(true) }]} />}
            </div>
          )}
          {cloud && (cloud.role === 'owner' || !cloud.project) && (
            <button type="button" className="btn btn-ghost" onClick={() => cloud.onShare(getState)}><Icon name={cloud.pro ? 'share' : 'lock'} /> Compartir</button>
          )}
          {cloud?.project && cloud.role === 'viewer' && (
            <button type="button" className="btn btn-ghost" onClick={cloud.onRequestEdit} disabled={cloud.editRequested}>{cloud.editRequested ? 'Permiso solicitado' : 'Pedir permiso para editar'}</button>
          )}
          {ds.source && onRefresh && !readOnly && (
            <button type="button" className="btn btn-ghost" onClick={onRefresh} title={`Leer de nuevo «${ds.source.name}» desde ${sourceLabel(ds.source)}`}><Icon name="refresh" /> Actualizar datos</button>
          )}
          <Menu label={busy ? 'Exportando…' : 'Exportar'} buttonClass="btn btn-primary" items={[
            exportNote && { label: exportNote, onClick: () => {}, disabled: true },
            { label: 'PowerPoint', hint: 'Un gráfico editable por diapositiva', onClick: () => run('pptx') },
            { label: 'Excel', hint: 'Una hoja por visual, más tus datos con las columnas calculadas', onClick: () => run('xlsx') },
            { label: 'PDF', hint: 'Usa «Guardar como PDF» al imprimir', onClick: () => run('pdf') },
          ]} />
          <Menu icon="more" label="Más acciones" buttonClass="btn btn-ghost" items={[
            cloud && { label: 'Mis proyectos', onClick: cloud.onOpenProjects },
            !readOnly && { label: 'Volver al tablero sugerido', hint: 'Reemplaza los visuales actuales', onClick: resetBoard },
            { label: 'Cargar otro archivo', onClick: onReset },
          ]} />
        </div>
      </div>

      <FilterBar columns={model.columns} rows={model.rows} filters={filters} setFilters={setFilters} readOnly={readOnly} />

      <div className="board-wrap">
        <div className="board" role="list">
          {visuals.map((v, i) => (
            <div key={v.id} id={`tile-${v.id}`} role="listitem" className={`tile-slot size-${v.size || 'half'}`}>
              <VisualTile cfg={v} view={views[i]} palette={palette} readOnly={readOnly}
                selected={new Set(filters.find((f) => f.col === v.group && f.values)?.values || [])}
                onSelect={typeInfo(v.type).noGroup ? null : (k) => toggleFilter(v.group, k)}
                onEdit={() => setEditingId(editingId === v.id ? null : v.id)} onDuplicate={() => duplicate(v.id)} onRemove={() => remove(v.id)} onPng={() => pngOf(v.id)}
                editing={editingId === v.id} chartRef={refFor(v.id)} />
            </div>
          ))}
          {!readOnly && (
            <div className="tile-slot size-quarter" role="listitem">
              <button type="button" className="tile tile-add" onClick={add}><Icon name="plus" size={22} /><span>Agregar visual</span></button>
            </div>
          )}
        </div>
        {editing && (
          <VisualPanel model={model} cfg={editing} index={editIndex} count={visuals.length}
            onChange={(cfg) => update(editing.id, cfg)} onClose={() => setEditingId(null)}
            onDuplicate={() => duplicate(editing.id)} onRemove={() => remove(editing.id)} onMove={(d) => move(editing.id, d)} />
        )}
      </div>

      <div className="ad-slot" data-slot="dashboard" ref={adRef} />

      <details className="card preview">
        <summary className="section-h">Tus datos <span className="muted small">(primeras 50 filas{filters.length ? ' con los filtros' : ''})</span></summary>
        <div className="table-wrap tall">
          <table>
            <thead><tr>{model.columns.map((c) => <th key={c.name} className={c.type === 'number' ? 'num' : ''}>{c.calc && <span className="badge t-fx">ƒx</span>}{c.name}<span className={`badge t-${c.type}`}>{TYPE_LABEL[c.type]}</span></th>)}</tr></thead>
            <tbody>
              {fRows.slice(0, 50).map((r, ri) => (
                <tr key={ri}>{r.map((v, ci) => <td key={ci} className={model.columns[ci]?.type === 'number' ? 'num' : ''}>{v instanceof Date ? v.toLocaleDateString('es-CO') : typeof v === 'number' ? fmt(v) : v}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {!cloud?.pro && (
        <aside className="pro-nudge">
          <p><b>DataLite Pro:</b> guarda tus tableros en la nube, compártelos con tu equipo con permisos de edición y descarga sin límite ni marca de agua. $19.900 al mes{cloud?.trialAvailable ? '; pruébalo gratis 14 días' : ''}.</p>
          {cloud?.onPro
            ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { track('interes_pro'); cloud.onPro(); }}>Ver Pro</button>
            : <a className="btn btn-ghost btn-sm" href="/#planes" onClick={() => track('interes_pro')}>Ver planes</a>}
        </aside>
      )}

      {showFormulas && <FormulaPanel model={model} formulas={formulas} setFormulas={setFormulas} onClose={() => setShowFormulas(false)} />}
      {toast}
    </div>
  );
}
