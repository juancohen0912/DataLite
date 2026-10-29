// Correos de reportes programados y alertas: HTML compatible con clientes de correo (tablas, estilos en línea).
import { esc, clean } from './smtp.js';
import { sign } from './crypto.js';
import { env } from './server.js';

const FREQ = { daily: 'diario', weekly: 'semanal', monthly: 'mensual' };
const fmtDate = (d = new Date()) => d.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', year: 'numeric' });

/** Enlace de baja firmado: solo sirve para ese correo y esa programación. */
export function unsubscribeToken(scheduleId, email) { return sign('baja', `${scheduleId}|${String(email).toLowerCase()}`); }
export function unsubscribeLinks(scheduleId, email) {
  const q = new URLSearchParams({ s: scheduleId, e: String(email).toLowerCase(), t: unsubscribeToken(scheduleId, email) });
  return { page: `${env.SITE_URL}/reportes/baja?${q}`, oneClick: `${env.SITE_URL}/api/reportes/baja?${q}` };
}

const shell = (inner, footer) => `<!doctype html><html lang="es"><body style="margin:0;background:#f4f7f5">
<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px 16px;color:#15231d">
  <p style="font-size:20px;font-weight:bold;margin:0 0 16px">DataLite</p>
  ${inner}
  <p style="font-size:12px;line-height:1.5;color:#8a9a93;margin:16px 4px 0">${footer}</p>
</div></body></html>`;

const button = (href, label) => `<p style="margin:20px 0 0"><a href="${esc(href)}" style="display:inline-block;background:#0e7a55;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:6px">${esc(label)}</a></p>`;

