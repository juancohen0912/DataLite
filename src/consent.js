// Consentimiento de cookies + carga condicional de Google AdSense + analítica sin cookies.
// Configura aquí tus bloques de anuncios manuales (opcional). Si quedan vacíos, se usan los anuncios automáticos.
const ADSENSE_CLIENT = 'ca-pub-9781408296787253';
const AD_SLOTS = {
  dashboard: '', // p. ej. '1234567890' (ID del bloque de anuncios en AdSense)
  landing: '',
  article: '',
};

const KEY = 'dl-consent-v1';
let adsLoaded = false;

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function save(ads) {
  try { localStorage.setItem(KEY, JSON.stringify({ ads, ts: new Date().toISOString() })); } catch { /* almacenamiento bloqueado */ }
}

function loadAds() {
  if (adsLoaded) return;
  adsLoaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
  s.crossOrigin = 'anonymous';
  document.head.appendChild(s);
  document.querySelectorAll('.ad-slot').forEach(fill);
}

function fill(el) {
  if (!el || !adsLoaded || el.dataset.filled) return;
  const slot = AD_SLOTS[el.dataset.slot];
  if (!slot) return; // sin bloque manual: AdSense coloca anuncios automáticos
  el.dataset.filled = '1';
  el.classList.add('is-on');
  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.dataset.adClient = ADSENSE_CLIENT;
  ins.dataset.adSlot = slot;
  ins.dataset.adFormat = 'auto';
  ins.dataset.fullWidthResponsive = 'true';
  const label = document.createElement('span');
  label.className = 'ad-label';
  label.textContent = 'Publicidad';
  el.append(label, ins);
  (window.adsbygoogle = window.adsbygoogle || []).push({});
}

function banner() {
  if (document.getElementById('cookie-banner')) return;
  const el = document.createElement('div');
  el.id = 'cookie-banner';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-label', 'Preferencias de cookies');
  el.innerHTML = `
    <p>Usamos cookies de Google AdSense para mostrar publicidad que mantiene DataLite gratis. Tus archivos nunca salen de tu navegador.
    <a href="/cookies">Política de cookies</a>.</p>
    <div class="cb-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-c="no">Solo necesarias</button>
      <button type="button" class="btn btn-primary btn-sm" data-c="yes">Aceptar</button>
    </div>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-c]');
    if (!b) return;
    const ok = b.dataset.c === 'yes';
    save(ok);
    el.remove();
    if (ok) loadAds();
    else if (adsLoaded) location.reload(); // retirar anuncios ya cargados
  });
  document.body.appendChild(el);
}

function analytics() {
  // Vercel Web Analytics: no usa cookies ni guarda datos personales. Actívalo en el panel de Vercel.
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  const s = document.createElement('script');
  s.defer = true;
  s.src = '/_vercel/insights/script.js';
  document.head.appendChild(s);
}

window.DataLiteAds = { fill, open: banner };

function init() {
  analytics();
  const c = read();
  if (c === null) banner();
  else if (c.ads) loadAds();
  document.querySelectorAll('[data-open-cookies]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); banner(); }));
  // Año del pie de página
  document.querySelectorAll('[data-year]').forEach((n) => { n.textContent = new Date().getFullYear(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
