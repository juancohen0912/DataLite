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

/** Tabla dinámica en Excel. Los textos se guardan como texto: nunca se ejecutan como fórmulas. */
export async function exportPivotXlsx(view, fileBase) {
  const header = [view.groupName, ...view.series, `${AGG_LABELS[view.agg]} de ${view.metricName}`];
  const rows = view.items.map((d) => [d.label, ...view.series.map((s) => d.byS?.[s] || 0), d.value]);
  const { writeXlsx } = await import('./xlsx.js');
  const blob = await writeXlsx([header, ...rows], 'Tabla dinámica', header.map((_, i) => (i === 0 ? 28 : 16)));
  downloadBlob(blob, `${safeName(fileBase)}_tabla.xlsx`);
}

const PPT_TYPE = { bar: 'bar', hbar: 'bar', line: 'line', area: 'area', pie: 'pie', donut: 'doughnut' };

/** Presentación con gráficos nativos (editables en PowerPoint). */
export async function exportPptx(views, fileBase, kpis) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `Reporte ${fileBase}`;
  const ink = '15231D', muted = '5B6B64', green = '0E7A55';

  const cover = pptx.addSlide();
  cover.background = { color: 'F6F8F7' };
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: green } });
  cover.addText(`Reporte: ${fileBase}`, { x: 0.8, y: 2.3, w: 11.5, h: 1, fontSize: 36, bold: true, color: ink, fontFace: 'Calibri' });
  cover.addText(new Date().toLocaleDateString('es-CO', { dateStyle: 'long' }), { x: 0.8, y: 3.3, w: 11, h: 0.5, fontSize: 16, color: muted });
  if (kpis?.length) {
    kpis.forEach((k, i) => {
      cover.addText([{ text: k.value, options: { fontSize: 24, bold: true, color: ink, breakLine: true } }, { text: k.label, options: { fontSize: 12, color: muted } }],
        { x: 0.8 + i * 3, y: 4.4, w: 2.8, h: 1, valign: 'top' });
    });
  }
  cover.addText('Hecho con DataLite (data-lite.vercel.app)', { x: 0.8, y: 6.8, w: 8, h: 0.4, fontSize: 10, color: '8A9A93' });

  for (const v of views) {
    const slide = pptx.addSlide();
    slide.addText(v.title, { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 22, bold: true, color: ink });
    if (v.subtitle) slide.addText(v.subtitle, { x: 0.5, y: 0.85, w: 12.3, h: 0.4, fontSize: 12, color: muted });
    const isPie = v.type === 'pie' || v.type === 'donut';
    const labels = v.items.map((d) => d.label);
    const data = v.series.length && !isPie
      ? v.series.map((s) => ({ name: s, labels, values: v.items.map((d) => d.byS?.[s] || 0) }))
      : [{ name: v.metricName, labels, values: v.items.map((d) => d.value) }];
    const colors = (v.series.length || isPie ? PALETTE : [PALETTE[0]]).map((c) => c.slice(1));
    const showTable = v.items.length <= 15;
    slide.addChart(PPT_TYPE[v.type] || 'bar', data, {
      x: 0.5, y: 1.4, w: showTable ? 8 : 12.3, h: 5.6,
      barDir: v.type === 'hbar' ? 'bar' : 'col',
      barGrouping: v.series.length ? 'stacked' : 'clustered',
      chartColors: colors,
      showLegend: isPie || v.series.length > 0, legendPos: 'b', legendFontSize: 10,
      showValue: !v.series.length && v.items.length <= 12 && !isPie,
      showPercent: isPie, dataLabelColor: isPie ? 'FFFFFF' : ink, dataLabelFontSize: 9,
      catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, valGridLine: { color: 'E3E9E6', size: 0.5 },
      dataLabelFormatCode: '#,##0', valAxisLabelFormatCode: '#,##0',
    });
    if (showTable) {
      const rows = [[{ text: v.groupName, options: { bold: true, fill: { color: 'E8F2EE' } } }, { text: v.metricName, options: { bold: true, fill: { color: 'E8F2EE' }, align: 'right' } }],
        ...v.items.map((d) => [d.label, { text: Math.round(d.value * 100) / 100 + '', options: { align: 'right' } }])];
      slide.addTable(rows.map((r) => r.map((c) => (typeof c === 'string' ? { text: c } : c))), {
        x: 8.8, y: 1.4, w: 4, colW: [2.5, 1.5], fontSize: 10, color: ink, border: { type: 'solid', pt: 0.5, color: 'DCE3E0' },
        rowH: 0.3, autoPage: false,
      });
    }
  }
  await pptx.writeFile({ fileName: `${safeName(fileBase)}_reporte.pptx` });
}
