import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integritySignature, verifyEvent, sha256Hex, checkoutUrl, apiBase } from '../api/_lib/wompi.js';

test('firma de integridad igual a la documentación de Wompi', () => {
  // Ejemplo de la documentación: "sk8-438k4-xmxm392-sn2m" + 2490000 + "COP" + secreto
  const sig = integritySignature('sk8-438k4-xmxm392-sn2m', 2490000, 'COP', 'prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6');
  assert.equal(sig, sha256Hex('sk8-438k4-xmxm392-sn2m2490000COPprod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6'));
  assert.match(sig, /^[0-9a-f]{64}$/);
});

test('verificación de eventos', () => {
  const secret = 'eventos_secreto';
  const data = { transaction: { id: '1234-1610641025-49201', status: 'APPROVED', amount_in_cents: 1990000, reference: 'DL-abc1234567' } };
  const props = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
  const timestamp = 1530291411;
  const checksum = sha256Hex(`${data.transaction.id}${data.transaction.status}${data.transaction.amount_in_cents}${timestamp}${secret}`);
  const ev = { event: 'transaction.updated', data, signature: { properties: props, checksum }, timestamp };
  assert.equal(verifyEvent(ev, secret), true);
  assert.equal(verifyEvent(ev, secret, checksum.toUpperCase()), true, 'cabecera en mayúsculas');
  assert.equal(verifyEvent({ ...ev, data: { transaction: { ...data.transaction, amount_in_cents: 100 } } }, secret), false, 'monto alterado');
  assert.equal(verifyEvent(ev, 'otro'), false, 'secreto equivocado');
  assert.equal(verifyEvent({ ...ev, signature: { properties: ['transaction'], checksum } }, secret), false, 'propiedad objeto');
  assert.equal(verifyEvent({ ...ev, signature: { properties: ['__proto__.x'], checksum } }, secret), false, 'prototipo');
  assert.equal(verifyEvent({ ...ev, timestamp: '1' }, secret), false);
  assert.equal(verifyEvent(ev, ''), false, 'sin secreto nunca valida');
});

test('URL del checkout y ambiente', () => {
  const u = new URL(checkoutUrl({ publicKey: 'pub_test_x', reference: 'DL-1', amountInCents: 1990000, currency: 'COP', signature: 'abc', redirectUrl: 'https://data-lite.vercel.app/pago', email: 'a@b.co' }));
  assert.equal(u.host, 'checkout.wompi.co');
  assert.equal(u.searchParams.get('amount-in-cents'), '1990000');
  assert.equal(u.searchParams.get('signature:integrity'), 'abc');
  assert.equal(apiBase('pub_test_x'), 'https://sandbox.wompi.co/v1');
  assert.equal(apiBase('pub_prod_x'), 'https://production.wompi.co/v1');
});
