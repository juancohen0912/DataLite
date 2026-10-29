import { fail, ok, sameOrigin, getUser, rpcAsUser } from '../_lib/server.js';
import { cryptoReady, nonce } from '../_lib/crypto.js';
import { authorizeUrl, providerReady, PROVIDERS, flowCookie } from '../_lib/oauth.js';

/** Devuelve la URL oficial de Google o Microsoft para dar permiso permanente de lectura (solo Pro y Empresa). */
export default {
  async fetch(request) {
    if (request.method !== 'POST') return fail('Método no permitido.', 405);
    if (!sameOrigin(request)) return fail('Solicitud no permitida.', 403);
    let body;
    try { body = await request.json(); } catch { return fail('Solicitud no válida.', 400); }
    const provider = String(body?.provider || '');
    if (!Object.hasOwn(PROVIDERS, provider)) return fail('Proveedor no válido.', 400);
    if (!providerReady(provider) || !cryptoReady()) return fail('La actualización automática aún no está habilitada.', 503);
    const user = await getUser(request);
    if (!user) return fail('Inicia sesión para continuar.', 401);
    const { data } = await rpcAsUser(user, 'dl_account_status', {});
    if (!data?.pro) return fail('La actualización automática es del plan Pro o Empresa.', 402);
    const n = nonce();
    const res = ok({ url: authorizeUrl(provider, user.id, n) });
    res.headers.append('Set-Cookie', flowCookie(n));
    return res;
  },
};
