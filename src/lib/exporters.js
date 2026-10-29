import { AGG_LABELS } from './data.js';
import { PALETTE } from './Chart.jsx';

// Nombres de archivo sin tildes ni símbolos: algunos navegadores descartan nombres con caracteres especiales
export const safeName = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'reporte';

export function downloadDataUrl(dataUrl, filename) {
  // Se convierte a Blob local: el nombre del archivo se respeta y no se navega a URLs data:
  const [head, b64] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] || 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  downloadBlob(new Blob([bytes], { type: mime }), filename);
}

function clickDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  clickDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const tableAoa = (view) => {
  const header = [view.groupName, ...view.series, view.label];
  const rows = view.items.map((d) => [d.label, ...view.series.map((x) => d.byS?.[x] || 0), d.value]);
  if (view.items2) { header.push(view.label2); const m = new Map(view.items2.map((d) => [d.key, d.value])); rows.forEach((r, i) => r.push(m.get(view.items[i].key) ?? '')); }
  return [header, ...rows];
};

/**
 * Libro de Excel con una hoja por visual (tablas dinámicas) y, opcionalmente, los datos con las columnas calculadas.
 * Los textos se guardan como texto: nunca se ejecutan como fórmulas.
 */
export async function exportWorkbook(views, fileBase, data) {
  const { writeWorkbook } = await import('./xlsx.js');
  const sheets = [];
  for (const v of views) {
    if (v.kind === 'kpi' || v.kind === 'gauge') continue;
    const aoa = tableAoa(v);
    sheets.push({ name: v.title, aoa, widths: aoa[0].map((_, i) => (i === 0 ? 28 : 18)) });
  }
  const kpis = views.filter((v) => v.kind === 'kpi' || v.kind === 'gauge');
  if (kpis.length) sheets.unshift({ name: 'Indicadores', aoa: [['Indicador', 'Valor', 'Meta'], ...kpis.map((k) => [k.title, k.value, k.target || ''])], widths: [40, 18, 18] });
  if (data) sheets.push({ name: 'Datos', aoa: [data.columns.map((c) => c.name), ...data.rows], widths: data.columns.map(() => 16) });
  const blob = await writeWorkbook(sheets);
  downloadBlob(blob, `${safeName(fileBase)}_tablas.xlsx`);
}

/** Compatibilidad: la tabla de un solo visual. */
export const exportPivotXlsx = (view, fileBase) => exportWorkbook([view], fileBase);

const PPT_TYPE = { bar: 'bar', hbar: 'bar', line: 'line', area: 'area', pie: 'pie', donut: 'doughnut', treemap: 'bar', map: 'bar', combo: 'bar' };

