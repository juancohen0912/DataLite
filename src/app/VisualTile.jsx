import React, { Suspense, lazy, useState } from 'react';
import { Chart } from '../lib/Chart.jsx';
import { Treemap, Combo, Scatter, Gauge, KpiCard, Matrix } from '../lib/Visuals.jsx';
import { Icon, Menu } from './ui.jsx';

// El mapa (geometría del DANE) solo se descarga cuando un tablero lo usa.
const MapColombia = lazy(() => import('../lib/MapColombia.jsx'));

export function VisualBody({ cfg, view, palette, selected, onSelect, chartRef, height }) {
  const pick = view.isDate ? null : onSelect;
  const sel = view.isDate ? null : selected;
  if (!view) return null;
  if (view.kind !== 'kpi' && view.kind !== 'gauge' && !view.items?.length) return <p className="empty">No hay datos para mostrar con los filtros actuales.</p>;
  switch (view.kind) {
    case 'kpi': return <KpiCard value={view.value} label={view.label === view.title ? '' : view.label} trend={view.trend} target={view.target} palette={palette} />;
    case 'gauge': return <Gauge ref={chartRef} value={view.value} target={view.target} label={view.label} height={Math.min(height, 260)} palette={palette} />;
    case 'matrix': return <Matrix view={view} heatmap={cfg.heat !== false} palette={palette} onSelect={pick} selected={sel} />;
    case 'map': return <Suspense fallback={<p className="empty">Cargando mapa…</p>}><MapColombia ref={chartRef} items={view.items} valueLabel={view.label} height={height} onSelect={pick} selected={sel} palette={palette} /></Suspense>;
    case 'treemap': return <Treemap ref={chartRef} items={view.items} valueLabel={view.label} height={height} onSelect={pick} selected={sel} palette={palette} />;
    case 'combo': return <Combo ref={chartRef} items={view.items} items2={view.items2} label1={view.label} label2={view.label2} height={height} onSelect={pick} selected={sel} palette={palette} />;
    case 'scatter': return <Scatter ref={chartRef} items={view.items} items2={view.items2} label1={view.label} label2={view.label2} height={height} onSelect={pick} selected={sel} palette={palette} />;
    default: return <Chart ref={chartRef} type={view.kind} items={view.items} series={view.series} height={height} valueLabel={view.label} onSelect={pick} selected={sel} palette={palette} compact={height < 300} />;
  }
}

export function VisualTile({ cfg, view, palette, selected, onSelect, onEdit, onDuplicate, onRemove, onPng, editing, readOnly, chartRef }) {
  const [asTable, setAsTable] = useState(false);
  const isCard = view.kind === 'kpi';
  const canTable = !isCard && view.kind !== 'gauge' && view.kind !== 'matrix';
  const height = view.kind === 'map' ? (cfg.size === 'full' ? 520 : cfg.size === 'third' ? 380 : 440) : cfg.size === 'full' ? 340 : cfg.size === 'third' ? 260 : 290;
  return (
    <article className={`tile size-${cfg.size || 'half'} kind-${view.kind}${editing ? ' is-editing' : ''}`} aria-label={view.title}>
      <div className="tile-head">
        <h3 title={view.title}>{view.title}</h3>
        <div className="tile-actions">
          {!readOnly && <button type="button" className="icon-btn" aria-label={`Editar ${view.title}`} onClick={onEdit}><Icon name="edit" /></button>}
          <Menu icon="more" label={`Más opciones de ${view.title}`} buttonClass="icon-btn" items={[
            canTable && { label: asTable ? 'Ver como gráfico' : 'Ver como tabla', onClick: () => setAsTable((t) => !t) },
            !isCard && view.kind !== 'matrix' && { label: 'Descargar imagen (PNG)', onClick: onPng },
            !readOnly && { label: 'Duplicar', onClick: onDuplicate },
            !readOnly && { label: 'Eliminar', danger: true, onClick: onRemove },
          ]} />
        </div>
      </div>
      {view.fullCount > view.items?.length && !view.isDate && !asTable && view.kind !== 'matrix' && view.kind !== 'map' && (
        <p className="hint">{view.fullCount} categorías; las menores van en «Otros».</p>
      )}
      <div className="tile-body">
        {asTable && canTable
          ? <Matrix view={view} heatmap={false} palette={palette} onSelect={view.isDate ? null : onSelect} selected={view.isDate ? null : selected} />
          : <VisualBody cfg={cfg} view={view} palette={palette} selected={selected} onSelect={onSelect} chartRef={chartRef} height={height} />}
      </div>
    </article>
  );
}
