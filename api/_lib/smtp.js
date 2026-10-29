// Cliente SMTP mínimo y sin dependencias (TLS directo, puerto 465) para enviar correos transaccionales.
// Solo lo usa el servidor; las credenciales salen de variables de entorno y nunca llegan al navegador.
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';

// Correo simple y seguro para cabeceras: sin espacios, saltos de línea, comillas ni ángulos.
const EMAIL_RE = /^[^\s@<>()"',;:\\[\]]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
export const isSafeEmail = (e) => typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e);

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');
const encWord = (s) => `=?UTF-8?B?${b64(String(s).replace(/[\r\n]+/g, ' '))}?=`;

/** Arma el mensaje MIME (texto + HTML, ambos en base64: inmune a inyección de cabeceras y a líneas con punto). */
export function buildMessage({ fromName, fromEmail, to, replyTo, subject, text, html, date = new Date() }) {
  if (!isSafeEmail(fromEmail) || !isSafeEmail(to) || (replyTo && !isSafeEmail(replyTo))) throw new Error('correo no válido');
  const boundary = `dl-${randomUUID()}`;
  const domain = fromEmail.split('@')[1];
  const headers = [
    `From: ${encWord(fromName)} <${fromEmail}>`,
    `To: <${to}>`,
    replyTo ? `Reply-To: <${replyTo}>` : null,
    `Subject: ${encWord(subject)}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);
  const part = (type, body) => `--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(body))}`;
  return `${headers.join('\r\n')}\r\n\r\n${part('text/plain', text)}${part('text/html', html)}--${boundary}--\r\n`;
}

/** Envía un mensaje. `connect` permite inyectar un socket en las pruebas. */
export function sendMail({ host, port = 465, user, pass, timeoutMs = 12000 }, { from, to, data }, { connect } = {}) {
  return new Promise((resolve, reject) => {
    const sock = connect ? connect() : tls.connect({ host, port, servername: host, minVersion: 'TLSv1.2' });
    let buf = '';
    let waiter = null;
    let done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); try { sock.end(); } catch { /* nada */ } err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => finish(new Error('smtp_timeout')), timeoutMs);
    sock.setEncoding?.('utf8');
    sock.on('data', (chunk) => {
      buf += chunk;
      // Respuesta completa: última línea "NNN texto" (las intermedias son "NNN-texto")
      const lines = buf.split('\r\n');
      const last = lines.length >= 2 ? lines[lines.length - 2] : '';
      if (/^\d{3} /.test(last) && waiter) { const resp = buf; buf = ''; const w = waiter; waiter = null; w(resp); }
    });
    sock.on('error', (e) => finish(e));
    sock.on('close', () => finish(new Error('smtp_closed')));
    const read = () => new Promise((r) => { waiter = r; });
    const expect = async (codes) => {
      const resp = await read();
      const code = Number(resp.slice(0, 3));
      if (!codes.includes(code)) throw Object.assign(new Error(`smtp_${code}`), { code, response: resp.split('\r\n')[0].slice(0, 200) });
      return resp;
    };
    const cmd = (line, codes) => { sock.write(line + '\r\n'); return expect(codes); };
    (async () => {
      await expect([220]);
      await cmd(`EHLO data-lite.vercel.app`, [250]);
      await cmd('AUTH LOGIN', [334]);
      await cmd(b64(user), [334]);
      await cmd(b64(pass), [235]);
      await cmd(`MAIL FROM:<${from}>`, [250]);
      await cmd(`RCPT TO:<${to}>`, [250, 251]);
      await cmd('DATA', [354]);
      const body = data.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
      sock.write(body.endsWith('\r\n') ? body : body + '\r\n');
      await cmd('.', [250]);
      sock.write('QUIT\r\n');
      finish(null, true);
    })().catch((e) => finish(e));
  });
}

// ------------------------------------------------------------------ Plantilla de invitación

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim().slice(0, max);

export function inviteEmail({ ownerEmail, projectName, role, link }) {
  const name = clean(projectName, 120) || 'Proyecto';
  const owner = clean(ownerEmail, 254);
  const can = role === 'editor' ? 'verlo y editarlo' : 'verlo';
  const subject = `${owner} te compartió «${name}» en DataLite`;
  const text = `${owner} te compartió el tablero «${name}» en DataLite. Puedes ${can} gratis.\n\nÁbrelo aquí: ${link}\n\nPara entrar, inicia sesión con este mismo correo: te enviaremos un enlace de acceso, sin contraseñas.\n\nSi no esperabas esta invitación, ignora este correo.\n— DataLite · data-lite.vercel.app`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f7f5">
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;color:#15231d">
  <p style="font-size:20px;font-weight:bold;margin:0 0 18px">DataLite</p>
  <div style="background:#ffffff;border:1px solid #dce3e0;border-radius:12px;padding:24px">
    <p style="font-size:16px;line-height:1.5;margin:0 0 8px"><strong>${esc(owner)}</strong> te compartió el tablero</p>
    <p style="font-size:22px;font-weight:bold;line-height:1.25;margin:0 0 14px">«${esc(name)}»</p>
    <p style="font-size:15px;line-height:1.5;margin:0 0 22px;color:#5b6b64">Puedes ${can} gratis, con tu propia cuenta.</p>
    <p style="margin:0 0 22px"><a href="${esc(link)}" style="display:inline-block;background:#0e7a55;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:6px">Abrir el tablero</a></p>
    <p style="font-size:13px;line-height:1.5;color:#5b6b64;margin:0">Para entrar, inicia sesión con este mismo correo: te enviaremos un enlace de acceso, sin contraseñas.</p>
  </div>
  <p style="font-size:12px;line-height:1.5;color:#8a9a93;margin:16px 4px 0">Recibiste este correo porque ${esc(owner)} te invitó en DataLite. Si no lo esperabas, ignóralo: nadie más puede usar tu acceso.</p>
</div></body></html>`;
  return { subject, text, html };
}