/** Presentación con gráficos nativos (editables en PowerPoint). */
export async function exportPptx(views, fileBase, { palette = PALETTE, watermark = true } = {}) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `Reporte ${fileBase}`;
  const ink = '15231D', muted = '5B6B64', accent = palette[0].slice(1);
  const colors = palette.map((c) => c.slice(1));
  const fmtNum = (n) => (typeof n === 'number' ? new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(n) : String(n));

  const cover = pptx.addSlide();
  cover.background = { color: 'F6F8F7' };
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: accent } });
  cover.addText(`Reporte: ${fileBase}`, { x: 0.8, y: 2.0, w: 11.5, h: 1, fontSize: 36, bold: true, color: ink, fontFace: 'Calibri' });
  cover.addText(new Date().toLocaleDateString('es-CO', { dateStyle: 'long' }), { x: 0.8, y: 3.0, w: 11, h: 0.5, fontSize: 16, color: muted });
  const kpis = views.filter((v) => v.kind === 'kpi' || v.kind === 'gauge').slice(0, 8);
  kpis.forEach((k, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const extra = k.target ? `${Math.round((k.value / k.target) * 100)} % de la meta` : '';
    cover.addText([{ text: fmtNum(k.value), options: { fontSize: 24, bold: true, color: ink, breakLine: true } }, { text: k.title, options: { fontSize: 12, color: muted, breakLine: !!extra } }, ...(extra ? [{ text: extra, options: { fontSize: 11, color: accent } }] : [])],
      { x: 0.8 + col * 3, y: 4.0 + row * 1.3, w: 2.8, h: 1.2, valign: 'top' });
  });
  if (watermark) cover.addText('Hecho con DataLite (data-lite.vercel.app)', { x: 0.8, y: 6.8, w: 8, h: 0.4, fontSize: 10, color: '8A9A93' });

  for (const v of views) {
    if (v.kind === 'kpi' || v.kind === 'gauge') continue;
    const slide = pptx.addSlide();
    slide.addText(v.title, { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 22, bold: true, color: ink });
    if (watermark) slide.addText('DataLite', { x: 11.3, y: 7.0, w: 1.6, h: 0.3, fontSize: 9, color: 'A8B5AF', align: 'right' });
    const labels = v.items.map((d) => d.label);

    if (v.kind === 'matrix') {
      const aoa = tableAoa(v).slice(0, 16);
      slide.addTable(aoa.map((r, ri) => r.map((c, ci) => ({ text: typeof c === 'number' ? fmtNum(c) : String(c), options: { bold: ri === 0, fill: ri === 0 ? { color: 'E8F2EE' } : undefined, align: ci === 0 ? 'left' : 'right' } }))),
        { x: 0.5, y: 1.2, w: 12.3, fontSize: 11, color: ink, border: { type: 'solid', pt: 0.5, color: 'DCE3E0' }, autoPage: false });
      continue;
    }
    if (v.kind === 'scatter') {
      const m = new Map(v.items2.map((d) => [d.key, d.value]));
      const pts = v.items.filter((d) => m.has(d.key) && !d.isOther);
      slide.addChart('scatter', [{ name: v.label, values: pts.map((d) => d.value) }, { name: v.label2, values: pts.map((d) => m.get(d.key)) }],
        { x: 0.5, y: 1.2, w: 12.3, h: 5.8, chartColors: colors, showLegend: false, lineSize: 0, lineDataSymbolSize: 10, showValAxisTitle: true, valAxisTitle: v.label2, showCatAxisTitle: true, catAxisTitle: v.label, valAxisLabelFormatCode: '#,##0', catAxisLabelFormatCode: '#,##0' });
      continue;
    }
    const isPie = v.kind === 'pie' || v.kind === 'donut';
    let data;
    if (v.kind === 'combo') {
      const m = new Map(v.items2.map((d) => [d.key, d.value]));
      data = [{ name: v.label, labels, values: v.items.map((d) => d.value) }, { name: v.label2, labels, values: v.items.map((d) => m.get(d.key) ?? 0) }];
    } else if (v.series.length && !isPie) data = v.series.map((x) => ({ name: x, labels, values: v.items.map((d) => d.byS?.[x] || 0) }));
    else data = [{ name: v.label, labels, values: v.items.map((d) => d.value) }];
    const showTable = v.items.length <= 15 && !v.series.length && v.kind !== 'combo';
    const type = PPT_TYPE[v.kind] || 'bar';
    if (v.kind === 'combo') {
      slide.addChart([
        { type: 'bar', data: [data[0]], options: { chartColors: [colors[0]], barGrouping: 'clustered' } },
        { type: 'line', data: [data[1]], options: { chartColors: [colors[2]], secondaryValAxis: true, secondaryCatAxis: true, lineDataSymbol: 'circle' } },
      ], { x: 0.5, y: 1.2, w: 12.3, h: 5.8, showLegend: true, legendPos: 'b', valAxes: [{ showValAxisTitle: true, valAxisTitle: v.label, valAxisLabelFormatCode: '#,##0' }, { showValAxisTitle: true, valAxisTitle: v.label2, valGridLine: { style: 'none' }, valAxisLabelFormatCode: '#,##0' }], catAxes: [{ catAxisTitle: v.groupName }, { catAxisHidden: true }] });
      continue;
    }
    slide.addChart(type, data, {
      x: 0.5, y: 1.2, w: showTable ? 8 : 12.3, h: 5.8,
      barDir: v.kind === 'hbar' || v.kind === 'treemap' || v.kind === 'map' ? 'bar' : 'col',
      barGrouping: v.series.length ? 'stacked' : 'clustered',
      chartColors: v.series.length || isPie ? colors : [colors[0]],
      showLegend: isPie || v.series.length > 0, legendPos: 'b', legendFontSize: 10,
      showValue: !v.series.length && v.items.length <= 12 && !isPie,
      showPercent: isPie, dataLabelColor: isPie ? 'FFFFFF' : ink, dataLabelFontSize: 9,
      catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, valGridLine: { color: 'E3E9E6', size: 0.5 },
      dataLabelFormatCode: '#,##0', valAxisLabelFormatCode: '#,##0',
    });
    if (showTable) {
      const rows = [[{ text: v.groupName, options: { bold: true, fill: { color: 'E8F2EE' } } }, { text: v.label, options: { bold: true, fill: { color: 'E8F2EE' }, align: 'right' } }],
        ...v.items.map((d) => [{ text: String(d.label) }, { text: fmtNum(Math.round(d.value * 100) / 100), options: { align: 'right' } }])];
      slide.addTable(rows, { x: 8.8, y: 1.2, w: 4, colW: [2.5, 1.5], fontSize: 10, color: ink, border: { type: 'solid', pt: 0.5, color: 'DCE3E0' }, rowH: 0.3, autoPage: false });
    }
  }
  await pptx.writeFile({ fileName: `${safeName(fileBase)}_reporte.pptx` });
}
