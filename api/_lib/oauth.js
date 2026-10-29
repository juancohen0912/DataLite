// Permiso permanente (sin conexión) para leer la hoja conectada: Google Drive (drive.file) y Microsoft Graph.
// Flujo de código con secreto de cliente en el servidor + PKCE; el estado va firmado y vence en 10 minutos.
import { createHash } from 'node:crypto';
import { sign, verify, nonce, b64url } from './crypto.js';
import { env } from './server.js';
// ID públicos de cliente (los mismos de src/config.js; src no se despliega con las funciones)
const CLIENT_IDS = { google: '479717259837-dvgb2hvp6j94dj20sfrjglndoma8ek9u.apps.googleusercontent.com', microsoft: '66a80d69-c597-430b-853c-4961a6ac0cb2' };

export const PROVIDERS = {
  google: {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email https://www.googleapis.com/auth/drive.file',
    extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false' },
    clientId: () => process.env.GOOGLE_CLIENT_ID || CLIENT_IDS.google,
    secret: () => process.env.GOOGLE_CLIENT_SECRET || '',
  },
  microsoft: {
    auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'openid email offline_access https://graph.microsoft.com/Files.Read.All',
    extra: { prompt: 'select_account', response_mode: 'query' },
    clientId: () => process.env.MICROSOFT_CLIENT_ID || CLIENT_IDS.microsoft,
    secret: () => process.env.MICROSOFT_CLIENT_SECRET || '',
  },
};
export const providerReady = (p) => Boolean(PROVIDERS[p] && PROVIDERS[p].clientId() && PROVIDERS[p].secret());
export const redirectUri = () => `${env.SITE_URL}/api/conexiones/callback`;

const verifierFor = (n) => sign('pkce', n);
const challengeOf = (v) => b64url(createHash('sha256').update(v).digest());

/** URL de autorización para el usuario; el estado firmado identifica a quién guardar el permiso. */
export function authorizeUrl(provider, userId, n = nonce()) {
  const P = PROVIDERS[provider];
  const payload = b64url(JSON.stringify({ u: userId, p: provider, n, e: Date.now() + 10 * 60_000 }));
  const state = `${payload}.${sign('state', payload)}`;
  const q = new URLSearchParams({
    client_id: P.clientId(), response_type: 'code', redirect_uri: redirectUri(), scope: P.scope, state,
    code_challenge: challengeOf(verifierFor(n)), code_challenge_method: 'S256', ...P.extra,
  });
  return `${P.auth}?${q}`;
}

// Cookie que ata el flujo al navegador que lo inició (evita que alguien envíe su enlace de permiso a otra persona)
export const FLOW_COOKIE = 'dl_oauth';
export const flowCookie = (n) => `${FLOW_COOKIE}=${n}; Path=/api/conexiones; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
export const clearFlowCookie = () => `${FLOW_COOKIE}=; Path=/api/conexiones; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
export function flowNonce(request) {
  const m = new RegExp(`(?:^|;\\s*)${FLOW_COOKIE}=([A-Za-z0-9_-]{10,64})`).exec(request.headers.get('cookie') || '');
  return m ? m[1] : null;
}

export function readState(state) {
  const [payload, mac] = String(state || '').split('.');
  if (!payload || !verify('state', payload, mac)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!s.u || !PROVIDERS[s.p] || !s.n || s.e < Date.now()) return null;
    return s;
  } catch { return null; }
}

async function tokenRequest(provider, params) {
  const P = PROVIDERS[provider];
  const res = await fetch(P.token, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: P.clientId(), client_secret: P.secret(), ...params }), signal: AbortSignal.timeout(10_000),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) {
    const e = new Error(d.error_description ? String(d.error_description).split('\n')[0].slice(0, 200) : `token_${res.status}`);
    e.code = d.error || `http_${res.status}`;
    throw e;
  }
  return d;
}

/** Canjea el código del retorno: devuelve el permiso permanente y el correo de la cuenta. */
export async function exchangeCode(provider, code, st) {
  const d = await tokenRequest(provider, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifierFor(st.n) });
  if (!d.refresh_token) { const e = new Error('El proveedor no entregó permiso permanente.'); e.code = 'no_refresh'; throw e; }
  let account = null;
  try {
    const claims = JSON.parse(Buffer.from(String(d.id_token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    account = claims.email || claims.preferred_username || null;
  } catch { /* sin id_token */ }
  return { refresh: d.refresh_token, access: d.access_token, account };
}

/** Acceso de corta duración a partir del permiso permanente. Microsoft rota el permiso: se devuelve el nuevo. */
export async function refreshAccess(provider, refresh) {
  const d = await tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: refresh, ...(provider === 'microsoft' ? { scope: PROVIDERS.microsoft.scope } : {}) });
  return { access: d.access_token, refresh: d.refresh_token && d.refresh_token !== refresh ? d.refresh_token : null };
}
