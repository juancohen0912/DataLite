// Conexiones a hojas de cálculo en línea (Google Sheets y Excel en OneDrive/SharePoint).
// Todo ocurre en el navegador: el usuario elige el archivo en la ventana oficial del proveedor,
// los tokens viven solo en memoria y el archivo se descarga directo desde Google o Microsoft.
import { CONNECT } from '../config.js';

export class ConnectError extends Error {
  constructor(message, kind = 'error') { super(message); this.kind = kind; }
}

export const googleEnabled = () => Boolean(CONNECT.google.clientId && CONNECT.google.apiKey && CONNECT.google.appId);
export const microsoftEnabled = () => Boolean(CONNECT.microsoft.clientId);

const MAX_BYTES = 30 * 1024 * 1024;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const GSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const ID_RE = /^[A-Za-z0-9_!.-]{5,200}$/;

const scripts = new Map();
function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.referrerPolicy = 'strict-origin-when-cross-origin';
      s.onload = resolve;
      s.onerror = () => { scripts.delete(src); reject(new ConnectError('No pudimos cargar la conexión. Revisa tu internet o desactiva el bloqueador de anuncios para este sitio.')); };
      document.head.appendChild(s);
    }));
  }
  return scripts.get(src);
}

async function readLimited(res) {
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new ConnectError('La hoja pesa más de 30 MB, el máximo que DataLite puede leer.', 'limit');
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new ConnectError('La hoja pesa más de 30 MB, el máximo que DataLite puede leer.', 'limit');
  return buf;
}

const safeName = (n) => String(n || 'Hoja en línea').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').trim().slice(0, 120) || 'Hoja en línea';

// ------------------------------------------------------------------ Google

let gToken = null; // { token, exp }
let tokenClient = null;

async function googleReady() {
  await Promise.all([loadScript('https://accounts.google.com/gsi/client'), loadScript('https://apis.google.com/js/api.js')]);
  await new Promise((resolve, reject) => window.gapi.load('picker', { callback: resolve, onerror: () => reject(new ConnectError('No pudimos abrir el selector de Google.')) }));
}

function googleToken(interactive) {
  if (gToken && gToken.exp - 60_000 > Date.now()) return Promise.resolve(gToken.token);
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CONNECT.google.clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: () => {},
      });
    }
    tokenClient.callback = (r) => {
      if (r.error || !r.access_token) return reject(new ConnectError(r.error === 'access_denied' ? 'No diste permiso para leer la hoja.' : 'Google no autorizó la conexión. Intenta de nuevo.', 'denied'));
      gToken = { token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
      resolve(gToken.token);
    };
    tokenClient.error_callback = (e) => reject(new ConnectError(e?.type === 'popup_closed' ? 'Cerraste la ventana de Google antes de terminar.' : 'No pudimos abrir la ventana de Google. Permite las ventanas emergentes para este sitio.', 'popup'));
    tokenClient.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

/** Abre el selector de Google y devuelve la referencia del archivo elegido. */
export async function pickGoogleSheet() {
  await googleReady();
  const token = await googleToken(true);
  const P = window.google.picker;
  return new Promise((resolve, reject) => {
    const view = new P.DocsView(P.ViewId.SPREADSHEETS).setMimeTypes([GSHEET_MIME, XLSX_MIME, 'text/csv'].join(',')).setMode(P.DocsViewMode.LIST);
    const picker = new P.PickerBuilder()
      .setDeveloperKey(CONNECT.google.apiKey)
      .setAppId(CONNECT.google.appId)
      .setOAuthToken(token)
      .setLocale('es')
      .setTitle('Elige la hoja para tu tablero')
      .addView(view)
      .setCallback((d) => {
        if (d.action === P.Action.PICKED) {
          const doc = d[P.Response.DOCUMENTS]?.[0];
          if (!doc || !ID_RE.test(doc[P.Document.ID])) return reject(new ConnectError('El archivo elegido no es válido.'));
          resolve({ type: 'google', id: doc[P.Document.ID], name: safeName(doc[P.Document.NAME]), mime: doc[P.Document.MIME_TYPE] || GSHEET_MIME });
        } else if (d.action === P.Action.CANCEL) resolve(null);
      })
      .build();
    picker.setVisible(true);
  });
}

async function downloadGoogle(src) {
  await googleReady();
  let token;
  try { token = await googleToken(false); } catch { token = await googleToken(true); }
  const id = encodeURIComponent(src.id);
  const native = src.mime === GSHEET_MIME;
  const url = native
    ? `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`
    : `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit' });
  if (res.status === 401) { gToken = null; throw new ConnectError('Tu conexión con Google venció. Vuelve a conectar la hoja.', 'auth'); }
  if (res.status === 403 || res.status === 404) throw new ConnectError('Ya no tenemos acceso a esa hoja. Vuelve a elegirla con «Conectar Google Sheets».', 'access');
  if (!res.ok) throw new ConnectError(native && res.status === 500 ? 'Google no pudo exportar la hoja (máximo 10 MB al exportar).' : 'Google no entregó la hoja. Intenta de nuevo.');
  const ext = native || src.mime === XLSX_MIME ? '.xlsx' : '.csv';
  return new File([await readLimited(res)], safeName(src.name).replace(/\.(xlsx|csv)$/i, '') + ext);
}

// ------------------------------------------------------------------ Microsoft (OneDrive y SharePoint)

const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const MS_SCOPE = 'https://graph.microsoft.com/Files.Read.All offline_access';
const GRAPH = 'https://graph.microsoft.com/v1.0';
let msTok = null; // { access, refresh, exp } solo en memoria

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const msRedirect = () => `${location.origin}/conectar/microsoft`;

async function msTokenRequest(params) {
  const res = await fetch(`${MS_AUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CONNECT.microsoft.clientId, scope: MS_SCOPE, ...params }), credentials: 'omit' });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) throw new ConnectError(/AADSTS65001|consent/i.test(d.error_description || '') ? 'Tu empresa debe aprobar DataLite para leer archivos de Microsoft 365. Pídeselo a tu administrador de TI.' : 'Microsoft no autorizó la conexión. Intenta de nuevo.', 'auth');
  msTok = { access: d.access_token, refresh: d.refresh_token || null, exp: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return msTok.access;
}

