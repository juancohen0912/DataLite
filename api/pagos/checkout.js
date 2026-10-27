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
    if (!body || !['pro', 'empresa'].includes(body.plan)) return fail('Plan no válido.', 400);
    const args = { p_plan: body.plan };
    if (body.plan === 'empresa') {
      const seats = Number(body.seats);
      if (!Number.isInteger(seats) || seats < 5 || seats > 20) return fail('El plan Empresa es de 5 a 20 usuarios.', 400);
      args.p_seats = seats;
      if (typeof body.orgName === 'string' && body.orgName.trim()) args.p_org_name = body.orgName.trim().slice(0, 120);
    }

    const user = await getUser(request);
    if (!user) return fail('Inicia sesión para continuar.', 401);

    const { data, error } = await rpcAsUser(user, 'dl_create_payment', args);
    if (error || !data) {
      console.error('dl_create_payment_error', error?.code);
      if (error?.hint === 'consent') return fail('Acepta la política de privacidad de DataLite para continuar.', 409);
      // Mensajes de validación de la base (cupos, nombre, permisos): se muestran tal cual
      if (error?.code === 'P0001' && error.message) return fail(error.message, 422);
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
