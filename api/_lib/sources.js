// Descarga en el servidor de la hoja conectada (Google Sheets o Excel en línea) con un acceso de corta duración.
const MAX_BYTES = 30 * 1024 * 1024;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const GSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
export const ID_RE = /^[A-Za-z0-9_!.-]{5,200}$/;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const MS_DL_HOSTS = ['sharepoint.com', '1drv.com', 'livefilestore.com', 'onedrive.com', 'microsoftpersonalcontent.com'];

export class SourceError extends Error {
  constructor(message, kind = 'error') { super(message); this.kind = kind; }
}

const safeName = (n) => String(n || 'Hoja en línea').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').trim().slice(0, 120) || 'Hoja en línea';

async function readLimited(res) {
  if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) throw new SourceError('La hoja pesa más de 30 MB.', 'limit');
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new SourceError('La hoja pesa más de 30 MB.', 'limit');
  return buf;
}

const get = (url, token) => fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, redirect: 'follow', signal: AbortSignal.timeout(20_000) });

function accessError(res, who) {
  if (res.status === 401) return new SourceError(`El permiso de ${who} venció. Vuelve a activar la actualización automática.`, 'auth');
  if (res.status === 403 || res.status === 404) return new SourceError(`Ya no hay acceso a la hoja en ${who}. Revisa que siga existiendo y compartida contigo.`, 'access');
  return new SourceError(`${who} no entregó la hoja (código ${res.status}).`);
}

async function google(src, token) {
  const id = encodeURIComponent(src.id);
  const native = (src.mime || GSHEET_MIME) === GSHEET_MIME;
  const url = native
    ? `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`
    : `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`;
  const res = await get(url, token);
  if (!res.ok) throw accessError(res, 'Google');
  const ext = native || src.mime === XLSX_MIME ? '.xlsx' : '.csv';
  return { buffer: await readLimited(res), fileName: safeName(src.name).replace(/\.(xlsx|csv)$/i, '') + ext };
}

const hostOk = (url) => { try { const u = new URL(url); return u.protocol === 'https:' && MS_DL_HOSTS.some((d) => u.hostname === d || u.hostname.endsWith('.' + d)); } catch { return false; } };

async function microsoft(src, token) {
  if (src.driveId && !ID_RE.test(src.driveId)) throw new SourceError('La conexión guardada no es válida.');
  const base = src.driveId ? `/drives/${encodeURIComponent(src.driveId)}/items/${encodeURIComponent(src.id)}` : `/me/drive/items/${encodeURIComponent(src.id)}`;
  const m = await get(`${GRAPH}${base}?$select=id,name,size,@microsoft.graph.downloadUrl`, token);
  if (!m.ok) throw accessError(m, 'Microsoft');
  const meta = await m.json();
  if (meta.size > MAX_BYTES) throw new SourceError('El archivo pesa más de 30 MB.', 'limit');
  const dl = meta['@microsoft.graph.downloadUrl'];
  // El enlace temporal ya está autorizado: se descarga sin enviar el token.
  const res = typeof dl === 'string' && hostOk(dl) ? await get(dl) : await get(`${GRAPH}${base}/content`, token);
  if (!res.ok) throw accessError(res, 'Microsoft');
  return { buffer: await readLimited(res), fileName: safeName(meta.name || src.name) };
}

/** Descarga la versión actual de la hoja guardada en el proyecto. */
export function downloadSource(src, token) {
  if (!src || !ID_RE.test(src.id || '')) return Promise.reject(new SourceError('La conexión guardada no es válida.'));
  if (src.type === 'google') return google(src, token);
  if (src.type === 'microsoft') return microsoft(src, token);
  return Promise.reject(new SourceError('Tipo de conexión desconocido.'));
}
