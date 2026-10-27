import { env, wompiReady, rpcAdmin } from '../_lib/server.js';
import { verifyEvent } from '../_lib/wompi.js';

const empty = (status) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Eventos de Wompi. Si el comercio es el mismo de Custodia IA, el webhook de Custodia reenvía aquí los pagos «DL-».
 * Solo se acepta un evento con checksum válido; el monto y la moneda se vuelven a comparar en la base.
 */
export default {
  async fetch(request) {
    if (request.method !== 'POST') return empty(405);
    if (!wompiReady()) return empty(503); // Wompi reintentará
    const raw = await request.text();
    if (raw.length > 50_000) return empty(413);
    let event;
    try { event = JSON.parse(raw); } catch { return empty(400); }
    if (!verifyEvent(event, env.WOMPI_EVENTS_SECRET, request.headers.get('x-event-checksum'))) {
      console.warn('wompi_event_rechazado');
      return empty(401);
    }
    const tx = event.data?.transaction;
    if (event.event !== 'transaction.updated' || !tx || !String(tx.reference ?? '').startsWith('DL-')) return empty(200);
    const { data, error } = await rpcAdmin('dl_apply_payment', {
      p_reference: tx.reference, p_transaction_id: tx.id, p_status: tx.status, p_amount_in_cents: tx.amount_in_cents, p_currency: tx.currency,
    });
    if (error) { console.error('dl_apply_payment_error', error.code); return empty(500); }
    console.info('wompi_evento', data);
    return empty(200);
  },
};
