// Visuales adicionales tipo Power BI, en SVG propio: mapa de árbol, combinado, dispersión, medidor, tarjeta y matriz.
import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { fmt, fmtShort } from './data.js';
import { INK, MUTED, GRID, FONT, PALETTE, niceScale, trunc, useWidth } from './Chart.jsx';

function Tip({ tip, width }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: Math.min(tip.x + 14, width - 220), top: Math.max(0, tip.y - 12) }}>
      <strong>{tip.title}</strong>
      {tip.lines.map((l, i) => <span key={i} className="tip-row">{l.c && <i style={{ background: l.c }} />}{l.t}</span>)}
    </div>
  );
}

function useTip(box) {
  const [tip, setTip] = useState(null);
  const show = (e, title, lines) => { const r = box.current.getBoundingClientRect(); setTip({ x: e.clientX - r.left, y: e.clientY - r.top, title, lines }); };
  return [tip, show, () => setTip(null)];
}

// ------------------------------------------------------------------ Mapa de árbol (squarified)

function squarify(values, x, y, w, h) {
  const total = values.reduce((s, v) => s + v.v, 0) || 1;
  const scale = (w * h) / total;
  const items = values.map((v) => ({ ...v, area: v.v * scale }));
  const out = [];
  let rect = { x, y, w, h };
  let row = [];
  const worst = (r, side) => { const s = r.reduce((a, b) => a + b.area, 0); const max = Math.max(...r.map((q) => q.area)), min = Math.min(...r.map((q) => q.area)); return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min)); };
  const layout = (r) => {
    const s = r.reduce((a, b) => a + b.area, 0);
    if (rect.w >= rect.h) { const cw = s / rect.h; let cy = rect.y; for (const q of r) { const ch = q.area / cw; out.push({ ...q, x: rect.x, y: cy, w: cw, h: ch }); cy += ch; } rect = { x: rect.x + cw, y: rect.y, w: rect.w - cw, h: rect.h }; }
    else { const ch = s / rect.w; let cx = rect.x; for (const q of r) { const cw = q.area / ch; out.push({ ...q, x: cx, y: rect.y, w: cw, h: ch }); cx += cw; } rect = { x: rect.x, y: rect.y + ch, w: rect.w, h: rect.h - ch }; }
  };
  for (const it of items) {
    const side = Math.min(rect.w, rect.h);
    if (!row.length || worst([...row, it], side) <= worst(row, side)) row.push(it);
    else { layout(row); row = [it]; }
  }
  if (row.length) layout(row);
  return out;
}

export const Treemap = forwardRef(function Treemap({ items, height = 320, valueLabel, onSelect, selected, palette = PALETTE }, ref) {
  const box = useRef(null), svgRef = useRef(null);
  const width = useWidth(box);
  const [tip, show, hide] = useTip(box);
  useImperativeHandle(ref, () => ({ svg: () => svgRef.current }), []);
  const total = items.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
  const cells = useMemo(() => squarify(items.filter((d) => d.value > 0).map((d, i) => ({ d, i, v: d.value })), 0, 0, width, height), [items, width, height]);
  const isSel = (k) => !selected || selected.size === 0 || selected.has(k);
  return (
    <div ref={box} className="chart-box" style={{ height }}>
      <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={width} height={height} role="img" aria-label={`${valueLabel}: mapa de árbol`}>
        <rect width={width} height={height} fill="#fff" />
        {cells.map(({ d, i, x, y, w, h }) => (
          <g key={d.key} style={{ cursor: onSelect && !d.isOther ? 'pointer' : 'default' }} opacity={isSel(d.key) ? 1 : 0.3}
            onMouseMove={(e) => show(e, d.label, [{ t: `${valueLabel}: ${fmt(d.value)} (${((d.value / total) * 100).toFixed(1)} %)` }])} onMouseLeave={hide}
            onClick={() => onSelect && !d.isOther && onSelect(d.key)}>
            <rect x={x + 1} y={y + 1} width={Math.max(0, w - 2)} height={Math.max(0, h - 2)} rx="3" fill={d.isOther ? '#9AA8A2' : palette[i % palette.length]} />
            {w > 60 && h > 34 && (
              <>
                <text x={x + 8} y={y + 20} fontSize="12.5" fontWeight="700" fill="#fff" fontFamily={FONT} pointerEvents="none">{trunc(d.label, Math.floor(w / 7.5))}</text>
                <text x={x + 8} y={y + 36} fontSize="11.5" fill="#fff" fillOpacity=".9" fontFamily={FONT} pointerEvents="none">{fmtShort(d.value)}</text>
              </>
            )}
          </g>
        ))}
      </svg>
      <Tip tip={tip} width={width} />
    </div>
  );
});

