// Cliente de la nube de DataLite (Supabase) sin dependencias: sesión con enlace al correo (PKCE),
// llamadas a funciones protegidas por RLS y datos del proyecto comprimidos en Storage privado.
import { CLOUD } from '../config.js';

export const CONSENT_VERSION = '2026-10-27';
const SESSION_KEY = 'dl-session-v1';
const PKCE_KEY = 'dl-pkce-v1';

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* almacenamiento bloqueado */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* nada */ } },
};

export const cloudEnabled = () => Boolean(CLOUD.url && CLOUD.anonKey);

export class CloudError extends Error {
  constructor(message, kind = 'error', status = 0) { super(message); this.kind = kind; this.status = status; }
}

// ------------------------------------------------------------------ Sesión

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function authFetch(path, body, token) {
  const res = await fetch(`${CLOUD.url}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: CLOUD.anonKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 429) throw new CloudError('Pediste varios enlaces seguidos. Espera un minuto e inténtalo de nuevo.', 'rate', 429);
    throw new CloudError(data.msg || data.error_description || data.message || 'No pudimos completar el inicio de sesión.', 'auth', res.status);
  }
  return data;
}

function saveSession(s) {
  const session = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), email: s.user?.email || null };
  store.set(SESSION_KEY, session);
  return session;
}
export const currentSession = () => store.get(SESSION_KEY);

/** Envía el enlace de acceso al correo. Para cuentas nuevas registra la versión de la política aceptada. */
export async function sendMagicLink(email, returnTo = location.pathname + location.search) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  store.set(PKCE_KEY, { verifier, returnTo: returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/', at: Date.now() });
  const redirect = `${location.origin}/?auth=1`;
  await authFetch(`otp?redirect_to=${encodeURIComponent(redirect)}`, {
    email: email.trim().toLowerCase(), create_user: true,
    data: { signup_app: 'datalite', consent_version: CONSENT_VERSION },
    code_challenge: challenge, code_challenge_method: 's256',
  });
}

/** Completa el inicio de sesión cuando la persona vuelve desde el enlace del correo. Devuelve la ruta a la que volver. */
export async function handleAuthCallback() {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error_description') || new URLSearchParams(url.hash.slice(1)).get('error_description');
  if (!code && !err) return null;
  const clean = () => { url.searchParams.delete('code'); url.searchParams.delete('auth'); url.searchParams.delete('error'); url.searchParams.delete('error_code'); url.searchParams.delete('error_description'); history.replaceState(null, '', url.pathname + (url.search || '') ); };
  const pkce = store.get(PKCE_KEY);
  clean();
  if (err) throw new CloudError(/expired|invalid/i.test(err) ? 'El enlace venció o ya se usó. Pide uno nuevo.' : err, 'auth');
  if (!pkce?.verifier) throw new CloudError('Abre el enlace en el mismo navegador donde lo pediste, o pide uno nuevo aquí.', 'auth');
  const data = await authFetch('token?grant_type=pkce', { auth_code: code, code_verifier: pkce.verifier });
  store.del(PKCE_KEY);
  saveSession(data);
  return pkce.returnTo || '/';
}

let refreshing = null;
/** Token vigente (lo renueva si está por vencer). */
export async function accessToken() {
  const s = currentSession();
  if (!s) return null;
  if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
  if (!refreshing) {
    refreshing = authFetch('token?grant_type=refresh_token', { refresh_token: s.refresh_token })
      .then((d) => saveSession(d).access_token)
      .catch((e) => { if (e.status === 400 || e.status === 401) store.del(SESSION_KEY); throw e; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function signOut() {
  const s = currentSession();
  store.del(SESSION_KEY);
  try { localStorage.removeItem('dl-plan'); } catch { /* nada */ }
  if (s?.access_token) { try { await authFetch('logout', null, s.access_token); } catch { /* la sesión local ya se borró */ } }
}

// ------------------------------------------------------------------ Funciones de la base

const KINDS = { consent: 'consent', pro: 'pro', limit: 'limit', conflict: 'conflict', viewer: 'viewer', owner_not_pro: 'owner_not_pro', notfound: 'notfound', trial_used: 'trial_used', rate: 'rate' };

export async function rpc(fn, args = {}) {
  const token = await accessToken();
  if (!token) throw new CloudError('Inicia sesión para continuar.', 'login', 401);
  const res = await fetch(`${CLOUD.url}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: CLOUD.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    if (res.status === 401) { store.del(SESSION_KEY); throw new CloudError('Tu sesión venció. Inicia sesión de nuevo.', 'login', 401); }
    const kind = KINDS[data?.hint] || 'error';
    const message = data?.message && data.code === 'P0001' ? data.message : 'No pudimos completar la acción. Intenta de nuevo.';
    throw new CloudError(message, kind, res.status);
  }
  return data;
}

