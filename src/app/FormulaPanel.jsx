import React, { useEffect, useMemo, useRef, useState } from 'react';
import { evalRow, evalMeasure, finalize, FUNCTION_HELP } from '../lib/formula.js';
import { tryFormula, FORMULA_LIMITS } from '../lib/model.js';
import { fmt } from '../lib/data.js';
import { Modal, Icon, Field, track } from './ui.jsx';

const KINDS = {
  columns: { title: 'Columnas calculadas', one: 'columna', help: 'Se calcula una vez por fila, como una columna nueva en Excel. Puedes agrupar, filtrar y graficar con ella.' },
  measures: { title: 'Medidas', one: 'medida', help: 'Se calcula sobre las filas de cada grupo, como las medidas de Power BI. Úsala como «Valor» en cualquier visual.' },
  functions: { title: 'Funciones propias', one: 'función', help: 'Crea tu propia función reutilizable a partir de otras. Luego úsala en columnas y medidas como cualquier función de Excel.' },
};

const show = (v) => (v === null || v === undefined || v === '' ? '(vacío)' : v instanceof Date ? v.toLocaleDateString('es-CO') : typeof v === 'number' ? fmt(v) : String(v));

function examples(model, kind) {
  const nums = model.columns.filter((c) => c.type === 'number' && !c.calc).map((c) => c.name);
  const texts = model.columns.filter((c) => c.type === 'text').map((c) => c.name);
  const dates = model.columns.filter((c) => c.type === 'date').map((c) => c.name);
  const [a, b] = nums;
  const out = [];
  if (kind === 'columns') {
    if (a && b) out.push({ name: `${a} - ${b}`, expr: `=[${a}]-[${b}]` });
    if (a) {
      const i = model.columns.findIndex((c) => c.name === a);
      let sum = 0, n = 0; for (const r of model.rows) if (typeof r[i] === 'number') { sum += r[i]; n++; }
      const avg = n ? Math.round(sum / n) : 0;
      out.push({ name: `Nivel de ${a}`, expr: `=SI([${a}]>=${avg};"Alto";"Bajo")` });
    }
    if (dates[0]) out.push({ name: 'Mes', expr: `=TEXTO([${dates[0]}];"mmmm")` }, { name: 'Año', expr: `=AÑO([${dates[0]}])` });
    if (texts[0]) out.push({ name: `${texts[0]} (mayúsculas)`, expr: `=MAYUSC([${texts[0]}])` });
  } else if (kind === 'measures') {
    if (a) out.push({ name: `Total ${a}`, expr: `=SUMA([${a}])` });
    if (a && b) out.push({ name: `${a} por ${b}`, expr: `=DIVIDIR(SUMA([${a}]);SUMA([${b}]))` });
    if (a && b) out.push({ name: `Margen % ${a}`, expr: `=DIVIDIR(SUMA([${a}])-SUMA([${b}]);SUMA([${a}]))` });
    if (texts[0]) out.push({ name: `${texts[0]} distintos`, expr: `=CONTAR.UNICOS([${texts[0]}])` });
  } else {
    out.push({ name: 'MARGEN', params: 'venta; costo', expr: '=DIVIDIR(venta-costo;venta;0)' });
    out.push({ name: 'VARIACION', params: 'actual; anterior', expr: '=DIVIDIR(actual-anterior;ABS(anterior))' });
    out.push({ name: 'CLASIFICAR', params: 'valor; meta', expr: '=SI(valor>=meta;"Cumple";SI(valor>=meta*0,8;"En riesgo";"No cumple"))' });
  }
  return out.slice(0, 4);
}