// ------------------------------------------------------------------ Combinado: barras + línea (eje secundario)

export const Combo = forwardRef(function Combo({ items, items2, label1, label2, height = 340, onSelect, selected, palette = PALETTE }, ref) {
  const box = useRef(null), svgRef = useRef(null);
  const width = useWidth(box);
  const [tip, show, hide] = useTip(box);
  useImperativeHandle(ref, () => ({ svg: () => svgRef.current }), []);
  const map2 = new Map(items2.map((d) => [d.key, d.value]));
  const v1 = items.map((d) => d.value), v2 = items.map((d) => map2.get(d.key) ?? 0);
  const s1 = niceScale(Math.min(0, ...v1), Math.max(0, ...v1), 5), s2 = niceScale(Math.min(0, ...v2), Math.max(0, ...v2), 5);
  const padL = Math.max(...s1.ticks.map((t) => fmtShort(t).length)) * 7 + 16, padR = Math.max(...s2.ticks.map((t) => fmtShort(t).length)) * 7 + 16;
  const padT = 34, padB = 34;
  const W = width - padL - padR, H = height - padT - padB;
  const n = items.length || 1, band = W / n, bw = Math.max(2, Math.min(48, band * 0.62));
  const y1 = (v) => padT + H - ((v - s1.lo) / (s1.hi - s1.lo)) * H;
  const y2 = (v) => padT + H - ((v - s2.lo) / (s2.hi - s2.lo)) * H;
  const every = Math.ceil(n / Math.max(1, W / 70));
  const isSel = (k) => !selected || selected.size === 0 || selected.has(k);
  const line = items.map((d, i) => `${i ? 'L' : 'M'}${(padL + (i + 0.5) * band).toFixed(1)},${y2(v2[i]).toFixed(1)}`).join('');
  return (
    <div ref={box} className="chart-box" style={{ height }}>
      <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={width} height={height} role="img" aria-label={`${label1} y ${label2}`}>
        <rect width={width} height={height} fill="#fff" />
        <g transform={`translate(${padL},12)`} fontFamily={FONT} fontSize="11" fill={INK}>
          <rect width="10" height="10" rx="2" fill={palette[0]} /><text x="15" y="9">{trunc(label1, 34)}</text>
          <g transform={`translate(${Math.min(260, W / 2)},0)`}><line x1="0" x2="14" y1="5" y2="5" stroke={palette[2]} strokeWidth="2.5" /><text x="19" y="9">{trunc(label2, 34)}</text></g>
        </g>
        {s1.ticks.map((t) => <g key={'a' + t}><line x1={padL} x2={padL + W} y1={y1(t)} y2={y1(t)} stroke={GRID} /><text x={padL - 8} y={y1(t)} textAnchor="end" dominantBaseline="central" fontSize="11" fill={MUTED} fontFamily={FONT}>{fmtShort(t)}</text></g>)}
        {s2.ticks.map((t) => <text key={'b' + t} x={padL + W + 8} y={y2(t)} dominantBaseline="central" fontSize="11" fill={palette[2]} fontFamily={FONT}>{fmtShort(t)}</text>)}
        {items.map((d, i) => {
          const c = padL + (i + 0.5) * band, top = y1(Math.max(0, d.value)), base = y1(Math.min(0, d.value));
          return (
            <g key={d.key} style={{ cursor: onSelect && !d.isOther ? 'pointer' : 'default' }}
              onMouseMove={(e) => show(e, d.label, [{ c: palette[0], t: `${label1}: ${fmt(d.value)}` }, { c: palette[2], t: `${label2}: ${fmt(v2[i])}` }])} onMouseLeave={hide}
              onClick={() => onSelect && !d.isOther && onSelect(d.key)}>
              <rect x={padL + i * band} y={padT} width={band} height={H} fill="transparent" />
              <rect x={c - bw / 2} y={top} width={bw} height={Math.max(1, base - top)} rx="3" fill={palette[0]} opacity={isSel(d.key) ? 1 : 0.3} />
              {i % every === 0 && <text x={c} y={padT + H + 18} textAnchor="middle" fontSize="11" fill={INK} fontFamily={FONT}>{trunc(d.label, Math.max(4, Math.floor(band * every / 6.5)))}</text>}
            </g>
          );
        })}
        <path d={line} fill="none" stroke={palette[2]} strokeWidth="2.5" strokeLinejoin="round" pointerEvents="none" />
        {n <= 40 && items.map((d, i) => <circle key={'p' + d.key} cx={padL + (i + 0.5) * band} cy={y2(v2[i])} r="3.5" fill="#fff" stroke={palette[2]} strokeWidth="2" pointerEvents="none" />)}
      </svg>
      <Tip tip={tip} width={width} />
    </div>
  );
});

