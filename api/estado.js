import { ok, wompiReady } from './_lib/server.js';

/** Estado público del servicio de pagos (sin secretos). */
export default {
  fetch() {
    return ok({ pagos: wompiReady() });
  },
};
