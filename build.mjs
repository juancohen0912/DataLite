// Construye DataLite: empaqueta JS/CSS y genera las páginas HTML + sitemap.
// Uso: node build.mjs   (requiere esbuild, react, react-dom y pptxgenjs instalados: npm install)
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SITE = 'https://data-lite.vercel.app';
const ADSENSE = 'ca-pub-9781408296787253';
const root = dirname(new URL(import.meta.url).pathname);
const out = (p) => join(root, p);

rmSync(out('assets/js'), { recursive: true, force: true });
mkdirSync(out('assets/js'), { recursive: true });

await build({
  entryPoints: [out('src/main.jsx')],
  bundle: true, splitting: true, format: 'esm', minify: true, target: ['es2020'],
  outdir: out('assets/js'), entryNames: 'app', chunkNames: 'chunk-[hash]',
  jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none', logLevel: 'warning',
});
await build({
  entryPoints: [out('src/consent.js')], bundle: true, format: 'iife', minify: true, target: ['es2018'],
  outfile: out('assets/js/consent.js'), logLevel: 'warning',
});
await build({
  entryPoints: [out('src/ms-callback.js')], bundle: true, format: 'iife', minify: true, target: ['es2018'],
  outfile: out('assets/js/ms-callback.js'), logLevel: 'warning',
});
await build({ entryPoints: [out('src/styles.css')], bundle: true, minify: true, outfile: out('assets/styles.css'), logLevel: 'warning' });

const hash = (f) => createHash('sha256').update(readFileSync(out(f))).digest('hex').slice(0, 10);
const V = { css: hash('assets/styles.css'), app: hash('assets/js/app.js'), consent: hash('assets/js/consent.js'),
  mp4: hash('assets/video/demo.mp4'), webm: hash('assets/video/demo.webm'), poster: hash('assets/video/demo-poster.jpg') };

// ---------------- Plantilla ----------------
const header = `
<a class="skip" href="#contenido">Saltar al contenido</a>
<header class="site-head">
  <div class="wrap">
    <a class="brand" href="/" aria-label="DataLite, inicio">
      <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="6" fill="#15231D"/><path d="M8 23V15M14 23V9M20 23V13M26 23v-5" stroke="#F5C542" stroke-width="3" stroke-linecap="round"/><path d="M6 25.5h21" stroke="#0E7A55" stroke-width="2" stroke-linecap="round"/></svg>
      DataLite
    </a>
    <nav class="nav" aria-label="Principal">
      <a href="/#como-funciona">Cómo funciona</a>
      <a href="/guias/" class="nav-keep">Guías</a>
      <a href="/#planes">Planes</a>
      <a class="nav-cta" href="/#herramienta">Crear dashboard</a>
      <span id="account-slot" class="account-slot"></span>
    </nav>
  </div>
</header>`;

const footer = `
<footer class="site-foot">
  <div class="wrap">
    <div class="foot-grid">
      <div>
        <p style="color:#fff;font-weight:800;font-size:18px;margin-bottom:6px">DataLite</p>
        <p>Dashboards a partir de Excel y CSV, directo en tu navegador. Hecho en Bogotá, Colombia.</p>
        <p><a href="https://buymeacoffee.com/jgcohen" rel="noopener" target="_blank">Invítame un café en Buy Me a Coffee</a></p>
      </div>
      <div>
        <h2>Producto</h2>
        <ul><li><a href="/#herramienta">Crear dashboard</a></li><li><a href="/#planes">Planes</a></li><li><a href="/#preguntas">Preguntas frecuentes</a></li></ul>
      </div>
      <div>
        <h2>Aprende</h2>
        <ul>
          <li><a href="/guias/">Todas las guías</a></li>
          <li><a href="/guias/tabla-dinamica-online">Tabla dinámica online</a></li>
          <li><a href="/guias/dashboard-en-excel">Dashboard desde Excel</a></li>
          <li><a href="/guias/alternativa-power-bi-gratis">Alternativa a Power BI</a></li>
        </ul>
      </div>
      <div>
        <h2>Legal</h2>
        <ul>
          <li><a href="/acerca">Acerca de y contacto</a></li>
          <li><a href="/privacidad">Política de privacidad</a></li>
          <li><a href="/cookies">Política de cookies</a></li>
          <li><a href="/terminos">Términos de uso</a></li>
          <li><button type="button" class="linkish" data-open-cookies>Configurar cookies</button></li>
        </ul>
      </div>
    </div>
    <p class="foot-legal">© <span data-year>2026</span> DataLite, creado por Juan Cohen (jgcohen). El análisis de tus archivos ocurre en tu dispositivo; solo los proyectos que guardas con DataLite Pro se almacenan cifrados en la nube. Los resultados son informativos: verifica tus datos antes de tomar decisiones.</p>
  </div>
</footer>`;