function Editor({ kind, model, initial, onSave, onCancel, existingNames }) {
  const [name, setName] = useState(initial?.name || '');
  const [params, setParams] = useState(initial?.params?.join('; ') || '');
  const [expr, setExpr] = useState(initial?.expr ?? initial?.body ?? '=');
  const [check, setCheck] = useState(null);
  const ta = useRef(null);
  const paramList = params.split(/[;,]/).map((p) => p.trim()).filter(Boolean);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!expr.trim() || expr.trim() === '=') { setCheck(null); return; }
      const k = kind === 'columns' ? 'column' : kind === 'measures' ? 'measure' : 'function';
      const r = tryFormula(k, expr, model, { name: name || 'F', params: paramList });
      if (r.ok && r.ast) {
        try {
          if (k === 'column') r.preview = model.rows.slice(0, 6).map((row) => show(finalize(evalRow(r.ast, row))));
          else r.preview = [show(finalize(evalMeasure(r.ast, model.rows, null)))];
        } catch { r.preview = null; }
      }
      setCheck(r);
    }, 250);
    return () => clearTimeout(t);
  }, [expr, params, name, kind, model]); // eslint-disable-line react-hooks/exhaustive-deps

  const insert = (txt) => {
    const el = ta.current;
    if (!el) { setExpr((e) => e + txt); return; }
    const s = el.selectionStart ?? expr.length, e = el.selectionEnd ?? expr.length;
    const next = expr.slice(0, s) + txt + expr.slice(e);
    setExpr(next);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + txt.length; });
  };
  const lowerName = name.trim().toLocaleLowerCase('es');
  const nameTaken = lowerName && lowerName !== (initial?.name || '').toLocaleLowerCase('es') && existingNames.has(lowerName);
  const canSave = name.trim() && check?.ok && !nameTaken;

  return (
    <div className="f-editor">
      <div className="f-row">
        <Field label={kind === 'functions' ? 'Nombre de la función' : 'Nombre'}>
          <input className="input" value={name} maxLength={60} onChange={(e) => setName(kind === 'functions' ? e.target.value.toUpperCase().replace(/\s/g, '_') : e.target.value)} placeholder={kind === 'functions' ? 'MARGEN' : kind === 'measures' ? 'Ventas totales' : 'Utilidad'} />
        </Field>
        {kind === 'functions' && (
          <Field label="Parámetros" hint="Separados por punto y coma.">
            <input className="input" value={params} onChange={(e) => setParams(e.target.value)} placeholder="venta; costo" />
          </Field>
        )}
      </div>
      {nameTaken && <p className="error small-err">Ya existe algo con ese nombre.</p>}
      <Field label="Fórmula">
        <textarea ref={ta} className="input f-input" rows={3} spellCheck={false} value={expr} maxLength={2000} onChange={(e) => setExpr(e.target.value)} aria-describedby="f-status" />
      </Field>
      {kind !== 'functions' && (
        <div className="f-chips" aria-label="Insertar columna">
          <span className="muted small">Insertar:</span>
          {model.columns.map((c) => <button key={c.name} type="button" className="f-chip" onClick={() => insert(`[${c.name}]`)}>{c.name}</button>)}
          {kind === 'measures' && model.measures.filter((m) => m.ast && m.name !== initial?.name).map((m) => <button key={m.name} type="button" className="f-chip f-chip-m" onClick={() => insert(`[${m.name}]`)}>ƒx {m.name}</button>)}
        </div>
      )}
      {kind === 'functions' && paramList.length > 0 && (
        <div className="f-chips"><span className="muted small">Parámetros:</span>{paramList.map((p) => <button key={p} type="button" className="f-chip" onClick={() => insert(p)}>{p}</button>)}</div>
      )}
      <div id="f-status" className={`f-status ${check ? (check.ok ? 'ok' : 'bad') : ''}`} role="status" aria-live="polite">
        {!check && <span className="muted">Escribe la fórmula; la revisamos mientras escribes.</span>}
        {check && !check.ok && <span>⚠ {check.error}</span>}
        {check?.ok && (
          <span>✓ Fórmula válida{check.preview ? (kind === 'measures' ? ` · Total: ${check.preview[0]}` : ` · Primeras filas: ${check.preview.join(' · ')}`) : ''}</span>
        )}
      </div>
      <div className="f-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancelar</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={!canSave} onClick={() => onSave(kind === 'functions' ? { name: name.trim(), params: paramList, body: expr } : { name: name.trim(), expr })}>
          {initial ? 'Guardar cambios' : `Crear ${KINDS[kind].one}`}
        </button>
      </div>
    </div>
  );
}

