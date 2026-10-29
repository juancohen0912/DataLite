import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// Entorno de prueba (antes de importar los módulos del servidor)
Object.assign(process.env, {
  TOKEN_ENC_KEY: randomBytes(32).toString('base64'), GOOGLE_CLIENT_SECRET: 'secreto-prueba', MICROSOFT_CLIENT_SECRET: 'secreto-prueba',
  SMTP_USER: 'remitente@example.com', SMTP_PASS: 'x', SUPABASE_URL: 'https://db.example.com', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'srv',
});
const { encrypt, decrypt, sign, verify } = await import('../api/_lib/crypto.js');
const { authorizeUrl, readState } = await import('../api/_lib/oauth.js');
const { runSchedule } = await import('../api/_lib/runner.js');
const { unsubscribeToken, reportEmail } = await import('../api/_lib/report-email.js');
const { buildMessage } = await import('../api/_lib/smtp.js');
const { normalizePhone, whatsappReady } = await import('../api/_lib/whatsapp.js');
const { TEMPLATES, autoMap, templateState, templateAoa } = await import('../src/app/templates.js');
const { buildTable } = await import('../src/lib/data.js');

const UID = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';

test('cifrado de permisos: ida y vuelta, y detecta alteraciones', () => {
  const blob = encrypt('1//refresh-token');
  assert.equal(decrypt(blob), '1//refresh-token');
  assert.notEqual(encrypt('a'), encrypt('a'));
  const bad = blob.slice(0, -4) + (blob.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  assert.throws(() => decrypt(bad));
  assert.ok(verify('baja', 'x', sign('baja', 'x')));
  assert.ok(!verify('state', 'x', sign('baja', 'x')), 'las firmas no se cruzan entre usos');
});

test('estado de OAuth firmado y con PKCE', () => {
  const u = new URL(authorizeUrl('google', UID));
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.match(u.searchParams.get('scope'), /drive\.file/);
  const st = readState(u.searchParams.get('state'));
  assert.equal(st.u, UID);
  assert.equal(readState(u.searchParams.get('state').replace(/.$/, 'A')) && readState(u.searchParams.get('state') + 'x'), null);
  const [payload] = u.searchParams.get('state').split('.');
  const forged = Buffer.from(JSON.stringify({ u: 'otro', p: 'google', n: 'n', e: Date.now() + 1e6 })).toString('base64url');
  assert.equal(readState(`${forged}.${u.searchParams.get('state').split('.')[1]}`), null);
  assert.ok(payload);
});

test('correo: baja en un clic válida y contenido escapado', () => {
  const m = buildMessage({ fromName: 'DataLite', fromEmail: 'a@example.com', to: 'b@example.com', subject: 's', text: 't', html: 'h', unsubscribe: 'https://data-lite.vercel.app/api/reportes/baja?s=1' });
  assert.match(m, /List-Unsubscribe: <https:\/\/data-lite/);
  assert.throws(() => buildMessage({ fromName: 'D', fromEmail: 'a@example.com', to: 'b@example.com', subject: 's', text: 't', html: 'h', unsubscribe: 'https://x\r\nBcc: y' }));
  const r = reportEmail({ schedule: { name: '<b>Ventas</b>', frequency: 'weekly' }, project: { id: SID, name: 'P' }, ownerEmail: 'o@example.com', sheet: 'Hoja', unsub: 'https://u',
    data: { rows: 3, kpis: [{ title: '<img>', text: '1', full: '1', delta: 5 }], charts: [{ title: 'C', items: [{ label: '<script>', value: 2, text: '2' }] }] } });
  assert.ok(!r.html.includes('<script>') && !r.html.includes('<img>') && !r.html.includes('<b>Ventas'));
});

test('WhatsApp queda apagado sin configuración y normaliza números', () => {
  assert.equal(whatsappReady(), false);
  assert.equal(normalizePhone('+57 300 123 4567'), '573001234567');
  assert.equal(normalizePhone('abc'), null);
});

// ------------------------------------------------------------ Ejecución completa con servicios simulados
function setup(tplId) {
  const tpl = TEMPLATES.find((t) => t.id === tplId);
  const aoa = templateAoa(tpl);
  const t = buildTable(aoa);
  const state = { ...templateState(tpl, autoMap(tpl, t.columns), t.columns), source: { type: 'google', id: 'abcdef123456', name: 'Ventas', mime: 'text/csv' } };
  const csv = aoa.map((r) => r.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ''))).join(',')).join('\n');
  const calls = [];
  globalThis.fetch = async (url, opt = {}) => {
    url = String(url);
    if (url.startsWith('https://oauth2.googleapis.com/token')) { calls.push(['token', String(opt.body)]); return Response.json({ access_token: 'acc', expires_in: 3600 }); }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files/abcdef123456')) { calls.push(['drive', opt.headers?.Authorization]); return new Response(csv, { headers: { 'content-type': 'text/csv' } }); }
    if (url.startsWith('https://db.example.com/rest/v1/rpc/')) { calls.push(['rpc', url.split('/').pop(), JSON.parse(opt.body)]); return new Response(''); }
    throw new Error('fetch inesperado ' + url);
  };
  const sent = [];
  const mailer = async (_cfg, m) => { sent.push(m); return true; };
  const payload = (kind, rule = null, extra = {}) => ({ id: SID, kind, name: 'Mi envío', frequency: 'weekly', rule, channels: ['email'], whatsapp: [], last_triggered: false, last_status: null,
    recipients: ['uno@example.com', 'dos@example.com'], project: { id: UID, name: 'Proyecto', state }, owner: { id: UID, email: 'dueno@example.com', pro: true }, token: encrypt('refresh-1'), ...extra });
  return { calls, sent, mailer, payload, columns: t.columns };
}