function page({ title, description, path, body, schema = [], ogType = 'website', noindex = false, scripts = '' }) {
  const url = SITE + path;
  const ld = schema.map((s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join('\n');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${url}">
${noindex ? '<meta name="robots" content="noindex, follow">' : '<meta name="robots" content="index, follow, max-image-preview:large">'}
<meta name="google-adsense-account" content="${ADSENSE}">
<meta name="theme-color" content="#15231D">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="DataLite">
<meta property="og:locale" content="es_CO">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/assets/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/icon-180.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="/assets/styles.css?v=${V.css}">
${ld}
<script defer src="/assets/js/consent.js?v=${V.consent}"></script>
${scripts}
</head>
<body>
${header}
${body}
${footer}
</body>
</html>
`;
}

// ---------------- Páginas ----------------
const pagesDir = out('src/pages');
// Lista de guías generada automáticamente (las más recientes primero)
const guideCards = readdirSync(join(pagesDir, 'guias')).filter((f) => f.endsWith('.html') && f !== 'index.html').map((f) => {
  const raw = readFileSync(join(pagesDir, 'guias', f), 'utf8');
  const meta = JSON.parse(raw.match(/^<!--\s*([\s\S]*?)\s*-->/)[1]);
  return { slug: f.replace(/\.html$/, ''), h1: meta.h1 || meta.title, description: meta.description, date: meta.article?.published || '' };
}).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const guideListHtml = guideCards.map((g) => `<a class="guide-link" href="/guias/${g.slug}"><h3>${esc(g.h1)}</h3><p>${esc(g.description)}</p></a>`).join('\n      ');
const sitemap = [];
function walk(dir, rel = '') {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.isDirectory()) { walk(join(dir, f.name), `${rel}${f.name}/`); continue; }
    if (!f.name.endsWith('.html')) continue;
    const raw = readFileSync(join(dir, f.name), 'utf8');
    const m = raw.match(/^<!--\s*([\s\S]*?)\s*-->\n?/);
    if (!m) throw new Error(`Falta el encabezado JSON en ${rel}${f.name}`);
    const meta = JSON.parse(m[1]);
    let body = raw.slice(m[0].length).replace(/\{\{v:(\w+)\}\}/g, (_, k) => V[k] || '');
    body = body.replace('<!--LISTA_GUIAS-->', guideListHtml);
    const slug = f.name.replace(/\.html$/, '');
    const path = slug === 'index' ? `/${rel}` : `/${rel}${slug}`;
    const target = out(`${rel}${f.name}`);
    mkdirSync(dirname(target), { recursive: true });
    const scripts = meta.app ? `<script type="module" src="/assets/js/app.js?v=${V.app}"></script>` : '';
    if (meta.article) {
      meta.schema = [...(meta.schema || []), {
        '@context': 'https://schema.org', '@type': 'Article', headline: meta.h1 || meta.title, description: meta.description,
        inLanguage: 'es', datePublished: meta.article.published, dateModified: meta.article.modified || meta.article.published,
        author: { '@type': 'Person', name: 'Juan Cohen', url: `${SITE}/acerca` },
        publisher: { '@type': 'Organization', name: 'DataLite', logo: { '@type': 'ImageObject', url: `${SITE}/assets/icon-512.png` } },
        mainEntityOfPage: SITE + path, image: `${SITE}/assets/og.png`,
      }, {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Guías', item: `${SITE}/guias/` },
          { '@type': 'ListItem', position: 3, name: meta.h1 || meta.title, item: SITE + path },
        ],
      }];
    }
    writeFileSync(target, page({ ...meta, path, body, ogType: meta.article ? 'article' : 'website', scripts }));
    if (!meta.noindex) sitemap.push({ loc: SITE + path, lastmod: meta.article?.modified || meta.article?.published || meta.lastmod || '2026-10-20', priority: path === '/' ? '1.0' : meta.article ? '0.8' : '0.4' });
  }
}
walk(pagesDir);

sitemap.sort((a, b) => b.priority.localeCompare(a.priority) || a.loc.localeCompare(b.loc));
writeFileSync(out('sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemap.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`);
if (!existsSync(out('assets/og.png'))) console.warn('Aviso: falta assets/og.png');
console.log(`Listo: ${sitemap.length} páginas en el sitemap.`, V);
