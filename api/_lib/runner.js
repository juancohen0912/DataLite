// Ejecuta una programación (reporte o alerta): permiso → descarga → cálculo → correo (y WhatsApp a futuro).
import { rpcAdmin } from './server.js';
import { decrypt, encrypt } from './crypto.js';
import { refreshAccess, providerReady } from './oauth.js';
import { downloadSource } from './sources.js';
import { loadDataset, reportData, evaluateAlert } from './engine.js';
import { sendMail, buildMessage, isSafeEmail } from './smtp.js';
import { reportEmail, alertEmail, failureEmail, unsubscribeLinks } from './report-email.js';
import { sendWhatsappAlert } from './whatsapp.js';

export const smtp = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  fromName: process.env.SMTP_FROM_NAME || 'DataLite',
};
export const smtpReady = () => Boolean(smtp.user && smtp.pass && isSafeEmail(smtp.user));

class RunError extends Error {
  constructor(message, status, notify = false) { super(message); this.status = status; this.notify = notify; }
}

async function accessToken(p) {
  const provider = p.project?.state?.source?.type;
  if (!providerReady(provider)) throw new RunError('La actualización automática aún no está habilitada para este proveedor.', 'error_config');
  if (!p.token) throw new RunError('Activa la actualización automática en «Programar» para que DataLite pueda leer la hoja.', 'error_permiso', true);
  let refresh;
  try { refresh = decrypt(p.token); } catch { throw new RunError('El permiso guardado no es válido. Vuelve a activar la actualización automática.', 'error_permiso', true); }
  try {
    const t = await refreshAccess(provider, refresh);
    if (t.refresh) await rpcAdmin('dl_update_connection', { p_user: p.owner.id, p_provider: provider, p_token: encrypt(t.refresh), p_error: null });
    return t.access;
  } catch (e) {
    const revoked = /invalid_grant|interaction_required|consent_required/.test(e.code || '');
    const msg = revoked ? 'El permiso para leer la hoja se venció o fue retirado. Vuelve a activar la actualización automática.' : 'No pudimos renovar el acceso a la hoja.';
    await rpcAdmin('dl_update_connection', { p_user: p.owner.id, p_provider: provider, p_token: null, p_error: msg }).catch(() => null);
    throw new RunError(msg, revoked ? 'error_permiso' : 'error_red', revoked);
  }
}

async function mailAll(recipients, scheduleId, build, mailer) {
  let sent = 0;
  for (const to of recipients.filter(isSafeEmail).slice(0, 10)) {
    const unsub = unsubscribeLinks(scheduleId, to);
    const mail = build(unsub.page);
    try {
      await mailer(smtp, { from: smtp.user, to, data: buildMessage({ fromName: smtp.fromName, fromEmail: smtp.user, to, unsubscribe: unsub.oneClick, ...mail }) });
      sent++;
    } catch (e) { console.error('reporte_correo_error', e.code || e.message); }
  }
  return sent;
}

/**
 * @param p   datos de la programación (dl_schedule_payload)
 * @param opt { test } — en una prueba la alerta no cambia su estado guardado
 * @returns   { status, sent, triggered?, value?, text?, message? }
 */
export async function runSchedule(p, { test = false, mailer = sendMail } = {}) {
  const finish = (status, value = null, triggered = null, detail = null) =>
    rpcAdmin('dl_finish_schedule', { p_id: p.id, p_status: test ? `prueba_${status}` : status, p_value: Number.isFinite(value) ? value : null, p_triggered: test ? null : triggered, p_detail: detail })
      .catch((e) => console.error('reporte_finish_error', e.message));
  try {
    if (!p.owner?.pro) throw new RunError('Los reportes programados son del plan Pro o Empresa.', 'sin_plan');
    if (!smtpReady()) throw new RunError('El envío de correos no está configurado.', 'error_config');
    const recipients = (p.recipients || []).filter(isSafeEmail);
    if (!recipients.length) throw new RunError('Todos los destinatarios se dieron de baja.', 'sin_destinatarios');
    const state = p.project?.state || {};
    const token = await accessToken(p);
    let file;
    try { file = await downloadSource(state.source, token); } catch (e) { throw new RunError(e.message, 'error_hoja', e.kind === 'access' || e.kind === 'auth'); }
    let ds;
    try { ds = await loadDataset(file.buffer, file.fileName, state); } catch (e) { throw new RunError(`No pudimos leer la hoja: ${e.message}`, 'error_hoja', true); }

    if (p.kind === 'report') {
      const data = reportData(state, ds);
      const sent = await mailAll(recipients, p.id, (unsub) => reportEmail({ schedule: p, project: p.project, ownerEmail: p.owner.email, data, sheet: ds.sheet, unsub }), mailer);
      await finish(sent ? 'ok' : 'error_correo', null, null, `${sent}/${recipients.length} correos`);
      return { status: sent ? 'ok' : 'error_correo', sent };
    }

    let result;
    try { result = evaluateAlert(p.rule || {}, ds); } catch (e) { throw new RunError(e.message, 'error_regla', true); }
    // Solo se avisa cuando la condición pasa de «normal» a «cumplida» (no cada vez que se revisa)
    const notify = result.triggered && (test || !p.last_triggered);
    let sent = 0;
    if (notify) {
      sent = await mailAll(recipients, p.id, (unsub) => alertEmail({ schedule: p, project: p.project, ownerEmail: p.owner.email, result, unsub }), mailer);
      if ((p.channels || []).includes('whatsapp')) await sendWhatsappAlert(p.whatsapp, { alertName: p.name, projectName: p.project.name, valueText: result.text, link: `${process.env.SITE_URL || 'https://data-lite.vercel.app'}/?p=${p.project.id}` });
    }
    const status = result.triggered ? (notify ? (sent ? 'alerta_enviada' : 'error_correo') : 'alerta_activa') : 'normal';
    await finish(status, result.value, result.triggered, result.text);
    return { status, sent, triggered: result.triggered, value: result.value, text: result.text, label: result.label };
  } catch (e) {
    const status = e.status || 'error';
    const message = e instanceof RunError ? e.message : 'Ocurrió un error inesperado al preparar el envío.';
    if (!(e instanceof RunError)) console.error('reporte_error', e.message);
    await finish(status, null, null, message);
    // Aviso al dueño (una vez por racha de fallas) cuando necesita hacer algo
    if (!test && e.notify && !String(p.last_status || '').startsWith('error') && smtpReady() && isSafeEmail(p.owner?.email)) {
      const mail = failureEmail({ schedule: p, project: p.project, message });
      await mailer(smtp, { from: smtp.user, to: p.owner.email, data: buildMessage({ fromName: smtp.fromName, fromEmail: smtp.user, to: p.owner.email, ...mail }) }).catch(() => null);
    }
    return { status, sent: 0, message };
  }
}
