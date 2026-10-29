import { fail, ok, rpcAdmin } from '../_lib/server.js';
import { verify } from '../_lib/crypto.js';
import { isSafeEmail } from '../_lib/smtp.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Darse de baja de un reporte o alerta. Lo usa la página /reportes/baja y el botón de baja
 * en un clic de Gmail y Outlook (List-Unsubscribe-Post). El enlace va firmado: solo sirve para ese correo.
 */
export default {
  async fetch(request) {
    if (request.method !== 'POST') return fail('Método no permitido.', 405);
    const q = new URL(request.url).searchParams;
    let s = q.get('s'), e = q.get('e'), t = q.get('t'), all = false;
    if (!s) {
      try { const b = await request.json(); s = b?.s; e = b?.e; t = b?.t; all = b?.all === true; } catch { return fail('Solicitud no válida.', 400); }
    }
    s = String(s || ''); e = String(e || '').toLowerCase();
    if (!UUID.test(s) || !isSafeEmail(e) || !verify('baja', `${s}|${e}`, t)) return fail('El enlace no es válido.', 400);
    const { error } = await rpcAdmin('dl_unsubscribe', { p_schedule: s, p_email: e, p_all: all });
    if (error) return fail('No pudimos procesar la baja. Intenta de nuevo.', 500);
    console.info('baja_ok', all ? 'todo' : 'uno');
    return ok({ done: true });
  },
};
