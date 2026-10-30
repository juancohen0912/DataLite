// Correos de pruebas asignadas por el administrador (asignar, prorrogar, recortar, terminar).
import { esc } from './smtp.js';

const fmt = (iso) => new Date(iso).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', year: 'numeric' });

export function trialEmail({ action, kind, endsAt, active, org, link }) {
  const plan = kind === 'empresa' ? 'DataLite Empresa' : 'DataLite Pro';
  const fecha = fmt(endsAt);
  const orgTxt = kind === 'empresa' && org ? ` para «${org.name}» con ${org.seats} cupos` : '';
  let subject, title, body;
  if (action === 'terminar' || !active) {
    subject = `Tu prueba de ${plan} terminó`;
    title = 'Tu prueba terminó';
    body = `Tu prueba gratuita de ${plan}${orgTxt} terminó el ${fecha}. No se te cobrará nada. Tus proyectos siguen guardados en modo de solo lectura: si quieres seguir editándolos, puedes activar el plan cuando quieras.`;
  } else if (action === 'prorrogar') {
    subject = `Extendimos tu prueba de ${plan}`;
    title = '¡Tienes más días!';
    body = `Extendimos tu prueba gratuita de ${plan}${orgTxt}. Ahora vence el ${fecha}.`;
  } else if (action === 'recortar') {
    subject = `Cambió la fecha de tu prueba de ${plan}`;
    title = 'Nueva fecha de tu prueba';
    body = `Tu prueba gratuita de ${plan}${orgTxt} ahora vence el ${fecha}.`;
  } else {
    subject = `Te activamos ${plan} gratis hasta el ${fecha}`;
    title = `Ya tienes ${plan}`;
    body = kind === 'empresa'
      ? `Te activamos una prueba gratuita de ${plan}${orgTxt}, hasta el ${fecha}. Eres la persona administradora: desde tu cuenta, en «Mi empresa», puedes invitar a tu equipo por correo.`
      : `Te activamos una prueba gratuita de ${plan} hasta el ${fecha}: proyectos guardados en la nube, compartir tableros, conexión con Google Sheets y Excel en línea, reportes programados y alertas.`;
  }
  const extra = action === 'terminar' || !active ? '' : ' No necesitas registrar tarjeta ni medios de pago, y al terminar no hay cobros automáticos.';
  const text = `${title}\n\n${body}${extra}\n\nEntra a DataLite con este mismo correo: ${link}\n\n— DataLite · data-lite.vercel.app`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f7f5">
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;color:#15231d">
  <p style="font-size:20px;font-weight:bold;margin:0 0 18px">DataLite</p>
  <div style="background:#ffffff;border:1px solid #dce3e0;border-radius:12px;padding:24px">
    <p style="font-size:22px;font-weight:bold;line-height:1.25;margin:0 0 12px">${esc(title)}</p>
    <p style="font-size:15px;line-height:1.55;margin:0 0 10px">${esc(body)}</p>
    ${extra ? `<p style="font-size:14px;line-height:1.5;margin:0 0 18px;color:#5b6b64">${esc(extra.trim())}</p>` : ''}
    <p style="margin:18px 0 0"><a href="${esc(link)}" style="display:inline-block;background:#0e7a55;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:6px">Abrir DataLite</a></p>
  </div>
  <p style="font-size:12px;line-height:1.5;color:#8a9a93;margin:16px 4px 0">Recibes este correo porque el equipo de DataLite gestionó una prueba en tu cuenta. Si no esperabas este mensaje, ignóralo.</p>
</div></body></html>`;
  return { subject, text, html };
}