// ------------------------------------------------------------------ Dispersión (un punto por categoría)

export const Scatter = forwardRef(function Scatter({ items, items2, label1, label2, height = 340, onSelect, selected, palette = PALETTE }, ref) {
  const box = useRef(null), svgRef = useRef(null);
  const width = useWidth(box);
  const [tip, show, hide] = useTip(box);
  useImperativeHandle(ref, () => ({ svg: () => svgRef.current }), []);
  const map2 = new Map(items2.map((d) => [d.key, d.value]));
  const pts = items.filter((d) => !d.isOther && map2.has(d.key)).slice(0, 400).map((d) => ({ d, x: d.value, y: map2.get(d.key) }));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const sx = niceScale(Math.min(0, ...xs), Math.max(0, ...xs), 5), sy = niceScale(Math.min(0, ...ys), Math.max(0, ...ys), 5);
  const padL = Math.max(...sy.ticks.map((t) => fmtShort(t).length)) * 7 + 18, padB = 44, padT = 12, padR = 18;
  const W = width - padL - padR, H = height - padT - padB;
  const X = (v) => padL + ((v - sx.lo) / (sx.hi - sx.lo)) * W, Y = (v) => padT + H - ((v - sy.lo) / (sy.hi - sy.lo)) * H;
  const isSel = (k) => !selected || selected.size === 0 || selected.has(k);
  const labelled = pts.length <= 12;
  return (
    <div ref={box} className="chart-box" style={{ height }}>
      <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={width} height={height} role="img" aria-label={`${label2} frente a ${label1}`}>
        <rect width={width} height={height} fill="#fff" />
        {sy.ticks.map((t) => <g key={'y' + t}><line x1={padL} x2={padL + W} y1={Y(t)} y2={Y(t)} stroke={GRID} /><text x={padL - 8} y={Y(t)} textAnchor="end" dominantBaseline="central" fontSize="11" fill={MUTED} fontFamily={FONT}>{fmtShort(t)}</text></g>)}
        {sx.ticks.map((t) => <g key={'x' + t}><line x1={X(t)} x2={X(t)} y1={padT} y2={padT + H} stroke={GRID} /><text x={X(t)} y={padT + H + 16} textAnchor="middle" fontSize="11" fill={MUTED} fontFamily={FONT}>{fmtShort(t)}</text></g>)}
        <text x={padL + W / 2} y={height - 6} textAnchor="middle" fontSize="11.5" fontWeight="600" fill={INK} fontFamily={FONT}>{trunc(label1, 60)}</text>
        <text transform={`translate(12,${padT + H / 2}) rotate(-90)`} textAnchor="middle" fontSize="11.5" fontWeight="600" fill={INK} fontFamily={FONT}>{trunc(label2, 40)}</text>
        {pts.map(({ d, x, y }, i) => (
          <g key={d.key} style={{ cursor: onSelect ? 'pointer' : 'default' }} opacity={isSel(d.key) ? 1 : 0.25}
            onMouseMove={(e) => show(e, d.label, [{ t: `${label1}: ${fmt(x)}` }, { t: `${label2}: ${fmt(y)}` }])} onMouseLeave={hide}
            onClick={() => onSelect && onSelect(d.key)}>
            <circle cx={X(x)} cy={Y(y)} r="7" fill={palette[i % palette.length]} fillOpacity=".85" stroke="#fff" strokeWidth="1.5" />
            {labelled && <text x={X(x) + 10} y={Y(y) + 4} fontSize="11" fill={INK} fontFamily={FONT} pointerEvents="none">{trunc(d.label, 18)}</text>}
          </g>
        ))}
      </svg>
      <Tip tip={tip} width={width} />
    </div>
  );
});

