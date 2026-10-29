// Alertas por WhatsApp (preparado para una siguiente fase, apagado por defecto).
// Usa la API oficial de WhatsApp Business (Meta Cloud API) con una plantilla aprobada.
// Para activarlo: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID y WHATSAPP_TEMPLATE en Vercel (ver README, sección WhatsApp).
const cfg = () => ({
  token: process.env.WHATSAPP_TOKEN || '',
  phoneId: process.env.WHATSAPP_PHONE_ID || '',
  template: process.env.WHATSAPP_TEMPLATE || 'datalite_alerta',
  lang: process.env.WHATSAPP_LANG || 'es',
});
export const whatsappReady = () => { const c = cfg(); return Boolean(c.token && /^\d{5,20}$/.test(c.phoneId)); };

// Números en formato internacional E.164 sin «+» (Colombia: 57 + 10 dígitos)
export const normalizePhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return /^\d{8,15}$/.test(d) ? d : null; };
const param = (t) => ({ type: 'text', text: String(t ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').slice(0, 300) });

/**
 * Envía la alerta con la plantilla: {{1}} nombre de la alerta, {{2}} proyecto, {{3}} valor, {{4}} enlace.
 * Devuelve { sent, skipped } sin lanzar errores: el correo sigue siendo el canal principal.
 */
export async function sendWhatsappAlert(phones, { alertName, projectName, valueText, link }) {
  if (!whatsappReady()) return { sent: 0, skipped: 'disabled' };
  const c = cfg();
  let sent = 0;
  for (const to of (phones || []).map(normalizePhone).filter(Boolean).slice(0, 5)) {
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${c.phoneId}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template',
          template: { name: c.template, language: { code: c.lang }, components: [{ type: 'body', parameters: [param(alertName), param(projectName), param(valueText), param(link)] }] } }),
      });
      if (res.ok) sent++; else console.error('whatsapp_error', res.status);
    } catch (e) { console.error('whatsapp_error', e.name); }
  }
  return { sent };
}