// ------------------------------------------------------------------ Datos del proyecto (comprimidos)

const objectPath = (projectId) => `${projectId}/data.bin`;

/** Empaqueta la tabla original (sin columnas calculadas) en JSON comprimido con gzip. */
export async function packTable(ds) {
  const json = JSON.stringify({ v: 1, fileName: ds.fileName, columns: ds.columns.map((c) => ({ name: c.name, type: c.type })), rows: ds.rows, truncated: !!ds.truncated },
    function (k, v) { const raw = this[k]; return raw instanceof Date ? { $d: raw.getTime() } : v; });
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const blob = await new Response(stream).blob();
  return new Blob([blob], { type: 'application/octet-stream' });
}

export async function unpackTable(blob) {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  const text = await new Response(stream).text();
  const data = JSON.parse(text, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.$d === 'number' ? new Date(v.$d) : v));
  if (data?.v !== 1 || !Array.isArray(data.columns) || !Array.isArray(data.rows)) throw new CloudError('Los datos guardados del proyecto están dañados.');
  return data;
}

export async function uploadData(projectId, blob) {
  const token = await accessToken();
  const res = await fetch(`${CLOUD.url}/storage/v1/object/datalite/${objectPath(projectId)}`, {
    method: 'POST', headers: { apikey: CLOUD.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'x-upsert': 'true', 'cache-control': 'no-store' }, body: blob,
  });
  if (!res.ok) {
    if (res.status === 413) throw new CloudError('Los datos son demasiado grandes para guardarlos (máximo 25 MB comprimidos).', 'limit', 413);
    throw new CloudError('No pudimos subir los datos del proyecto.', 'error', res.status);
  }
}

export async function downloadData(projectId) {
  const token = await accessToken();
  const res = await fetch(`${CLOUD.url}/storage/v1/object/authenticated/datalite/${objectPath(projectId)}`, { headers: { apikey: CLOUD.anonKey, Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!res.ok) throw new CloudError('No pudimos descargar los datos del proyecto.', 'error', res.status);
  return unpackTable(await res.blob());
}

export async function deleteData(projectId) {
  const token = await accessToken();
  await fetch(`${CLOUD.url}/storage/v1/object/datalite`, {
    method: 'DELETE', headers: { apikey: CLOUD.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [objectPath(projectId)] }),
  }).catch(() => null);
}

// ------------------------------------------------------------------ Pagos (funciones del propio sitio)

export async function startCheckout() {
  const token = await accessToken();
  if (!token) throw new CloudError('Inicia sesión para continuar.', 'login', 401);
  const res = await fetch('/api/pagos/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ plan: 'pro' }) });
  const data = await res.json().catch(() => ({}));
  if (res.ok && typeof data.url === 'string') {
    const u = new URL(data.url);
    if (u.protocol === 'https:' && u.host === 'checkout.wompi.co') return u.toString(); // solo el checkout oficial de Wompi
  }
  if (res.status === 503) throw new CloudError('El pago en línea se habilita en los próximos días.', 'unavailable', 503);
  if (res.status === 409) throw new CloudError(data.error, 'consent', 409);
  throw new CloudError(data.error || 'No pudimos iniciar el pago. Intenta de nuevo.', 'error', res.status);
}

export async function confirmPayment(id) {
  const token = await accessToken();
  if (!token) throw new CloudError('Inicia sesión con el mismo correo con el que pagaste para confirmar el pago.', 'login', 401);
  const res = await fetch(`/api/pagos/confirmar?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new CloudError(data.error || 'No pudimos confirmar el pago.', 'error', res.status);
  return data;
}
