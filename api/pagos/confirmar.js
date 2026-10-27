import { env, fail, ok, wompiReady, getUser, rpcAdmin, paymentOfUser } from '../_lib/server.js';
import { fetchTransaction } from '../_lib/wompi.js';

/**
 * Página de retorno: consulta la transacción a Wompi (no confía en la URL) y, si el pago es del usuario,
 * lo aplica. El webhook hace lo mismo; la función de la base es idempotente.
 */
export default {
  async fetch(request) {
    if (request.method !== 'GET') return fail('Método no permitido.', 405);
    if (!wompiReady()) return fail('El pago en línea aún no está habilitado.', 503);
    const id = new URL(request.url).searchParams.get('id') || '';
    const user = await getUser(request);
    if (!user) return fail('Inicia sesión para continuar.', 401);

    const tx = await fetchTransaction(env.WOMPI_PUBLIC_KEY, id);
    if (!tx) return fail('No encontramos esa transacción en Wompi.', 404);
    if (!String(tx.reference || '').startsWith('DL-')) return fail('Esta transacción no es de DataLite.', 400);

    const pay = await paymentOfUser(user, tx.reference);
    if (!pay) return fail('Esta transacción no corresponde a tu cuenta.', 403);

    if (['APPROVED', 'DECLINED', 'VOIDED', 'ERROR'].includes(tx.status)) {
      const { error } = await rpcAdmin('dl_apply_payment', {
        p_reference: tx.reference, p_transaction_id: tx.id, p_status: tx.status, p_amount_in_cents: tx.amount_in_cents, p_currency: tx.currency,
      });
      if (error) console.error('dl_apply_payment_error', error.code);
    }
    return ok({ status: tx.status, plan: pay.plan_id });
  },
};