function kpiTable(kpis) {
  if (!kpis.length) return '';
  const cells = kpis.map((k) => {
    const d = typeof k.delta === 'number' && isFinite(k.delta)
      ? `<div style="font-size:12px;color:${k.delta >= 0 ? '#0e7a55' : '#b42318'}">${k.delta >= 0 ? '▲' : '▼'} ${esc(Math.abs(k.delta).toLocaleString('es-CO', { maximumFractionDigits: 1 }))} % vs. periodo anterior</div>` : '';
    return `<td style="width:50%;padding:6px;vertical-align:top"><div style="background:#ffffff;border:1px solid #dce3e0;border-radius:10px;padding:14px">
      <div style="font-size:12px;color:#5b6b64;margin-bottom:4px">${esc(clean(k.title, 80))}</div>
      <div style="font-size:24px;font-weight:bold" title="${esc(k.full)}">${esc(k.text)}</div>${d}</div></td>`;
  });
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(`<tr>${cells[i]}${cells[i + 1] || '<td style="width:50%"></td>'}</tr>`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 -6px">${rows.join('')}</table>`;
}

function chartTable(c) {
  const max = Math.max(...c.items.map((d) => Math.abs(d.value)), 0) || 1;
  const rows = c.items.map((d) => {
    const w = Math.max(2, Math.round((Math.abs(d.value) / max) * 100));
    return `<tr><td style="font-size:13px;padding:4px 8px 4px 0;width:38%;color:#15231d">${esc(clean(d.label, 60))}</td>
      <td style="padding:4px 0"><div style="background:${d.value < 0 ? '#e8a29b' : '#0e7a55'};height:12px;width:${w}%;border-radius:3px"></div></td>
      <td style="font-size:13px;padding:4px 0 4px 8px;text-align:right;white-space:nowrap;width:70px">${esc(d.text)}</td></tr>`;
  }).join('');
  return `<div style="background:#ffffff;border:1px solid #dce3e0;border-radius:10px;padding:14px;margin-top:12px">
    <div style="font-size:15px;font-weight:bold;margin-bottom:8px">${esc(clean(c.title, 100))}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table></div>`;
}

const footerFor = (ownerEmail, unsub) => `Recibes este correo porque ${esc(ownerEmail)} te incluyó en este envío de DataLite. `
  + `<a href="${esc(unsub)}" style="color:#5b6b64">Dejar de recibirlo</a>.`;

export function reportEmail({ schedule, project, ownerEmail, data, sheet, unsub }) {
  const name = clean(schedule.name, 120) || 'Reporte';
  const pname = clean(project.name, 120) || 'Proyecto';
  const link = `${env.SITE_URL}/?p=${project.id}`;
  const subject = `${name} · ${fmtDate()}`;
  const inner = `<div style="background:#ffffff;border:1px solid #dce3e0;border-radius:12px;padding:20px;margin-bottom:12px">
      <div style="font-size:12px;color:#5b6b64;text-transform:uppercase;letter-spacing:.04em">Reporte ${esc(FREQ[schedule.frequency] || '')} · ${esc(fmtDate())}</div>
      <div style="font-size:22px;font-weight:bold;margin:4px 0 2px">${esc(name)}</div>
      <div style="font-size:14px;color:#5b6b64">${esc(pname)} · ${esc(data.rows.toLocaleString('es-CO'))} filas${sheet ? ` de «${esc(clean(sheet, 60))}»` : ''}, datos actualizados al enviar</div></div>
    ${kpiTable(data.kpis)}
    ${data.charts.map(chartTable).join('')}
    ${!data.kpis.length && !data.charts.length ? '<p style="font-size:14px">El tablero aún no tiene gráficos guardados.</p>' : ''}
    ${button(link, 'Abrir el tablero completo')}`;
  const lines = [`${name} — ${fmtDate()}`, `${pname} · ${data.rows} filas`, '',
    ...data.kpis.map((k) => `• ${k.title}: ${k.full}`), '',
    ...data.charts.flatMap((c) => [c.title, ...c.items.map((d) => `  - ${d.label}: ${d.text}`), '']),
    `Abrir el tablero: ${link}`, '', `Dejar de recibir este correo: ${unsub}`];
  return { subject, text: lines.join('\n'), html: shell(inner, footerFor(ownerEmail, unsub)) };
}

const OP = { gt: 'mayor que', lt: 'menor que' };
export function alertEmail({ schedule, project, ownerEmail, result, unsub }) {
  const name = clean(schedule.name, 120) || 'Alerta';
  const pname = clean(project.name, 120) || 'Proyecto';
  const link = `${env.SITE_URL}/?p=${project.id}`;
  const r = schedule.rule || {};
  const thr = Number(r.threshold).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  const cond = r.mode === 'change' ? `variación ${OP[r.op]} ${thr} %` : `${OP[r.op]} ${thr}`;
  const subject = `⚠ Alerta: ${name}`;
  const det = result.detail ? `<p style="font-size:14px;color:#5b6b64;margin:8px 0 0">${esc(clean(result.detail.last.label, 40))}: ${esc(result.detail.last.text)} · ${esc(clean(result.detail.prev.label, 40))}: ${esc(result.detail.prev.text)}</p>` : '';
  const inner = `<div style="background:#ffffff;border:1px solid #dce3e0;border-left:5px solid #c2410c;border-radius:12px;padding:20px">
      <div style="font-size:12px;color:#c2410c;text-transform:uppercase;letter-spacing:.04em;font-weight:bold">Se cumplió tu alerta</div>
      <div style="font-size:22px;font-weight:bold;margin:4px 0 10px">${esc(name)}</div>
      <p style="font-size:15px;margin:0">${esc(clean(result.label, 100))}: <strong style="font-size:20px">${esc(result.text)}</strong></p>
      <p style="font-size:14px;color:#5b6b64;margin:6px 0 0">Condición: ${esc(cond)} · Proyecto «${esc(pname)}» · ${esc(fmtDate())}</p>${det}
      ${button(link, 'Revisar en el tablero')}</div>`;
  const text = `Se cumplió tu alerta «${name}»\n${result.label}: ${result.text}\nCondición: ${cond}\nProyecto: ${pname}\n\nRevisar: ${link}\n\nDejar de recibir: ${unsub}`;
  return { subject, text, html: shell(inner, footerFor(ownerEmail, unsub)) };
}

/** Aviso al dueño cuando una programación no pudo ejecutarse (permiso vencido, hoja borrada, etc.). */
export function failureEmail({ schedule, project, message }) {
  const name = clean(schedule.name, 120);
  const link = `${env.SITE_URL}/?p=${project.id}`;
  const subject = `No pudimos enviar «${name}»`;
  const inner = `<div style="background:#ffffff;border:1px solid #dce3e0;border-radius:12px;padding:20px">
      <div style="font-size:20px;font-weight:bold;margin:0 0 10px">No pudimos preparar «${esc(name)}»</div>
      <p style="font-size:15px;line-height:1.5;margin:0">${esc(clean(message, 300))}</p>
      <p style="font-size:14px;color:#5b6b64;margin:10px 0 0">Abre el proyecto, entra a «Programar» y revisa la conexión. Lo intentaremos de nuevo en el próximo envío.</p>
      ${button(link, 'Abrir el proyecto')}</div>`;
  return { subject, text: `No pudimos preparar «${name}»: ${message}\n\nAbrir el proyecto: ${link}`, html: shell(inner, 'Este aviso solo lo recibe el dueño del proyecto.') };
}