function HelpList() {
  const [q, setQ] = useState('');
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return (
    <div className="f-help">
      <input className="input" placeholder="Buscar función…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar función" />
      {FUNCTION_HELP.map(([group, fns]) => {
        const list = fns.filter(([n, s]) => !q || norm(n + s).includes(norm(q)));
        if (!list.length) return null;
        return (
          <section key={group}>
            <h4>{group}</h4>
            <ul>{list.map(([n, s]) => <li key={n}><code>{s}</code></li>)}</ul>
          </section>
        );
      })}
      <p className="muted small">También funcionan los nombres en inglés (IF, SUM, AVERAGE, LEFT, YEAR…) y los operadores + − * / ^ &amp; = &lt;&gt; &lt; &gt; &lt;= &gt;= y %. Usa «;» para separar argumentos y «,» para decimales, o «,» para separar y «.» para decimales.</p>
    </div>
  );
}

export function FormulaPanel({ model, formulas, setFormulas, onClose, initialTab = 'columns' }) {
  const [tab, setTab] = useState(initialTab);
  const [editing, setEditing] = useState(null); // {index} o {index:-1, preset}
  const list = formulas[tab] || [];
  const statusList = tab === 'columns' ? model.calc : tab === 'measures' ? model.measures : model.functions;
  const existingNames = useMemo(() => new Set([...model.columns.map((c) => c.name), ...model.measures.map((m) => m.name)].map((n) => n.toLocaleLowerCase('es'))), [model]);
  const full = list.length >= FORMULA_LIMITS[tab];

  const save = (item) => {
    const next = list.slice();
    if (editing.index >= 0) next[editing.index] = item; else next.push(item);
    setFormulas({ ...formulas, [tab]: next });
    setEditing(null);
    track('formula_guardada', { tipo: tab });
  };
  const remove = (i) => { setFormulas({ ...formulas, [tab]: list.filter((_, k) => k !== i) }); if (editing?.index === i) setEditing(null); };

  return (
    <Modal title="Fórmulas" onClose={onClose} wide>
      <div className="tabs" role="tablist">
        {[...Object.entries(KINDS), ['help', { title: 'Funciones disponibles' }]].map(([k, v]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setEditing(null); }}>
            {v.title}{k !== 'help' && formulas[k]?.length ? <span className="count">{formulas[k].length}</span> : null}
          </button>
        ))}
      </div>
      {tab === 'help' ? <HelpList /> : (
        <div className="f-tab">
          <p className="muted">{KINDS[tab].help}</p>
          {list.length > 0 && (
            <ul className="f-list">
              {list.map((it, i) => {
                const st = statusList[i] || {};
                return (
                  <li key={`${it.name}-${i}`} className={st.error ? 'has-error' : ''}>
                    <div className="f-item">
                      <p className="f-name">{tab === 'functions' ? `${it.name}(${(it.params || []).join('; ')})` : it.name}</p>
                      <code className="f-expr">{it.expr ?? it.body}</code>
                      {st.error && <p className="error small-err">⚠ {st.error}</p>}
                      {!st.error && st.errors > 0 && <p className="hint">{st.errors.toLocaleString('es-CO')} filas dieron error (por ejemplo, división por cero) y quedaron vacías. Usa SI.ERROR o DIVIDIR.</p>}
                    </div>
                    <div className="f-item-actions">
                      <button type="button" className="icon-btn" aria-label={`Editar ${it.name}`} onClick={() => setEditing({ index: i })}><Icon name="edit" /></button>
                      <button type="button" className="icon-btn" aria-label={`Eliminar ${it.name}`} onClick={() => remove(i)}><Icon name="trash" /></button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {editing ? (
            <Editor key={`${tab}-${editing.index}-${editing.preset?.name || ''}`} kind={tab} model={model}
              initial={editing.index >= 0 ? list[editing.index] : editing.preset ? { ...editing.preset, params: editing.preset.params ? editing.preset.params.split(';').map((s) => s.trim()) : undefined, body: editing.preset.expr } : null}
              existingNames={existingNames} onSave={save} onCancel={() => setEditing(null)} />
          ) : (
            <div className="f-new">
              <button type="button" className="btn btn-primary btn-sm" disabled={full} onClick={() => setEditing({ index: -1 })}><Icon name="plus" /> Nueva {KINDS[tab].one}</button>
              {full && <span className="muted small">Llegaste al máximo de {FORMULA_LIMITS[tab]}.</span>}
              {!full && (
                <div className="f-examples">
                  <span className="muted small">Ejemplos:</span>
                  {examples(model, tab).map((ex) => <button key={ex.name} type="button" className="f-chip" onClick={() => setEditing({ index: -1, preset: ex })}>{ex.name}</button>)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
