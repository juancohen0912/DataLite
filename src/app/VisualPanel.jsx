import React from 'react';
import { findGeoColumn, detectGeo } from '../lib/geo-match.js';
import { AGG_LABELS, autoGranularity } from '../lib/data.js';
import { isMeasureRef, measureRef } from '../lib/model.js';
import { VISUAL_TYPES, typeInfo, defaultAgg } from './visuals.js';
import { Field, Icon } from './ui.jsx';

const TYPE_LABEL = { number: 'Número', date: 'Fecha', text: 'Texto' };

export function TypeGlyph({ type }) {
  const d = {
    bar: 'M3 13V8M7 13V4M11 13V9', hbar: 'M3 4h7M3 8h10M3 12h5', line: 'M2 12l4-5 3 3 5-7', area: 'M2 13l4-5 3 3 5-7v9z',
    pie: 'M8 2a6 6 0 1 0 6 6H8z', donut: 'M8 2a6 6 0 1 1-6 6', combo: 'M3 13V9M7 13V7M11 13V10M2 7l4-3 4 2 4-3',
    treemap: 'M2 3h7v10H2zM9 3h5v6H9zM9 9h5v4H9z', map: 'M6 2.5l-3.5 1.5v9.5L6 12l4 1.5 3.5-1.5V2.5L10 4zM6 2.5V12M10 4v9.5', scatter: 'M4 11h.01M7 6h.01M10 9h.01M12 4h.01M5 8h.01',
    kpi: 'M2.5 4h11v8h-11zM5 9.5h3M5 6.5h6', gauge: 'M2.5 11a5.5 5.5 0 0111 0M8 11l2.5-3.5', matrix: 'M2.5 3.5h11v9h-11zM2.5 6.5h11M2.5 9.5h11M6.5 3.5v9M10 3.5v9',
  }[type];
  const fill = ['area', 'pie', 'treemap'].includes(type);
  return <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d={d} fill={fill ? 'currentColor' : 'none'} fillOpacity=".22" stroke="currentColor" strokeWidth={type === 'scatter' ? 3 : 1.7} strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function MetricSelect({ model, value, onChange, label = 'Valor' }) {
  const measures = model.measures.filter((m) => m.ast);
  const nums = model.columns.map((c, i) => ({ ...c, i })).filter((c) => c.type === 'number');
  const others = model.columns.map((c, i) => ({ ...c, i })).filter((c) => c.type !== 'number');
  return (
    <Field label={label}>
      <select value={String(value)} onChange={(e) => onChange(e.target.value.startsWith('m:') ? e.target.value : +e.target.value)}>
        <option value="-1">Cantidad de filas</option>
        {measures.length > 0 && <optgroup label="Medidas (ƒx)">{measures.map((m) => <option key={m.name} value={measureRef(m.name)}>ƒx {m.name}</option>)}</optgroup>}
        {nums.length > 0 && <optgroup label="Columnas numéricas">{nums.map((c) => <option key={c.i} value={c.i}>{c.calc ? 'ƒx ' : ''}{c.name}</option>)}</optgroup>}
        {others.length > 0 && <optgroup label="Otras columnas (para contar)">{others.map((c) => <option key={c.i} value={c.i}>{c.calc ? 'ƒx ' : ''}{c.name}</option>)}</optgroup>}
      </select>
    </Field>
  );
}

function AggSelect({ model, metric, value, onChange, label = 'Cálculo' }) {
  if (isMeasureRef(metric) || metric === -1) return null;
  const type = model.columns[metric]?.type;
  const allowed = type === 'number' ? ['SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT', 'COUNT'] : ['DISTINCT', 'COUNT'];
  return (
    <Field label={label}>
      <select value={allowed.includes(value) ? value : allowed[0]} onChange={(e) => onChange(e.target.value)}>
        {allowed.map((k) => <option key={k} value={k}>{k === 'COUNT' ? 'Conteo de filas' : AGG_LABELS[k]}</option>)}
      </select>
    </Field>
  );
}

const fixAgg = (model, metric, agg) => {
  if (isMeasureRef(metric)) return 'SUM';
  if (metric === -1) return 'COUNT';
  const type = model.columns[metric]?.type;
  if (type !== 'number') return ['DISTINCT', 'COUNT'].includes(agg) ? agg : 'DISTINCT';
  return agg && agg !== 'COUNT' ? agg : defaultAgg(model, metric);
};

export function VisualPanel({ model, cfg, onChange, onClose, onDuplicate, onRemove, onMove, index, count }) {
  const info = typeInfo(cfg.type);
  const set = (patch) => onChange({ ...cfg, ...patch });
  const groupIsDate = model.columns[cfg.group]?.type === 'date';
  const splitOpts = model.columns.map((c, i) => ({ ...c, i })).filter((c) => c.type === 'text' && c.i !== cfg.group && c.unique <= 200);

  function setType(t) {
    const ti = typeInfo(t);
    const patch = { type: t };
    if (ti.noSplit) patch.split = -1;
    if (ti.two && cfg.metric2 === undefined) {
      const nums = model.columns.map((c, i) => ({ ...c, i })).filter((c) => c.type === 'number' && c.i !== cfg.metric);
      patch.metric2 = nums[0]?.i ?? -1; patch.agg2 = fixAgg(model, patch.metric2, 'SUM');
    }
    if ((t === 'kpi' || t === 'gauge') && cfg.size !== 'quarter' && cfg.size !== 'third') patch.size = t === 'kpi' ? 'quarter' : 'third';
    if (!ti.noGroup && (cfg.type === 'kpi' || cfg.type === 'gauge') && (cfg.size === 'quarter')) patch.size = 'half';
    if (t === 'matrix') patch.heat = cfg.heat !== false;
    if (t === 'map') { const geo = findGeoColumn(model.columns, model.rows); if (geo) patch.group = geo.col; patch.topN = 'ALL'; }
    set(patch);
  }

  const mapOk = cfg.type !== 'map' || !!detectGeo(model.rows.slice(0, 3000).map((r) => r[cfg.group]));

  return (
    <aside className="vpanel" aria-label="Configurar visual">
      <div className="vpanel-head">
        <h2>Configurar visual</h2>
        <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Listo</button>
      </div>

      <div className="vpanel-sec">
        <p className="vpanel-label">Tipo</p>
        {['Gráficos', 'Indicadores', 'Tablas'].map((g) => (
          <div key={g} className="type-grid" role="radiogroup" aria-label={g}>
            {VISUAL_TYPES.filter((t) => t.group === g).map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={cfg.type === t.id} className={cfg.type === t.id ? 'on' : ''} onClick={() => setType(t.id)} title={t.label}>
                <TypeGlyph type={t.id} /><span>{t.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="vpanel-sec fields">
        {!info.noGroup && (
          <Field label="Agrupar por">
            <select value={cfg.group} onChange={(e) => {
              const g = +e.target.value; const date = model.columns[g]?.type === 'date';
              set({ group: g, gran: date ? autoGranularity(model.rows, g) : cfg.gran, split: cfg.split === g ? -1 : cfg.split, type: date && ['pie', 'donut', 'treemap'].includes(cfg.type) ? 'line' : cfg.type });
            }}>
              {model.columns.map((c, i) => <option key={i} value={i}>{c.calc ? 'ƒx ' : ''}{c.name} ({TYPE_LABEL[c.type]})</option>)}
            </select>
          </Field>
        )}
        {!info.noGroup && groupIsDate && (
          <Field label="Periodo">
            <select value={cfg.gran} onChange={(e) => set({ gran: e.target.value })}>
              <option value="day">Día</option><option value="month">Mes</option><option value="quarter">Trimestre</option><option value="year">Año</option>
            </select>
          </Field>
        )}
        <MetricSelect model={model} value={cfg.metric} label={info.two ? (cfg.type === 'scatter' ? 'Eje X' : 'Barras') : 'Valor'} onChange={(m) => set({ metric: m, agg: fixAgg(model, m, cfg.agg) })} />
        <AggSelect model={model} metric={cfg.metric} value={cfg.agg} onChange={(a) => set({ agg: a })} />
        {info.two && (
          <>
            <MetricSelect model={model} value={cfg.metric2 ?? -1} label={cfg.type === 'scatter' ? 'Eje Y' : 'Línea'} onChange={(m) => set({ metric2: m, agg2: fixAgg(model, m, cfg.agg2) })} />
            <AggSelect model={model} metric={cfg.metric2 ?? -1} value={cfg.agg2} label="Cálculo de la línea" onChange={(a) => set({ agg2: a })} />
          </>
        )}
        {isMeasureRef(cfg.metric) && <p className="hint">Las medidas se calculan con su fórmula en cada grupo. Edítalas en <b>Fórmulas</b>.</p>}
        {!info.noGroup && !info.noSplit && (
          <Field label={cfg.type === 'matrix' ? 'Columnas de la matriz' : 'Dividir por'}>
            <select value={cfg.split} onChange={(e) => set({ split: +e.target.value })}>
              <option value={-1}>Ninguno</option>
              {splitOpts.map((c) => <option key={c.i} value={c.i}>{c.calc ? 'ƒx ' : ''}{c.name}</option>)}
            </select>
          </Field>
        )}
        {cfg.type === 'map' && !mapOk && <p className="hint">Esta columna no parece tener departamentos ni municipios de Colombia. Elige en «Agrupar por» una columna con nombres como Antioquia, Valle o Medellín.</p>}
        {!info.noGroup && !groupIsDate && cfg.type !== 'map' && (
          <Field label="Mostrar">
            <select value={cfg.topN} onChange={(e) => set({ topN: e.target.value })}>
              <option value="5">Top 5</option><option value="10">Top 10</option><option value="15">Top 15</option><option value="25">Top 25</option><option value="ALL">Todos</option>
            </select>
          </Field>
        )}
        {!info.noGroup && cfg.type !== 'map' && (
          <Field label="Ordenar">
            <select value={cfg.sort} onChange={(e) => set({ sort: e.target.value })}>
              <option value="auto">Automático</option><option value="value-desc">Mayor a menor</option><option value="value-asc">Menor a mayor</option><option value="label">Alfabético</option>{groupIsDate && <option value="chrono">Cronológico</option>}
            </select>
          </Field>
        )}
        {(cfg.type === 'kpi' || cfg.type === 'gauge') && (
          <Field label="Meta (opcional)" hint="Muestra el avance frente a esta cifra.">
            <input className="input" type="number" inputMode="decimal" value={cfg.target ?? ''} placeholder="Ej. 1000000" onChange={(e) => set({ target: e.target.value === '' ? '' : Number(e.target.value) })} />
          </Field>
        )}
        {cfg.type === 'matrix' && (
          <label className="check"><input type="checkbox" checked={cfg.heat !== false} onChange={(e) => set({ heat: e.target.checked })} /> Mapa de calor (colorea según el valor)</label>
        )}
      </div>

      <div className="vpanel-sec fields">
        <Field label="Título" hint="Déjalo vacío para un título automático.">
          <input className="input" value={cfg.title || ''} maxLength={120} onChange={(e) => set({ title: e.target.value })} placeholder="Automático" />
        </Field>
        <Field label="Tamaño">
          <select value={cfg.size || 'half'} onChange={(e) => set({ size: e.target.value })}>
            <option value="quarter">Un cuarto</option><option value="third">Un tercio</option><option value="half">Mitad</option><option value="full">Ancho completo</option>
          </select>
        </Field>
      </div>

      <div className="vpanel-foot">
        <button type="button" className="btn btn-ghost btn-sm" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Mover antes"><Icon name="left" /> Antes</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Mover después">Después <Icon name="right" /></button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDuplicate}><Icon name="copy" /> Duplicar</button>
        <button type="button" className="btn btn-ghost btn-sm danger" onClick={onRemove}><Icon name="trash" /> Eliminar</button>
      </div>
    </aside>
  );
}
