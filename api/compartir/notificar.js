import { env, fail, ok, sameOrigin, getUser, rpcAsUser } from '../_lib/server.js';
import { sendMail, buildMessage, inviteEmail, isSafeEmail } from '../_lib/smtp.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const smtp = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  fromName: process.env.SMTP_FROM_NAME || 'DataLite',
};
const smtpReady = () => Boolean(smtp.user && smtp.pass && isSafeEmail(smtp.user) && env.SUPABASE_URL && env.SUPABASE_ANON_KEY);

/** Avisa por correo a una persona invitada a un proyecto. La base decide si se puede enviar (dueño, invitado, límites). */
export default {
  async fetch(request) {
    if (request.method !== 'POST') return fail('Método no permitido.', 405);
    if (!sameOrigin(request)) return fail('Solicitud no permitida.', 403);
    if (!smtpReady()) return fail('El aviso por correo aún no está habilitado.', 503);
    let body;
    try { body = await request.json(); } catch { return fail('Solicitud no válida.', 400); }
    const projectId = String(body?.projectId || '');
    const email = String(body?.email || '').trim().toLowerCase();
    if (!UUID.test(projectId) || !isSafeEmail(email)) return fail('Solicitud no válida.', 400);

    const user = await getUser(request);
    if (!user) return fail('Inicia sesión para continuar.', 401);

    const { data, error } = await rpcAsUser(user, 'dl_claim_invite_email', { p_id: projectId, p_email: email });
    if (error) return fail(error.code === 'P0001' && error.message ? error.message : 'No pudimos enviar el aviso.', error.hint === 'limit' ? 429 : 400);
    if (!data?.send) return ok({ sent: false, reason: data?.reason || 'skip' });

    const link = `${env.SITE_URL}/?p=${data.project_id}`;
    const mail = inviteEmail({ ownerEmail: data.owner_email, projectName: data.project_name, role: data.role, link });
    try {
      const msg = buildMessage({ fromName: smtp.fromName, fromEmail: smtp.user, to: email, replyTo: isSafeEmail(data.owner_email) ? data.owner_email : undefined, ...mail });
      await sendMail(smtp, { from: smtp.user, to: email, data: msg });
      console.info('invitacion_enviada');
      return ok({ sent: true });
    } catch (e) {
      console.error('invitacion_error', e.code || e.message, e.response || '');
      await rpcAsUser(user, 'dl_release_invite_email', { p_claim: data.claim }).catch(() => null);
      return fail('No pudimos enviar el correo. Copia el enlace y envíaselo tú.', 502);
    }
  },
};
