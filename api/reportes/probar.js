import { fail, ok, sameOrigin, getUser, rpcAdmin } from '../_lib/server.js';
import { runSchedule } from '../_lib/runner.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** «Enviar ahora»: el dueño prueba su reporte o alerta (máximo una vez cada 5 minutos). */
export default {
  async fetch(request) {
    if (request.method !== 'POST') return fail('Método no permitido.', 405);
    if (!sameOrigin(request)) return fail('Solicitud no permitida.', 403);
    let body;
    try { body = await request.json(); } catch { return fail('Solicitud no válida.', 400); }
    const id = String(body?.id || '');
    if (!UUID.test(id)) return fail('Solicitud no válida.', 400);
    const user = await getUser(request);
    if (!user) return fail('Inicia sesión para continuar.', 401);
    const { data, error } = await rpcAdmin('dl_claim_test', { p_user: user.id, p_id: id });
    if (error) return fail(error.code === 'P0001' && error.message ? error.message : 'No pudimos enviar la prueba.', error.hint === 'limit' ? 429 : 400);
    const r = await runSchedule(data, { test: true });
    return ok(r);
  },
};
