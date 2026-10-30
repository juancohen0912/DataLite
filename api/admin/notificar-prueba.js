import { env, fail, ok, sameOrigin, getUser, rpcAsUser } from '../_lib/server.js';
import { sendMail, buildMessage, isSafeEmail } from '../_lib/smtp.js';
import { trialEmail } from '../_lib/trial-email.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['asignar', 'prorrogar', 'recortar', 'terminar']);
const smtp = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  fromName: process.env.SMTP_FROM_NAME || 'DataLite',
};

/** Avisa a la persona sobre su prueba. La base valida que quien llama es administrador y entrega destinatario y fechas. */
export default {
  async fetch(request) {
    if (request.method !== 'POST') return fail('Método no permitido.', 405);
    if (!sameOrigin(request)) return fail('Solicitud no permitida.', 403);
    if (!(smtp.user && smtp.pass && isSafeEmail(smtp.user))) return fail('El correo no está configurado.', 503);
    let body;
    try { body = await request.json(); } catch { return fail('Solicitud no válida.', 400); }
    const id = String(body?.id || ''), action = String(body?.action || '');
    if (!UUID.test(id) || !ACTIONS.has(action)) return fail('Solicitud no válida.', 400);
    const user = await getUser(request);
    if (!user) return fail('Inicia sesión para continuar.', 401);
    const { data, error } = await rpcAsUser(user, 'dl_admin_claim_grant_mail', { p_id: id });
    if (error) return fail(error.code === '42501' ? 'No autorizado.' : 'No pudimos preparar el aviso.', error.code === '42501' ? 403 : 400);
    if (!data) return ok({ sent: false, reason: 'reciente' });
    if (!isSafeEmail(data.email)) return fail('Correo no válido.', 400);
    const mail = trialEmail({ action, kind: data.kind, endsAt: data.ends_at, active: data.active, org: data.org, link: `${env.SITE_URL}/` });
    try {
      await sendMail(smtp, { from: smtp.user, to: data.email, data: buildMessage({ fromName: smtp.fromName, fromEmail: smtp.user, to: data.email, ...mail }) });
      console.info('prueba_aviso_enviado', action);
      return ok({ sent: true });
    } catch (e) {
      console.error('prueba_aviso_error', e.code || e.message);
      return fail('No pudimos enviar el correo.', 502);
    }
  },
};
