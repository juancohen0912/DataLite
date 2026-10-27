// Ayudas del servidor: variables de entorno, respuestas y acceso a Supabase. Los secretos nunca salen de aquí.
export const env = {
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  WOMPI_PUBLIC_KEY: process.env.WOMPI_PUBLIC_KEY || '',
  WOMPI_INTEGRITY_SECRET: process.env.WOMPI_INTEGRITY_SECRET || '',
  WOMPI_EVENTS_SECRET: process.env.WOMPI_EVENTS_SECRET || '',
  SITE_URL: process.env.SITE_URL || 'https://data-lite.vercel.app',
};
export const wompiReady = () => Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY && env.WOMPI_PUBLIC_KEY && env.WOMPI_INTEGRITY_SECRET && env.WOMPI_EVENTS_SECRET);

const NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
export const ok = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: NO_STORE });
/** Error sin detalles internos (los detalles quedan en el log del servidor). */
export const fail = (message, status) => new Response(JSON.stringify({ error: message }), { status, headers: NO_STORE });

/** Defensa CSRF: solo se aceptan escrituras desde el propio sitio. */
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).host === new URL(request.url).host || new URL(origin).origin === new URL(env.SITE_URL).origin; } catch { return false; }
}

const bearer = (request) => { const h = request.headers.get('authorization') || ''; const m = /^Bearer ([A-Za-z0-9._-]{20,4000})$/.exec(h); return m ? m[1] : null; };

/** Valida la sesión contra Supabase (no solo decodifica el token). */
export async function getUser(request) {
  const token = bearer(request);
  if (!token) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const user = await res.json();
  return user?.id ? { ...user, token } : null;
}

async function rpc(fn, args, key, token) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) return { error: { status: res.status, code: data?.code, message: data?.message, hint: data?.hint } };
  return { data };
}
/** Llamada con los permisos del usuario (RLS aplica). */
export const rpcAsUser = (user, fn, args) => rpc(fn, args, env.SUPABASE_ANON_KEY, user.token);
/** Llamada privilegiada: solo para aplicar pagos ya verificados con Wompi. */
export const rpcAdmin = (fn, args) => rpc(fn, args, env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_SERVICE_ROLE_KEY);

/** Lee el pago con los permisos del usuario: solo devuelve filas suyas. */
export async function paymentOfUser(user, reference) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/dl_payments?select=reference,plan_id&reference=eq.${encodeURIComponent(reference)}`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${user.token}` }, signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0] ?? null;
}