test('reporte programado: renueva el acceso, descarga, calcula y envía a cada destinatario', async () => {
  const { calls, sent, mailer, payload } = setup('ventas');
  const r = await runSchedule(payload('report'), { mailer });
  assert.equal(r.status, 'ok');
  assert.equal(sent.length, 2);
  assert.match(calls.find((c) => c[0] === 'token')[1], /refresh_token=refresh-1/);
  assert.equal(calls.find((c) => c[0] === 'drive')[1], 'Bearer acc');
  const fin = calls.find((c) => c[1] === 'dl_finish_schedule');
  assert.equal(fin[2].p_status, 'ok');
  const html = Buffer.from(sent[0].data.split('Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('--dl-')[0].replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.match(html, /Abrir el tablero completo/);
  assert.match(html, /reportes\/baja\?s=/);
  assert.ok(sent[0].data.includes('List-Unsubscribe'));
});

test('alerta: avisa solo al pasar a «cumplida» y no repite', async () => {
  const { sent, mailer, payload, calls } = setup('ventas');
  const metric = TEMPLATES.find((t) => t.id === 'ventas').columns.find((c) => c.type === 'number');
  const ventas = calls && setup('ventas').columns.find((c) => c.type === 'number').name;
  assert.ok(metric && ventas);
  const rule = { metric: ventas, agg: 'SUM', mode: 'total', op: 'gt', threshold: 1 };
  const a = await runSchedule(payload('alert', rule), { mailer });
  assert.equal(a.status, 'alerta_enviada');
  assert.equal(a.triggered, true);
  const n = sent.length;
  const b = await runSchedule(payload('alert', rule, { last_triggered: true }), { mailer });
  assert.equal(b.status, 'alerta_activa');
  assert.equal(sent.length, n, 'no reenvía mientras siga cumplida');
  const c = await runSchedule(payload('alert', { ...rule, op: 'lt' }), { mailer });
  assert.equal(c.status, 'normal');
});

test('sin permiso guardado: falla con aviso único al dueño', async () => {
  const { sent, mailer, payload } = setup('ventas');
  const r = await runSchedule(payload('report', null, { token: null }), { mailer });
  assert.equal(r.status, 'error_permiso');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'dueno@example.com');
  await runSchedule(payload('report', null, { token: null, last_status: 'error_permiso' }), { mailer });
  assert.equal(sent.length, 1, 'no insiste si ya falló antes');
});

test('dueño sin plan Pro: no se envía nada', async () => {
  const { sent, mailer, payload } = setup('ventas');
  const r = await runSchedule(payload('report', null, { owner: { id: UID, email: 'd@example.com', pro: false } }), { mailer });
  assert.equal(r.status, 'sin_plan');
  assert.equal(sent.length, 0);
});

test('token de baja ligado al correo', () => {
  assert.notEqual(unsubscribeToken(SID, 'a@example.com'), unsubscribeToken(SID, 'b@example.com'));
  assert.equal(unsubscribeToken(SID, 'A@Example.com'), unsubscribeToken(SID, 'a@example.com'));
});

test('callback: solo guarda el permiso si vuelve al navegador que lo pidió', async () => {
  const { default: cb } = await import('../api/conexiones/callback.js');
  const stored = [];
  globalThis.fetch = async (url, opt = {}) => {
    url = String(url);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'a', refresh_token: 'perm', id_token: `x.${Buffer.from(JSON.stringify({ email: 'v@gmail.com' })).toString('base64url')}.y` });
    if (url.includes('/rpc/dl_store_connection')) { stored.push(JSON.parse(opt.body)); return new Response(''); }
    throw new Error('fetch inesperado ' + url);
  };
  const n = 'nonceDePrueba123456789';
  const state = new URL(authorizeUrl('google', UID, n)).searchParams.get('state');
  const req = (cookie) => new Request(`https://data-lite.vercel.app/api/conexiones/callback?code=abc&state=${encodeURIComponent(state)}`, { headers: cookie ? { cookie } : {} });
  const r1 = await cb.fetch(req(null));
  assert.match(r1.headers.get('location'), /r=estado/);
  const r2 = await cb.fetch(req('dl_oauth=otroNonce12345678901'));
  assert.match(r2.headers.get('location'), /r=estado/);
  assert.equal(stored.length, 0);
  const r3 = await cb.fetch(req(`a=1; dl_oauth=${n}`));
  assert.match(r3.headers.get('location'), /r=ok&p=google/);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].p_user, UID);
  assert.equal(stored[0].p_account, 'v@gmail.com');
  assert.equal(decrypt(stored[0].p_token), 'perm');
});
