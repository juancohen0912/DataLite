import React, { useEffect, useMemo, useRef, useState } from 'react';
import { distinctValues, dateRange, isoDay } from '../lib/data.js';
import { Icon, track } from './ui.jsx';

const fmtDay = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

export function FilterBar({ columns, rows, filters, setFilters, readOnly }) {
  const [open, setOpen] = useState(false);
  const [col, setCol] = useState(-1);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [range, setRange] = useState({ from: '', to: '' });
  const pop = useRef(null);
  const options = columns.map((c, i) => ({ ...c, i })).filter((c) => (c.type === 'text' && c.unique <= 2000) || c.type === 'date');
  const isDate = col >= 0 && columns[col]?.type === 'date';
  const values = useMemo(() => (col >= 0 && !isDate ? distinctValues(rows, col, 1000) : []), [rows, col, isDate]);
  const bounds = useMemo(() => (isDate ? dateRange(rows, col) : null), [rows, col, isDate]);
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
    const cur = filters.find((f) => f.col === i);
    setPicked(new Set(cur?.values || []));
    setRange({ from: cur?.from || '', to: cur?.to || '' });
    setOpen(true);
  }
  function apply() {
    const next = filters.filter((f) => f.col !== col);
    if (isDate) { if (range.from || range.to) next.push({ col, from: range.from || null, to: range.to || null }); }
    else if (picked.size) next.push({ col, values: [...picked] });
    setFilters(next); setOpen(false); track('filtro_aplicado', { tipo: isDate ? 'fecha' : 'valores' });
  }
  const quick = (months) => {
    if (!bounds) return;
    const to = bounds.max;
    const from = new Date(to.getFullYear(), to.getMonth() - months + 1, 1);
    setRange({ from: isoDay(from), to: isoDay(to) });
  };

  const chipText = (f) => {
    if (f.values) return f.values.length > 2 ? `${f.values.slice(0, 2).join(', ')} +${f.values.length - 2}` : f.values.join(', ');
    if (f.from && f.to) return `${fmtDay(f.from)} – ${fmtDay(f.to)}`;
    return f.from ? `desde ${fmtDay(f.from)}` : `hasta ${fmtDay(f.to)}`;
  };

  return (
    <div className="filterbar">
      <span className="fb-label"><Icon name="filter" size={14} /> Filtros</span>
      {filters.length === 0 && <span className="muted small">Ninguno. Toca una barra o porción para filtrar todo el tablero.</span>}
      {filters.map((f) => (
        <span key={f.col} className="chip">
          <button type="button" className="chip-main" onClick={() => startEdit(f.col)}>
            <b>{columns[f.col].name}:</b> {chipText(f)}
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
                {options.length === 0 && <p className="muted">No hay columnas de texto o fecha para filtrar.</p>}
                <ul className="pop-list">
                  {options.map((c) => (
                    <li key={c.i}><button type="button" onClick={() => startEdit(c.i)}>{c.name}<small>{c.type === 'date' ? 'rango de fechas' : `${c.unique} valores`}</small></button></li>
                  ))}
                </ul>
              </>
            ) : isDate ? (
              <>
                <p className="pop-title"><Icon name="calendar" size={14} /> {columns[col].name}</p>
                {bounds && <p className="muted small">Datos entre {bounds.min.toLocaleDateString('es-CO')} y {bounds.max.toLocaleDateString('es-CO')}</p>}
                <div className="date-range">
                  <label className="field"><span>Desde</span><input type="date" className="input" value={range.from} min={bounds ? isoDay(bounds.min) : undefined} max={range.to || (bounds ? isoDay(bounds.max) : undefined)} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
                  <label className="field"><span>Hasta</span><input type="date" className="input" value={range.to} min={range.from || (bounds ? isoDay(bounds.min) : undefined)} max={bounds ? isoDay(bounds.max) : undefined} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
                </div>
                <div className="pop-tools">
                  <button type="button" className="btn btn-link btn-sm" onClick={() => quick(1)}>Último mes</button>
                  <button type="button" className="btn btn-link btn-sm" onClick={() => quick(3)}>Últimos 3 meses</button>
                  <button type="button" className="btn btn-link btn-sm" onClick={() => quick(12)}>Últimos 12 meses</button>
                </div>
                <div className="pop-foot">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCol(-1)}>Atrás</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={apply}>Aplicar filtro</button>
                </div>
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
      {readOnly && <span className="muted small fb-note">Los filtros que apliques no cambian el proyecto compartido.</span>}
    </div>
  );
}
