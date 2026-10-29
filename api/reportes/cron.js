import { fail, ok, rpcAdmin } from '../_lib/server.js';
import { runSchedule } from '../_lib/runner.js';

/** Tarea horaria (pg_cron en Supabase): ejecuta las programaciones vencidas. La clave se valida contra Vault. */
export default {
  async fetch(request) {
    if (request.method !== 'POST') return fail('Método no permitido.', 405);
    const key = request.headers.get('x-cron-key') || '';
    if (!/^[0-9a-f]{64}$/.test(key)) return fail('No autorizado.', 401);
    const check = await rpcAdmin('dl_check_cron_key', { p_key: key });
    if (check.data !== true) return fail('No autorizado.', 401);
    const started = Date.now();
    const { data, error } = await rpcAdmin('dl_claim_due_schedules', { p_limit: 15 });
    if (error) { console.error('cron_claim_error', error.code); return fail('No pudimos leer las programaciones.', 500); }
    const due = Array.isArray(data) ? data : [];
    const results = [];
    // De a 3 en paralelo para no pasar el tiempo máximo de la función
    for (let i = 0; i < due.length; i += 3) {
      if (Date.now() - started > 45_000) { console.warn('cron_tiempo', due.length - i); break; }
      results.push(...await Promise.all(due.slice(i, i + 3).map((p) => runSchedule(p).catch(() => ({ status: 'error' })))));
    }
    console.info('cron_ok', due.length, results.map((r) => r.status).join(','));
    return ok({ runs: results.length });
  },
};
