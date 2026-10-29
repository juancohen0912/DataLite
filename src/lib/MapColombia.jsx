// Mapa de Colombia: coropleta por departamento o burbujas por municipio. SVG propio, sin servicios externos.
import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { fmt, fmtShort } from './data.js';
import { INK, MUTED, FONT, PALETTE, useWidth } from './Chart.jsx';
import { VIEW, SA_INSET, DEPARTMENTS, MUNICIPALITIES, GEO_SOURCE } from './geo-colombia.js';
import { deptCode, muniCode, detectGeo } from './geo-match.js';

const NODATA = '#E6ECE9';
const hex = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
const muniXY = new Map(MUNICIPALITIES.map((m) => [m[0], [m[2], m[3], m[1]]]));

const MapColombia = forwardRef(function MapColombia({ items, height = 420, valueLabel, onSelect, selected, palette = PALETTE }, ref) {
  const box = useRef(null), svgRef = useRef(null);
  const width = useWidth(box);
  const [tip, setTip] = useState(null);
  useImperativeHandle(ref, () => ({ svg: () => svgRef.current }), []);

  const data = useMemo(() => {
    const clean = items.filter((d) => !d.isOther);
    const level = detectGeo(clean.map((d) => d.label)) || 'dept';
    const byCode = new Map(); const missing = [];
    for (const d of clean) {
      const code = level === 'dept' ? deptCode(d.label) : muniCode(d.label);
      if (!code || (level === 'city' && !muniXY.has(code))) { missing.push(d.label); continue; }
      const prev = byCode.get(code);
      byCode.set(code, prev ? { ...prev, value: prev.value + d.value, keys: [...prev.keys, d.key] } : { label: d.label, value: d.value, keys: [d.key] });
    }
    const vals = [...byCode.values()].map((d) => d.value).filter((v) => typeof v === 'number' && isFinite(v));
    return { level, byCode, missing, min: Math.min(0, ...vals), max: Math.max(1e-9, ...vals) };
  }, [items]);

  const pad = 8, legendH = 34;
  const scale = Math.min((width - pad * 2) / VIEW.w, (height - legendH - pad * 2) / VIEW.h);
  const mw = VIEW.w * scale, mh = VIEW.h * scale;
  const ox = (width - mw) / 2, oy = pad;
  const base = palette[0] || '#0E7A55';
  const color = (v) => (typeof v !== 'number' ? NODATA : mix('#EEF5F1', base, data.max === data.min ? 1 : Math.max(0.12, (v - data.min) / (data.max - data.min))));
  const isSel = (keys) => !selected || selected.size === 0 || keys.some((k) => selected.has(k));
  const show = (e, title, value) => { const r = box.current.getBoundingClientRect(); setTip({ x: e.clientX - r.left, y: e.clientY - r.top, title, value }); };
  const top = data.level === 'city' ? [...data.byCode.entries()].sort((a, b) => b[1].value - a[1].value) : [];
  const rMax = Math.max(6, Math.min(26, mw / 18));
  const radius = (v) => Math.max(2.5, Math.sqrt(Math.max(0, v) / data.max) * rMax);

  return (
    <div ref={box} className="chart-box map-box" style={{ height }}>
      <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={width} height={height} role="img" aria-label={`${valueLabel} por ${data.level === 'dept' ? 'departamento' : 'municipio'} en el mapa de Colombia`} fontFamily={FONT}>
        <rect width={width} height={height} fill="#fff" />
        <g transform={`translate(${ox},${oy}) scale(${scale})`}>
          <rect x={SA_INSET.x} y={SA_INSET.y} width={SA_INSET.w} height={SA_INSET.h} fill="none" stroke="#C9D3CF" strokeWidth={1 / scale} rx={6} />
          {DEPARTMENTS.map(([code, name, d]) => {
            const hit = data.level === 'dept' ? data.byCode.get(code) : null;
            const sel = hit ? isSel(hit.keys) : true;
            return (
              <path key={code} d={d} fill={data.level === 'dept' ? color(hit?.value) : '#F1F4F2'} stroke="#fff" strokeWidth={1.2 / scale}
                opacity={sel ? 1 : 0.35} style={{ cursor: hit && onSelect ? 'pointer' : 'default' }}
                onMouseMove={(e) => show(e, name.replace(/^ARCHIPIÉLAGO DE /, ''), hit ? hit.value : null)} onMouseLeave={() => setTip(null)}
                onClick={() => hit && onSelect?.(hit.keys[0])} />
            );
          })}
          {data.level === 'city' && top.slice().reverse().map(([code, d]) => {
            const [x, y, name] = muniXY.get(code);
            return (
              <circle key={code} cx={x} cy={y} r={radius(d.value) / scale} fill={base} fillOpacity={isSel(d.keys) ? 0.62 : 0.18} stroke="#fff" strokeWidth={1 / scale}
                style={{ cursor: onSelect ? 'pointer' : 'default' }} onMouseMove={(e) => show(e, name, d.value)} onMouseLeave={() => setTip(null)} onClick={() => onSelect?.(d.keys[0])} />
            );
          })}
          {data.level === 'city' && top.slice(0, 5).map(([code, d]) => {
            const [x, y] = muniXY.get(code);
            return <text key={code} x={x + (radius(d.value) + 3) / scale} y={y + 4 / scale} fontSize={11 / scale} fontWeight="700" fill={INK} stroke="#fff" strokeWidth={3 / scale} paintOrder="stroke">{d.label}</text>;
          })}
        </g>
        <g transform={`translate(${pad},${height - legendH + 6})`}>
          {data.level === 'dept' ? (
            <>
              <defs><linearGradient id="mapgrad"><stop offset="0" stopColor={color(data.min + (data.max - data.min) * 0.12)} /><stop offset="1" stopColor={base} /></linearGradient></defs>
              <rect width={Math.min(160, width * 0.35)} height="8" rx="4" fill="url(#mapgrad)" />
              <text y="22" fontSize="10.5" fill={MUTED}>{fmtShort(data.min)}</text>
              <text x={Math.min(160, width * 0.35)} y="22" fontSize="10.5" fill={MUTED} textAnchor="end">{fmtShort(data.max)}</text>
            </>
          ) : <text y="12" fontSize="10.5" fill={MUTED}>Tamaño del círculo: {valueLabel}</text>}
          <text x={width - pad * 2} y="22" fontSize="9.5" fill={MUTED} textAnchor="end">{GEO_SOURCE}</text>
        </g>
      </svg>
      {tip && (
        <div className="chart-tip" style={{ left: Math.min(tip.x + 14, width - 200), top: Math.max(0, tip.y - 12) }}>
          <strong>{tip.title}</strong>
          <span className="tip-row">{tip.value === null ? 'Sin datos' : `${valueLabel}: ${fmt(tip.value)}`}</span>
        </div>
      )}
      {data.missing.length > 0 && <p className="hint map-missing" title={data.missing.join(', ')}>{data.missing.length === 1 ? `1 valor sin ubicar: ${data.missing[0]}` : `${data.missing.length} valores sin ubicar (${data.missing.slice(0, 3).join(', ')}${data.missing.length > 3 ? '…' : ''})`}</p>}
    </div>
  );
});
export default MapColombia;
