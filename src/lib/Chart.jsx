import React, { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { fmt, fmtShort } from './data.js';

export const PALETTE = ['#0E7A55', '#2F6FDE', '#E2A41B', '#D2554B', '#7A5CC9', '#1B9AA3', '#9A7446', '#C2489B', '#5E8C2E', '#6B7C93'];
const INK = '#15231D', MUTED = '#5B6B64', GRID = '#E3E9E6', FONT = "'Schibsted Grotesk', system-ui, sans-serif";

function niceStep(range, count) {
  const raw = range / Math.max(count, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / mag;
  return (n >= 5 ? 10 : n >= 2 ? 5 : n >= 1 ? 2 : 1) * mag;
}
function niceScale(min, max, count = 5) {
  if (min === max) { max = max === 0 ? 1 : max * 1.2; min = Math.min(0, min); }
  const step = niceStep(max - min, count);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks };
}
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function useWidth(ref, fallback = 600) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/**
 * Gráfico SVG sin dependencias.
 * props: type (bar|hbar|line|area|pie|donut), items [{key,label,value,byS}], series [], height,
 *        valueLabel, onSelect(key), selected (Set de keys), compact
 */
export const Chart = forwardRef(function Chart({ type, items, series = [], height = 360, valueLabel = '', onSelect, selected, compact = false }, ref) {
  const box = useRef(null);
  const svgRef = useRef(null);
  const width = useWidth(box);
  const [tip, setTip] = useState(null);
  useImperativeHandle(ref, () => ({ svg: () => svgRef.current }), []);

  const multi = series.length > 0 && !['pie', 'donut'].includes(type);
  const colorOf = (i) => PALETTE[i % PALETTE.length];
  const isSel = (k) => !selected || selected.size === 0 || selected.has(k);

  const content = useMemo(() => {
    if (!items.length) return null;
    if (type === 'pie' || type === 'donut') return pie();
    return cartesian();

    function pie() {
      const total = items.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
      const legendSide = width >= 520;
      const legendW = legendSide ? Math.min(240, width * 0.4) : 0;
      const maxBelow = 6;
      const ch = legendSide ? height : height - Math.ceil(Math.min(items.length, maxBelow) / 2) * 22 - 16;
      const R = Math.max(40, Math.min((width - legendW) / 2, ch / 2) - 12);
      const cx = legendSide ? (width - legendW) / 2 : width / 2, cy = Math.max(R + 8, ch / 2);
      const inner = type === 'donut' ? R * 0.58 : 0;
      let a0 = -Math.PI / 2;
      const arcs = items.map((d, i) => {
        const frac = Math.max(0, d.value) / total;
        const a1 = a0 + frac * Math.PI * 2;
        const path = arcPath(cx, cy, R, inner, a0, Math.min(a1, a0 + Math.PI * 2 - 1e-4));
        const mid = (a0 + a1) / 2;
        const lx = cx + Math.cos(mid) * (inner ? (R + inner) / 2 : R * 0.65);
        const ly = cy + Math.sin(mid) * (inner ? (R + inner) / 2 : R * 0.65);
        a0 = a1;
        return { d, i, path, frac, lx, ly };
      });
      const legendRows = items.slice(0, legendSide ? 14 : maxBelow);
      return (
        <g>
          {arcs.map(({ d, i, path, frac, lx, ly }) => (
            <g key={d.key}>
              <path d={path} fill={colorOf(i)} stroke="#fff" strokeWidth="2" opacity={isSel(d.key) ? 1 : 0.3}
                style={{ cursor: onSelect && !d.isOther ? 'pointer' : 'default' }}
                onMouseMove={(e) => showTip(e, d, `${(frac * 100).toFixed(1)} %`)} onMouseLeave={() => setTip(null)}
                onClick={() => onSelect && !d.isOther && onSelect(d.key)} />
              {frac > 0.06 && (
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="600" fill="#fff" fontFamily={FONT} pointerEvents="none">
                  {(frac * 100).toFixed(0)}%
                </text>
              )}
            </g>
          ))}
          {inner > 0 && (
            <g pointerEvents="none">
              <text x={cx} y={cy - 8} textAnchor="middle" fontSize={Math.max(14, inner / 3.2)} fontWeight="700" fill={INK} fontFamily={FONT}>{fmtShort(total)}</text>
              <text x={cx} y={cy + 14} textAnchor="middle" fontSize="11" fill={MUTED} fontFamily={FONT}>Total</text>
            </g>
          )}
          {legendRows.map((d, i) => {
            const x = legendSide ? width - legendW + 8 : 12 + (i % 2) * (width / 2);
            const y = legendSide ? 20 + i * 22 : ch + 16 + Math.floor(i / 2) * 22;
            const maxChars = legendSide ? 22 : Math.floor(width / 2 / 8);
            return (
              <g key={'l' + d.key} transform={`translate(${x},${y})`} opacity={isSel(d.key) ? 1 : 0.45}>
                <rect width="10" height="10" y="-9" rx="2" fill={colorOf(i)} />
                <text x="16" fontSize="12" fill={INK} fontFamily={FONT}>{trunc(d.label, maxChars)}</text>
              </g>
            );
          })}
        </g>
      );
    }

    function cartesian() {
      const horiz = type === 'hbar';
      const isBar = type === 'bar' || type === 'hbar';
      const values = items.flatMap((d) => (multi ? (isBar ? [sumS(d)] : series.map((s) => d.byS?.[s] || 0)) : [d.value]));
      const negatives = items.flatMap((d) => (multi && isBar ? series.map((s) => Math.min(0, d.byS?.[s] || 0)) : []));
      const { lo, hi, ticks } = niceScale(Math.min(0, ...values, ...negatives), Math.max(0, ...values), compact ? 4 : 5);
      const legendH = multi ? 26 : 0;
      const longest = Math.max(...items.map((d) => d.label.length));
      const rotate = !horiz && items.length * Math.min(longest, 14) * 6.5 > width - 60;
      const padL = horiz ? Math.min(160, Math.max(60, Math.min(longest, 22) * 6.8 + 12)) : Math.max(...ticks.map((t) => fmtShort(t).length)) * 7 + 18;
      const padB = horiz ? 28 : rotate ? Math.min(90, Math.min(longest, 14) * 5.5 + 18) : 30;
      const padT = 14 + legendH, padR = horiz ? 48 : 14;
      const W = width - padL - padR, H = height - padT - padB;
      const n = items.length;
      const band = (horiz ? H : W) / n;
      const barW = Math.max(2, Math.min(56, band * 0.68));
      const scale = (v) => ((v - lo) / (hi - lo)) * (horiz ? W : H);
      const zero = scale(0);
      const labelEvery = horiz ? Math.ceil(n / Math.max(1, H / 18)) : Math.ceil(n / Math.max(1, W / (rotate ? 16 : 70)));
      const showValues = isBar && !multi && n <= (horiz ? 20 : 14) && !compact;

      const grid = ticks.map((t) => {
        const p = scale(t);
        return horiz ? (
          <g key={t}><line x1={padL + p} x2={padL + p} y1={padT} y2={padT + H} stroke={GRID} />
            <text x={padL + p} y={padT + H + 18} textAnchor="middle" fontSize="11" fill={MUTED} fontFamily={FONT}>{fmtShort(t)}</text></g>
        ) : (
          <g key={t}><line x1={padL} x2={padL + W} y1={padT + H - p} y2={padT + H - p} stroke={GRID} />
            <text x={padL - 8} y={padT + H - p} textAnchor="end" dominantBaseline="central" fontSize="11" fill={MUTED} fontFamily={FONT}>{fmtShort(t)}</text></g>
        );
      });

      const cats = items.map((d, i) => {
        const c = (i + 0.5) * band;
        if (i % labelEvery !== 0) return null;
        if (horiz) return <text key={d.key} x={padL - 8} y={padT + c} textAnchor="end" dominantBaseline="central" fontSize="12" fill={INK} fontFamily={FONT}>{trunc(d.label, 22)}</text>;
        return rotate
          ? <text key={d.key} transform={`translate(${padL + c},${padT + H + 10}) rotate(-40)`} textAnchor="end" fontSize="11" fill={INK} fontFamily={FONT}>{trunc(d.label, 14)}</text>
          : <text key={d.key} x={padL + c} y={padT + H + 18} textAnchor="middle" fontSize="11" fill={INK} fontFamily={FONT}>{trunc(d.label, Math.max(4, Math.floor(band / 6.5)))}</text>;
      });

      let marks;
      if (isBar) {
        marks = items.map((d, i) => {
          const c = (i + 0.5) * band;
          const segs = multi ? series.map((s, si) => ({ v: d.byS?.[s] || 0, color: colorOf(si), s })) : [{ v: d.value, color: d.isOther ? '#9AA8A2' : colorOf(0) }];
          let accPos = 0, accNeg = 0;
          const rects = segs.map((sg, si) => {
            const base = sg.v >= 0 ? accPos : accNeg;
            const from = scale(base), to = scale(base + sg.v);
            if (sg.v >= 0) accPos += sg.v; else accNeg += sg.v;
            const a = Math.min(from, to), len = Math.max(Math.abs(to - from), sg.v ? 1 : 0);
            const props = horiz
              ? { x: padL + a, y: padT + c - barW / 2, width: len, height: barW }
              : { x: padL + c - barW / 2, y: padT + H - a - len, width: barW, height: len };
            return <rect key={si} {...props} rx={multi ? 0 : 3} fill={sg.color} opacity={isSel(d.key) ? 1 : 0.3} />;
          });
          const lbl = showValues && (horiz
            ? <text x={padL + Math.max(scale(d.value), zero) + 6} y={padT + c} dominantBaseline="central" fontSize="11" fontWeight="600" fill={INK} fontFamily={FONT}>{fmtShort(d.value)}</text>
            : <text x={padL + c} y={padT + H - Math.max(scale(d.value), zero) - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill={INK} fontFamily={FONT}>{fmtShort(d.value)}</text>);
          return (
            <g key={d.key} style={{ cursor: onSelect && !d.isOther ? 'pointer' : 'default' }}
              onMouseMove={(e) => showTip(e, d)} onMouseLeave={() => setTip(null)} onClick={() => onSelect && !d.isOther && onSelect(d.key)}>
              <rect {...(horiz ? { x: padL, y: padT + i * band, width: W, height: band } : { x: padL + i * band, y: padT, width: band, height: H })} fill="transparent" />
              {rects}{lbl}
            </g>
          );
        });
      } else {
        const lines = (multi ? series : [null]).map((s, si) => {
          const pts = items.map((d, i) => [padL + (i + 0.5) * band, padT + H - scale(s === null ? d.value : d.byS?.[s] || 0)]);
          const dLine = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
          const color = colorOf(si);
          return (
            <g key={si}>
              {type === 'area' && <path d={`${dLine}L${pts[pts.length - 1][0]},${padT + H - zero}L${pts[0][0]},${padT + H - zero}Z`} fill={color} opacity={multi ? 0.12 : 0.18} />}
              <path d={dLine} fill="none" stroke={color} strokeWidth="2.25" strokeLinejoin="round" />
              {n <= 40 && pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="#fff" stroke={color} strokeWidth="2" />)}
            </g>
          );
        });
        const hits = items.map((d, i) => (
          <rect key={d.key} x={padL + i * band} y={padT} width={band} height={H} fill="transparent"
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
            onMouseMove={(e) => showTip(e, d)} onMouseLeave={() => setTip(null)} onClick={() => onSelect && onSelect(d.key)} />
        ));
        marks = [...lines, ...hits];
      }

      const legend = multi && (
        <g>{series.map((s, si) => {
          const per = Math.max(90, Math.min(160, width / series.length));
          return (
            <g key={s} transform={`translate(${padL + si * per},10)`}>
              <rect width="10" height="10" rx="2" fill={colorOf(si)} />
              <text x="15" y="9" fontSize="11" fill={INK} fontFamily={FONT}>{trunc(s, Math.floor(per / 7) - 2)}</text>
            </g>
          );
        })}</g>
      );

      const axis = horiz
        ? <line x1={padL + zero} x2={padL + zero} y1={padT} y2={padT + H} stroke="#9AA8A2" />
        : <line x1={padL} x2={padL + W} y1={padT + H - zero} y2={padT + H - zero} stroke="#9AA8A2" />;
      return <g>{legend}{grid}{axis}{marks}{cats}</g>;
    }
  }, [items, series, type, width, height, selected, compact]); // eslint-disable-line react-hooks/exhaustive-deps

  function sumS(d) { return series.reduce((s, k) => s + Math.max(0, d.byS?.[k] || 0), 0); }

  function showTip(e, d, extra) {
    const rect = box.current.getBoundingClientRect();
    const rows = multi ? series.map((s, i) => ({ s, v: d.byS?.[s] || 0, c: colorOf(i) })).filter((r) => r.v) : null;
    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, d, extra, rows });
  }

  const summary = items.slice(0, 5).map((d) => `${d.label}: ${fmt(d.value)}`).join('; ');
  return (
    <div ref={box} className="chart-box" style={{ height }}>
      <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${valueLabel}. ${summary}`}>
        <rect width={width} height={height} fill="#ffffff" />
        {content}
      </svg>
      {tip && (
        <div className="chart-tip" style={{ left: Math.min(tip.x + 14, width - 200), top: Math.max(0, tip.y - 12) }}>
          <strong>{tip.d.label}</strong>
          <span>{valueLabel}: {fmt(tip.d.value)}{tip.extra ? ` (${tip.extra})` : ''}</span>
          {tip.rows && tip.rows.map((r) => (
            <span key={r.s} className="tip-row"><i style={{ background: r.c }} />{r.s}: {fmt(r.v)}</span>
          ))}
        </div>
      )}
    </div>
  );
});

function arcPath(cx, cy, r, ir, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
  if (!ir) return `M${cx},${cy}L${p(r, a0)}A${r},${r} 0 ${large} 1 ${p(r, a1)}Z`;
  return `M${p(r, a0)}A${r},${r} 0 ${large} 1 ${p(r, a1)}L${p(ir, a1)}A${ir},${ir} 0 ${large} 0 ${p(ir, a0)}Z`;
}

/** Convierte un SVG en PNG (data URL) con título y marca de agua opcional. */
export async function svgToPng(svg, { title = '', watermark = 'Hecho con DataLite · data-lite.vercel.app', scale = 2 } = {}) {
  const w = +svg.getAttribute('width'), h = +svg.getAttribute('height');
  const headH = title ? 44 : 0, footH = watermark ? 26 : 0;
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const canvas = document.createElement('canvas');
  canvas.width = (w + 32) * scale; canvas.height = (h + headH + footH + 24) * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w + 32, h + headH + footH + 24);
  if (title) { ctx.fillStyle = INK; ctx.font = `700 18px ${FONT}`; ctx.fillText(title, 16, 32); }
  ctx.drawImage(img, 16, headH + 12, w, h);
  if (watermark) { ctx.fillStyle = '#8A9A93'; ctx.font = `12px ${FONT}`; ctx.fillText(watermark, 16, headH + h + 30); }
  URL.revokeObjectURL(url);
  return canvas.toDataURL('image/png');
}
