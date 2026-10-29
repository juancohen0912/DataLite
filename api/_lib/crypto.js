// Cifrado de permisos permanentes (AES-256-GCM) y firmas HMAC para enlaces y estados de OAuth.
// La clave vive solo en Vercel (TOKEN_ENC_KEY, 32 bytes en base64); la base guarda únicamente el texto cifrado.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const rawKey = () => {
  const k = Buffer.from(process.env.TOKEN_ENC_KEY || '', 'base64');
  if (k.length !== 32) throw new Error('TOKEN_ENC_KEY no está configurada.');
  return k;
};
export const cryptoReady = () => { try { rawKey(); return true; } catch { return false; } };

// Subclaves separadas por uso, para no reutilizar la misma clave en contextos distintos
const subkey = (label) => createHmac('sha256', rawKey()).update(`datalite:${label}`).digest();

export function encrypt(text) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', subkey('tokens'), iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`;
}

export function decrypt(blob) {
  if (typeof blob !== 'string' || !blob.startsWith('v1:')) throw new Error('Formato cifrado desconocido.');
  const buf = Buffer.from(blob.slice(3), 'base64');
  const d = createDecipheriv('aes-256-gcm', subkey('tokens'), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

export const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const sign = (label, data) => b64url(createHmac('sha256', subkey(label)).update(data).digest());
export function verify(label, data, mac) {
  const a = Buffer.from(sign(label, data)), b = Buffer.from(String(mac || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}
export const nonce = () => b64url(randomBytes(18));
