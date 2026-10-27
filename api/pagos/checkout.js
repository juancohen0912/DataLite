import { env, fail, ok, sameOrigin, wompiReady, getUser, rpcAsUser } from '../_lib/server.js';
import { checkoutUrl, integritySignature } from '../_lib/wompi.js';

/** Crea el intento de pago (el monto sale del catálogo en la base) y devuelve la URL firmada del Web Checkout. */
export default {
  async fetch(request) {
    if (request.method !== 'POST') return fail('Método no permitido.', 405);
    if (!sameOrigin(request)) return fail('Solicitud no permitida.', 403);
    if (!wompiReady()) return fail('El pago en línea aún no está habilitado.', 503);
    let body;
    try { body = await request.json(); } catch { return fail('Solicitud no válida.', 400); }
    if (!body || body.plan !== 'pro') return fail('Plan no válido.', 400);

    const user = await getUser(request);
    if (!user) return fail('Inicia sesión para continuar.', 401);

    const { data, error } = await rpcAsUser(user, 'dl_create_payment', { p_plan: 'pro' });
    if (error || !data) {
      console.error('dl_create_payment_error', error?.code);
      if (error?.hint === 'consent') return fail('Acepta la política de privacidad de DataLite para continuar.', 409);
      return fail('No pudimos iniciar el pago. Intenta de nuevo en unos minutos.', 500);
    }
    const { reference, amount_in_cents: amount, currency } = data;
    const url = checkoutUrl({
      publicKey: env.WOMPI_PUBLIC_KEY, reference, amountInCents: amount, currency,
      signature: integritySignature(reference, amount, currency, env.WOMPI_INTEGRITY_SECRET),
      redirectUrl: `${env.SITE_URL}/pago`, email: user.email,
    });
    return ok({ url });
  },
};