/** Inicia sesión con Microsoft en una ventana emergente (código + PKCE, sin secretos en el navegador). */
function msLogin() {
  return new Promise((resolve, reject) => {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const state = b64url(crypto.getRandomValues(new Uint8Array(18)));
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then((h) => {
      const url = `${MS_AUTH}/authorize?` + new URLSearchParams({
        client_id: CONNECT.microsoft.clientId, response_type: 'code', redirect_uri: msRedirect(), response_mode: 'query',
        scope: MS_SCOPE, state, code_challenge: b64url(h), code_challenge_method: 'S256', prompt: 'select_account',
      });
      const w = window.open(url, 'dl-microsoft', 'width=520,height=680');
      if (!w) return reject(new ConnectError('Permite las ventanas emergentes para este sitio y vuelve a intentarlo.', 'popup'));
      const timer = setInterval(() => { if (w.closed) { cleanup(); reject(new ConnectError('Cerraste la ventana de Microsoft antes de terminar.', 'popup')); } }, 600);
      let bc = null;
      const onMsg = (e) => {
        if (e.origin && e.origin !== location.origin) return;
        if (e.data?.type !== 'dl-microsoft' || e.data.state !== state) return;
        cleanup(); try { w.close(); } catch { /* nada */ }
        if (e.data.state !== state) return reject(new ConnectError('La respuesta de Microsoft no coincide. Intenta de nuevo.'));
        if (e.data.error || !e.data.code) return reject(new ConnectError(e.data.error === 'access_denied' ? 'No diste permiso para leer tus archivos.' : 'Microsoft no autorizó la conexión.', 'denied'));
        msTokenRequest({ grant_type: 'authorization_code', code: e.data.code, redirect_uri: msRedirect(), code_verifier: verifier }).then(resolve, reject);
      };
      const cleanup = () => { clearInterval(timer); window.removeEventListener('message', onMsg); try { bc?.close(); } catch { /* nada */ } };
      window.addEventListener('message', onMsg);
      try { bc = new BroadcastChannel('dl-microsoft'); bc.onmessage = (e) => onMsg({ origin: location.origin, data: e.data }); } catch { /* sin soporte */ }
    });
  });
}

