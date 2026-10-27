// Utilidades de Wompi (Colombia), mismas reglas que Custodia IA. Funciones puras, probadas en tests/wompi.test.mjs.
import { createHash, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Firma de integridad del Web Checkout: SHA256(referencia + monto en centavos + moneda + secreto). */
export const integritySignature = (reference, amountInCents, currency, secret) => sha256Hex(`${reference}${amountInCents}${currency}${secret}`);

/** La llave pública indica el ambiente: pub_test_ → sandbox, pub_prod_ → producción. */
export const apiBase = (publicKey) => (publicKey.startsWith('pub_test_') ? 'https://sandbox.wompi.co/v1' : 'https://production.wompi.co/v1');

export function checkoutUrl({ publicKey, reference, amountInCents, currency, signature, redirectUrl, email }) {
  const q = new URLSearchParams({
    'public-key': publicKey, currency, 'amount-in-cents': String(amountInCents), reference,
    'signature:integrity': signature, 'redirect-url': redirectUrl,
  });
  if (email) q.set('customer-data:email', email);
  return `https://checkout.wompi.co/p/?${q.toString()}`;
}

function pick(data, path) {
  return path.split('.').reduce((acc, key) => (acc && typeof acc === 'object' && Object.prototype.hasOwnProperty.call(acc, key) ? acc[key] : undefined), data);
}

/**
 * Verifica un evento: SHA256(valores de signature.properties en orden + timestamp + secreto),
 * comparado en tiempo constante con el checksum recibido (cabecera o cuerpo).
 */
export function verifyEvent(event, secret, headerChecksum) {
  const props = event?.signature?.properties;
  const received = String(headerChecksum || event?.signature?.checksum || '').toLowerCase();
  if (!secret || !Array.isArray(props) || props.length === 0 || props.length > 20 || !received || typeof event.timestamp !== 'number') return false;
  const values = props.map((p) => (typeof p === 'string' ? pick(event.data, p) : undefined));
  if (values.some((v) => v === undefined || v === null || typeof v === 'object')) return false;
  const expected = sha256Hex(`${values.map(String).join('')}${event.timestamp}${secret}`);
  const a = Buffer.from(expected, 'utf8'), b = Buffer.from(received, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Consulta la transacción directamente a Wompi (fuente de verdad para la página de retorno). */
export async function fetchTransaction(publicKey, id) {
  if (!/^[0-9A-Za-z-]{5,80}$/.test(id)) return null;
  const res = await fetch(`${apiBase(publicKey)}/transactions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${publicKey}` }, signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.data ?? null;
}
