import { rpcAdmin, env } from '../_lib/server.js';
import { encrypt } from '../_lib/crypto.js';
import { readState, exchangeCode, flowNonce, clearFlowCookie } from '../_lib/oauth.js';

const back = (result, provider) => new Response(null, {
  status: 303,
  headers: { Location: `${env.SITE_URL}/conectar/listo?r=${result}${provider ? `&p=${provider}` : ''}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Set-Cookie': clearFlowCookie() },
});

/** Retorno de Google o Microsoft: canjea el código y guarda el permiso cifrado. El navegador nunca lo ve. */
export default {
  async fetch(request) {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    const q = new URL(request.url).searchParams;
    const st = readState(q.get('state'));
    if (!st) return back('estado');
    // El permiso solo se guarda si lo completa el mismo navegador que lo pidió
    if (flowNonce(request) !== st.n) return back('estado', st.p);
    if (q.get('error')) return back(q.get('error') === 'access_denied' ? 'negado' : 'error', st.p);
    const code = q.get('code');
    if (!code || code.length > 4000) return back('error', st.p);
    try {
      const t = await exchangeCode(st.p, code, st);
      const { error } = await rpcAdmin('dl_store_connection', { p_user: st.u, p_provider: st.p, p_account: t.account || '', p_token: encrypt(t.refresh) });
      if (error) { console.error('conexion_guardar_error', error.code); return back('error', st.p); }
      console.info('conexion_ok', st.p);
      return back('ok', st.p);
    } catch (e) {
      console.error('conexion_error', st.p, e.code || e.message);
      return back(e.code === 'no_refresh' ? 'sinpermiso' : 'error', st.p);
    }
  },
};