async function msToken(interactive) {
  if (msTok && msTok.exp - 60_000 > Date.now()) return msTok.access;
  if (msTok?.refresh) { try { return await msTokenRequest({ grant_type: 'refresh_token', refresh_token: msTok.refresh }); } catch { msTok = null; } }
  if (!interactive) throw new ConnectError('Conéctate de nuevo con Microsoft.', 'auth');
  return msLogin();
}

async function graph(path, interactive = true) {
  const token = await msToken(interactive);
  const res = await fetch(GRAPH + path, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit' });
  if (res.status === 401) { msTok = null; throw new ConnectError('Tu conexión con Microsoft venció. Vuelve a conectar.', 'auth'); }
  if (res.status === 403 || res.status === 404) throw new ConnectError('No tenemos acceso a ese archivo. Revisa que siga compartido contigo.', 'access');
  if (!res.ok) throw new ConnectError('Microsoft no respondió. Intenta de nuevo.');
  return res.json();
}

/** Conecta con Microsoft (si hace falta) y busca libros de Excel en OneDrive y SharePoint. */
export async function listMicrosoftWorkbooks(query = '') {
  const q = String(query).replace(/['"\\]/g, ' ').trim().slice(0, 80) || 'xlsx';
  const d = await graph(`/me/drive/root/search(q='${encodeURIComponent(q)}')?$top=50&$select=id,name,size,lastModifiedDateTime,parentReference,file,remoteItem`);
  return (d.value || [])
    .map((it) => {
      const r = it.remoteItem || it;
      return { type: 'microsoft', id: r.id, driveId: r.parentReference?.driveId || it.parentReference?.driveId, name: safeName(it.name), size: r.size ?? it.size, modified: it.lastModifiedDateTime, where: r.parentReference?.path?.replace(/^\/drive\/root:/, '') || '' };
    })
    .filter((f) => /\.(xlsx|xlsm|csv)$/i.test(f.name) && ID_RE.test(f.id) && (!f.driveId || ID_RE.test(f.driveId)));
}

async function downloadMicrosoft(src) {
  const base = src.driveId ? `/drives/${encodeURIComponent(src.driveId)}/items/${encodeURIComponent(src.id)}` : `/me/drive/items/${encodeURIComponent(src.id)}`;
  const meta = await graph(`${base}?$select=id,name,size,@microsoft.graph.downloadUrl`, false).catch(async (e) => { if (e.kind === 'auth') return graph(`${base}?$select=id,name,size,@microsoft.graph.downloadUrl`, true); throw e; });
  if (meta.size > MAX_BYTES) throw new ConnectError('El archivo pesa más de 30 MB, el máximo que DataLite puede leer.', 'limit');
  const url = meta['@microsoft.graph.downloadUrl'];
  if (typeof url !== 'string' || !/^https:\/\/[^/]+\.(sharepoint\.com|1drv\.com|livefilestore\.com|onedrive\.com)\//i.test(url)) throw new ConnectError('Microsoft no entregó un enlace de descarga válido.');
  const res = await fetch(url, { cache: 'no-store', credentials: 'omit' });
  if (!res.ok) throw new ConnectError('No pudimos descargar el archivo desde Microsoft.');
  return new File([await readLimited(res)], safeName(meta.name || src.name));
}

// ------------------------------------------------------------------ Común

/** Descarga la versión actual de la hoja conectada como un File listo para el lector de DataLite. */
export function fetchSource(src) {
  if (!src || !ID_RE.test(src.id || '')) return Promise.reject(new ConnectError('La conexión guardada no es válida.'));
  if (src.type === 'google') return downloadGoogle(src);
  if (src.type === 'microsoft') return downloadMicrosoft(src);
  return Promise.reject(new ConnectError('Tipo de conexión desconocido.'));
}

/** Solo los datos necesarios para volver a leer la hoja (se guardan con el proyecto; sin tokens). */
export function sourceRef(src, sheet) {
  if (!src) return null;
  const ref = { type: src.type, id: src.id, name: src.name, sheet: sheet || null };
  if (src.mime) ref.mime = src.mime;
  if (src.driveId) ref.driveId = src.driveId;
  return ref;
}

export const sourceLabel = (src) => (src?.type === 'google' ? 'Google Sheets' : src?.type === 'microsoft' ? 'Excel en línea' : '');