// ------------------------------------------------------------------ Medidor

export const Gauge = forwardRef(function Gauge({ value, target, label, height = 240, palette = PALETTE }, ref) {
  const box = useRef(null), svgRef = useRef(null);
  const width = useWidth(box);
  useImperativeHandle(ref, () => ({ svg: () => svgRef.current }), []);
  const max = target > 0 ? Math.max(target * 1.2, value) : Math.max(1, value * 1.25);
  const R = Math.min(width / 2 - 24, height - 70), cx = width / 2, cy = R + 22, th = Math.max(16, R * 0.22);
  const ang = (v) => Math.PI * (1 - Math.max(0, Math.min(1, v / max)));
  const pt = (a, r) => [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  const arc = (v0, v1, r) => { const [x0, y0] = pt(ang(v0), r), [x1, y1] = pt(ang(v1), r); return `M${x0},${y0}A${r},${r} 0 0 1 ${x1},${y1}`; };
  const pct = target > 0 ? value / target : null;
  const color = pct === null ? palette[0] : pct >= 1 ? palette[0] : pct >= 0.8 ? palette[2] : palette[3];
  const [tx1, ty1] = pt(ang(target), R - th / 2 - 4), [tx2, ty2] = pt(ang(target), R + th / 2 + 4);
  return (
    <div ref={box} className="chart-box" style={{ height }}>
      <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={width} height={height} role="img" aria-label={`${label}: ${fmt(value)}${target ? ` de ${fmt(target)}` : ''}`}>
        <rect width={width} height={height} fill="#fff" />
        <path d={arc(0, max, R)} fill="none" stroke="#E6ECE9" strokeWidth={th} />
        {value > 0 && <path d={arc(0, Math.min(value, max), R)} fill="none" stroke={color} strokeWidth={th} />}
        {target > 0 && <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke={INK} strokeWidth="2.5" />}
        <text x={cx} y={cy - 8} textAnchor="middle" fontSize={Math.max(22, R / 3.2)} fontWeight="800" fill={INK} fontFamily={FONT}>{fmtShort(value)}</text>
        {pct !== null && <text x={cx} y={cy + 16} textAnchor="middle" fontSize="13" fontWeight="600" fill={color} fontFamily={FONT}>{(pct * 100).toFixed(0)} % de la meta</text>}
        <text x={cx - R} y={cy + 20} textAnchor="middle" fontSize="11" fill={MUTED} fontFamily={FONT}>0</text>
        <text x={cx + R} y={cy + 20} textAnchor="middle" fontSize="11" fill={MUTED} fontFamily={FONT}>{fmtShort(max)}</text>
        {target > 0 && <text x={width / 2} y={height - 8} textAnchor="middle" fontSize="12" fill={MUTED} fontFamily={FONT}>Meta: {fmt(target)}</text>}
      </svg>
    </div>
  );
});

// ------------------------------------------------------------------ Tarjeta KPI con tendencia

export function KpiCard({ value, label, trend, target, palette = PALETTE }) {
  const pts = trend?.items?.slice(-24) || [];
  const last = pts.at(-1)?.value, prev = pts.at(-2)?.value;
  const delta = pts.length >= 2 && prev ? (last - prev) / Math.abs(prev) : null;
  const w = 220, h = 46;
  let path = '';
  if (pts.length >= 2) {
    const vs = pts.map((p) => p.value), lo = Math.min(...vs), hi = Math.max(...vs) || 1;
    path = pts.map((p, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * w).toFixed(1)},${(h - 4 - ((p.value - lo) / (hi - lo || 1)) * (h - 8)).toFixed(1)}`).join('');
  }
  const pct = target > 0 ? value / target : null;
  return (
    <div className="kpi-card">
      <p className="kpi-card-v">{fmtShort(value)}</p>
      {label && <p className="kpi-card-l">{label}</p>}
      {delta !== null && Number.isFinite(delta) && (
        <p className={`kpi-delta ${delta >= 0 ? 'up' : 'down'}`}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta * 100).toFixed(1)} % vs. {pts.at(-2).label}
        </p>
      )}
      {pct !== null && (
        <div className="kpi-target" title={`Meta: ${fmt(target)}`}>
          <span style={{ width: `${Math.min(100, pct * 100)}%`, background: pct >= 1 ? palette[0] : pct >= 0.8 ? palette[2] : palette[3] }} />
          <small>{(pct * 100).toFixed(0)} % de la meta ({fmtShort(target)})</small>
        </div>
      )}
      {path && <svg className="kpi-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><path d={path} fill="none" stroke={palette[0]} strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>}
    </div>
  );
}

// ------------------------------------------------------------------ Matriz con mapa de calor

function heat(v, lo, hi, base) {
  if (typeof v !== 'number' || hi === lo) return undefined;
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return `color-mix(in srgb, ${base} ${Math.round(8 + t * 62)}%, white)`;
}

export function Matrix({ view, heatmap = true, palette = PALETTE, onSelect, selected, maxRows = 200 }) {
  const { items, series, groupName, valueLabel } = view;
  const rows = items.slice(0, maxRows);
  const showPct = !series.length && ['SUM', 'COUNT'].includes(view.agg) && view.total;
  const cells = series.length ? rows.flatMap((d) => series.map((s) => d.byS?.[s] || 0)) : rows.map((d) => d.value);
  const lo = Math.min(...cells), hi = Math.max(...cells);
  const colTotals = series.map((s) => rows.reduce((t, d) => t + (d.byS?.[s] || 0), 0));
  const additive = ['SUM', 'COUNT'].includes(view.agg);
  const isSel = (k) => !selected || selected.size === 0 || selected.has(k);
  return (
    <div className="table-wrap matrix">
      <table>
        <thead><tr><th>{groupName}</th>{series.length ? series.map((s) => <th key={s} className="num">{s}</th>) : <th className="num">{valueLabel}</th>}{series.length > 0 && additive && <th className="num">Total</th>}{showPct && <th className="num">%</th>}</tr></thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.key} className={isSel(d.key) ? '' : 'dim'} onClick={() => onSelect && !d.isOther && onSelect(d.key)} style={{ cursor: onSelect && !d.isOther ? 'pointer' : 'default' }}>
              <td>{d.label}</td>
              {series.length
                ? series.map((s) => <td key={s} className="num" style={{ background: heatmap ? heat(d.byS?.[s] || 0, lo, hi, palette[0]) : undefined }}>{fmt(d.byS?.[s] || 0)}</td>)
                : <td className="num" style={{ background: heatmap ? heat(d.value, lo, hi, palette[0]) : undefined }}>{fmt(d.value)}</td>}
              {series.length > 0 && additive && <td className="num strong">{fmt(d.value)}</td>}
              {showPct && <td className="num muted">{((d.value / view.total) * 100).toFixed(1)}</td>}
            </tr>
          ))}
        </tbody>
        {additive && (
          <tfoot><tr><td>Total</td>{series.length ? series.map((s, i) => <td key={s} className="num">{fmt(colTotals[i])}</td>) : <td className="num">{fmt(view.total)}</td>}{series.length > 0 && <td className="num">{fmt(view.total)}</td>}{showPct && <td className="num muted">100</td>}</tr></tfoot>
        )}
      </table>
      {items.length > maxRows && <p className="hint">Se muestran las primeras {maxRows} de {items.length} filas.</p>}
    </div>
  );
}
