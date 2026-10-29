// Reportes programados y alertas por correo (Pro y Empresa). WhatsApp queda listo para una siguiente fase.
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Field, Icon, track } from './ui.jsx';
import { rpc, connectPermanent, testSchedule } from '../lib/cloud.js';
import { sourceLabel } from '../lib/connectors.js';
import { AGG_LABELS } from '../lib/data.js';

const FREQ = { daily: 'Todos los días', weekly: 'Cada semana', monthly: 'Cada mes' };
const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const GRAN = { day: 'día', month: 'mes', quarter: 'trimestre', year: 'año' };
const STATUS = {
  ok: 'Enviado', normal: 'Revisada: no se cumple', alerta_enviada: 'Alerta enviada', alerta_activa: 'Sigue cumpliéndose (ya se avisó)',
  error_permiso: 'Falta el permiso de lectura', error_hoja: 'No se pudo leer la hoja', error_regla: 'Revisa la condición', error_correo: 'No se pudo enviar el correo',
  error_red: 'Falla temporal, se reintentará', error_config: 'Servicio no habilitado', sin_plan: 'Requiere plan Pro', sin_destinatarios: 'Sin destinatarios',
};
const statusText = (s) => (s ? (s.startsWith('prueba_') ? `Prueba: ${STATUS[s.slice(7)] || s.slice(7)}` : STATUS[s] || s) : 'Aún no se ha enviado');
const when = (s) => {
  const h = `${String(s.hour).padStart(2, '0')}:00`;
  if (s.frequency === 'weekly') return `Cada ${DAYS[(s.weekday || 1) - 1]} a las ${h}`;
  if (s.frequency === 'monthly') return `El día ${s.monthday} de cada mes a las ${h}`;
  return `Todos los días a las ${h}`;
};
const fmtDate = (d) => (d ? new Date(d).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
// Números como se escriben en Colombia: «5.000.000», «1,5», «-10»
const parseNum = (t) => {
  let x = String(t).trim().replace(/\s|\$|%/g, '');
  if (x.includes(',')) x = x.replace(/\./g, '').replace(',', '.');
  else if ((x.match(/\./g) || []).length > 1 || /^-?\d{1,3}\.\d{3}$/.test(x)) x = x.replace(/\./g, '');
  return x === '' ? NaN : Number(x);
};
const parseEmails = (t) => [...new Set(String(t).split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];

function blank(kind, ownerEmail, metrics, dates) {
  return {
    id: null, kind, name: kind === 'report' ? 'Reporte semanal' : 'Alerta', frequency: kind === 'report' ? 'weekly' : 'daily', weekday: 1, monthday: 1, hour: 7,
    recipients: ownerEmail || '', active: true, whatsapp: false,
    rule: { metric: metrics[0]?.value ?? -1, agg: 'SUM', mode: 'total', dateCol: dates[0] || '', gran: 'month', op: 'lt', threshold: '' },
  };
}

export function ScheduleModal({ project, columns, measures, source, ownerEmail, onClose }) {
  const [conn, setConn] = useState(null);
  const [list, setList] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const provider = source?.type;

  const metrics = useMemo(() => [
    ...measures.filter((m) => m.ast && !m.error).map((m) => ({ value: `m:${m.name}`, label: `Medida: ${m.name}`, measure: true })),
    ...columns.filter((c) => c.type === 'number').map((c) => ({ value: c.name, label: c.name })),
    { value: -1, label: 'Cantidad de filas', count: true },
  ], [columns, measures]);
  const dates = useMemo(() => columns.filter((c) => c.type === 'date').map((c) => c.name), [columns]);

  const load = () => Promise.all([rpc('dl_connection_status'), rpc('dl_list_schedules', { p_project: project.id })])
    .then(([c, l]) => { setConn(c || {}); setList(l || []); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn) => { setBusy(true); setError(''); setNotice(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const connected = provider && conn?.[provider] && !conn[provider].error;

  const connect = () => act(async () => {
    const r = await connectPermanent(provider);
    await load();
    if (r.ok) { setNotice('Listo: DataLite ya puede leer la hoja para tus envíos.'); track('conexion_permanente', { proveedor: provider }); }
  });
  const disconnect = () => act(async () => { await rpc('dl_disconnect', { p_provider: provider }); await load(); setNotice('Retiramos el permiso guardado. Los envíos de este proveedor se pausan hasta que lo actives de nuevo.'); });

  const edit = (s) => setForm({
    id: s.id, kind: s.kind, name: s.name, frequency: s.frequency, weekday: s.weekday || 1, monthday: s.monthday || 1, hour: s.hour, recipients: s.recipients.join(', '),
    active: s.active, whatsapp: (s.channels || []).includes('whatsapp'), rule: { ...blank('alert', '', metrics, dates).rule, ...(s.rule || {}), threshold: String(s.rule?.threshold ?? '') },
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setRule = (k, v) => setForm((f) => ({ ...f, rule: { ...f.rule, [k]: v } }));

  const save = (e) => {
    e.preventDefault();
    act(async () => {
      const r = form.rule;
      const metric = metrics.find((m) => String(m.value) === String(r.metric));
      const rule = form.kind === 'alert' ? {
        metric: metric?.value ?? -1, agg: metric?.count ? 'COUNT' : metric?.measure ? 'SUM' : r.agg, mode: r.mode, op: r.op,
        threshold: parseNum(r.threshold),
        ...(r.mode === 'change' ? { dateCol: r.dateCol, gran: r.gran } : {}),
      } : null;
      if (rule && !Number.isFinite(rule.threshold)) throw new Error('Escribe el valor de la condición como número.');
      if (rule?.mode === 'change' && !rule.dateCol) throw new Error('Para comparar periodos, la hoja necesita una columna de fecha.');
      await rpc('dl_save_schedule', {
        p_id: form.id, p_project: project.id, p_kind: form.kind, p_name: form.name.trim() || (form.kind === 'report' ? 'Reporte' : 'Alerta'),
        p_frequency: form.frequency, p_weekday: Number(form.weekday), p_monthday: Number(form.monthday), p_hour: Number(form.hour),
        p_recipients: parseEmails(form.recipients), p_rule: rule, p_active: form.active, p_channels: ['email'],
      });
      track(form.id ? 'programacion_editar' : 'programacion_crear', { tipo: form.kind });
      setForm(null);
      await load();
      setNotice(form.id ? 'Cambios guardados.' : form.kind === 'report' ? 'Reporte programado. Usa «Enviar ahora» para ver cómo llega.' : 'Alerta creada. Te escribiremos cuando se cumpla la condición.');
    });
  };
  const remove = (s) => act(async () => { if (!window.confirm(`¿Borrar «${s.name}»?`)) return; await rpc('dl_delete_schedule', { p_id: s.id }); await load(); });
  const toggle = (s) => act(async () => {
    await rpc('dl_save_schedule', { p_id: s.id, p_project: project.id, p_kind: s.kind, p_name: s.name, p_frequency: s.frequency, p_weekday: s.weekday, p_monthday: s.monthday, p_hour: s.hour, p_recipients: s.recipients, p_rule: s.rule, p_active: !s.active, p_channels: s.channels });
    await load();
  });
  const sendNow = (s) => act(async () => {
    const r = await testSchedule(s.id);
    track('programacion_probar', { tipo: s.kind });
    await load();
    if (r.message) throw new Error(r.message);
    if (s.kind === 'report') setNotice(r.sent ? `Enviamos el reporte a ${r.sent} ${r.sent === 1 ? 'correo' : 'correos'}.` : 'No pudimos enviar el reporte.');
    else setNotice(r.triggered ? `La condición se cumple (${r.label}: ${r.text}). Enviamos la alerta a ${r.sent} ${r.sent === 1 ? 'correo' : 'correos'}.` : `Hoy no se cumple la condición (${r.label}: ${r.text}). No enviamos correo.`);
  });

  const R = form?.rule;
  const metricSel = form && metrics.find((m) => String(m.value) === String(R.metric));

  return (
    <Modal title={`Reportes y alertas · «${project.name}»`} onClose={onClose} wide>
      <div className="stack sched">
        {!source && <p className="callout-sm">Los envíos automáticos leen la hoja conectada. Abre este tablero con «Conectar Google Sheets» o «Conectar Excel en línea» y guárdalo para programarlos.</p>}

        {source && (
          <div className="sched-conn">
            <div>
              <b>Hoja: «{source.name}»</b> <span className="muted">· {sourceLabel(source)}</span>
              <p className="muted small">
                {conn === null ? 'Revisando el permiso…'
                  : connected ? `Actualización automática activa${conn[provider].account ? ` con ${conn[provider].account}` : ''}. DataLite lee la versión más reciente antes de cada envío.`
                    : conn?.[provider]?.error ? conn[provider].error
                      : 'Para enviar sin que abras el tablero, DataLite necesita permiso permanente de solo lectura para esta hoja. Se guarda cifrado y puedes retirarlo cuando quieras.'}
              </p>
            </div>
            {connected
              ? <button type="button" className="btn btn-ghost btn-sm" onClick={disconnect} disabled={busy}>Retirar permiso</button>
              : <button type="button" className="btn btn-primary btn-sm" onClick={connect} disabled={busy || conn === null}>Activar actualización automática</button>}
          </div>
        )}

        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="callout-sm" role="status">{notice}</p>}

        {!form && (
          <>
            {list === null ? <p className="muted">Cargando…</p> : list.length === 0 ? <p className="muted">Aún no tienes reportes ni alertas en este proyecto.</p> : (
              <ul className="sched-list">
                {list.map((s) => (
                  <li key={s.id} className={s.active ? '' : 'off'}>
                    <span className={`sched-kind ${s.kind}`}>{s.kind === 'report' ? 'Reporte' : 'Alerta'}</span>
                    <div className="sched-info">
                      <b>{s.name}</b>
                      <span className="muted small">{when(s)} · {s.recipients.length} {s.recipients.length === 1 ? 'destinatario' : 'destinatarios'}{s.active ? '' : ' · En pausa'}</span>
                      <span className="muted small">{statusText(s.last_status)}{s.last_run_at ? ` · ${fmtDate(s.last_run_at)}` : ''}{s.active && s.next_run_at ? ` · Próximo: ${fmtDate(s.next_run_at)}` : ''}</span>
                    </div>
                    <div className="sched-acts">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => sendNow(s)} disabled={busy || !connected}>Enviar ahora</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit(s)} disabled={busy}>Editar</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(s)} disabled={busy}>{s.active ? 'Pausar' : 'Reanudar'}</button>
                      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Borrar ${s.name}`} onClick={() => remove(s)} disabled={busy}><Icon name="trash" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {source && (
              <div className="row-gap">
                <button type="button" className="btn btn-primary" onClick={() => setForm(blank('report', ownerEmail, metrics, dates))}><Icon name="calendar" /> Nuevo reporte</button>
                <button type="button" className="btn btn-ghost" onClick={() => setForm(blank('alert', ownerEmail, metrics, dates))}><Icon name="plus" /> Nueva alerta</button>
              </div>
            )}
            <p className="muted small">El reporte llega con los indicadores y los gráficos principales del tablero, con los filtros guardados. Las alertas revisan la hoja en el horario elegido y avisan una sola vez cuando la condición pasa a cumplirse. Máximo 10 envíos por cuenta y 10 correos por envío. Cada correo trae un enlace para darse de baja.</p>
          </>
        )}

        {form && (
          <form className="stack" onSubmit={save}>
            <h3 className="proj-h">{form.kind === 'report' ? (form.id ? 'Editar reporte' : 'Nuevo reporte') : (form.id ? 'Editar alerta' : 'Nueva alerta')}</h3>
            <Field label="Nombre"><input className="input" value={form.name} maxLength={120} onChange={(e) => set('name', e.target.value)} required /></Field>

            {form.kind === 'alert' && (
              <fieldset className="sched-rule">
                <legend>Avísame cuando</legend>
                <div className="sched-grid">
                  <Field label="Qué revisar">
                    <select value={String(R.mode)} onChange={(e) => setRule('mode', e.target.value)}>
                      <option value="total">El valor total</option>
                      <option value="change" disabled={!dates.length}>La variación % frente al periodo anterior{dates.length ? '' : ' (requiere fecha)'}</option>
                    </select>
                  </Field>
                  <Field label="Métrica">
                    <select value={String(R.metric)} onChange={(e) => setRule('metric', e.target.value === '-1' ? -1 : e.target.value)}>
                      {metrics.map((m) => <option key={String(m.value)} value={String(m.value)}>{m.label}</option>)}
                    </select>
                  </Field>
                  {!metricSel?.count && !metricSel?.measure && (
                    <Field label="Cálculo">
                      <select value={R.agg} onChange={(e) => setRule('agg', e.target.value)}>
                        {['SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT'].map((a) => <option key={a} value={a}>{AGG_LABELS[a]}</option>)}
                      </select>
                    </Field>
                  )}
                  {R.mode === 'change' && (
                    <>
                      <Field label="Columna de fecha"><select value={R.dateCol} onChange={(e) => setRule('dateCol', e.target.value)}>{dates.map((d) => <option key={d}>{d}</option>)}</select></Field>
                      <Field label="Periodo"><select value={R.gran} onChange={(e) => setRule('gran', e.target.value)}>{Object.entries(GRAN).map(([k, v]) => <option key={k} value={k}>Por {v}</option>)}</select></Field>
                    </>
                  )}
                  <Field label="Condición">
                    <select value={R.op} onChange={(e) => setRule('op', e.target.value)}><option value="lt">Sea menor que</option><option value="gt">Sea mayor que</option></select>
                  </Field>
                  <Field label={R.mode === 'change' ? 'Porcentaje (%)' : 'Valor'}>
                    <input className="input" inputMode="decimal" value={R.threshold} onChange={(e) => setRule('threshold', e.target.value)} placeholder={R.mode === 'change' ? 'Ej.: -10' : 'Ej.: 5000000'} required />
                  </Field>
                </div>
              </fieldset>
            )}

            <div className="sched-grid">
              <Field label={form.kind === 'alert' ? 'Revisar' : 'Enviar'}>
                <select value={form.frequency} onChange={(e) => set('frequency', e.target.value)}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </Field>
              {form.frequency === 'weekly' && <Field label="Día"><select value={form.weekday} onChange={(e) => set('weekday', e.target.value)}>{DAYS.map((d, i) => <option key={d} value={i + 1}>{d[0].toUpperCase() + d.slice(1)}</option>)}</select></Field>}
              {form.frequency === 'monthly' && <Field label="Día del mes"><select value={form.monthday} onChange={(e) => set('monthday', e.target.value)}>{Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></Field>}
              <Field label="Hora (Colombia)"><select value={form.hour} onChange={(e) => set('hour', e.target.value)}>{Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{`${String(i).padStart(2, '0')}:00`}</option>)}</select></Field>
            </div>

            <Field label="Enviar a" hint="Hasta 10 correos, separados por coma.">
              <textarea className="input" rows={2} value={form.recipients} onChange={(e) => set('recipients', e.target.value)} required />
            </Field>

            <fieldset className="sched-channels">
              <legend>Canales</legend>
              <label><input type="checkbox" checked readOnly disabled /> Correo electrónico</label>
              <label className="muted"><input type="checkbox" disabled /> WhatsApp <span className="badge-soon">Próximamente</span></label>
            </fieldset>

            <label className="check"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Activo</label>
            <p className="muted small">Solo envía a personas que esperan este correo: cada una puede darse de baja con un clic.</p>
            <div className="row-gap">
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setForm(null)} disabled={busy}>Cancelar</button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
