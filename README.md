# DataLite

Dashboards, gráficos y tablas dinámicas a partir de Excel y CSV, directo en el navegador. Los archivos nunca salen del equipo del usuario.

Sitio: https://data-lite.vercel.app

## Estructura

```
src/main.jsx          App React (carga, tablero, filtros, exportación)
src/lib/data.js       Lectura de archivos, detección de tipos, tabla dinámica
src/lib/Chart.jsx     Gráficos SVG propios (sin Chart.js)
src/lib/exporters.js  PowerPoint (gráficos nativos), PNG, Excel
src/lib/samples.js    Datos de ejemplo
src/consent.js        Banner de cookies, AdSense condicionado al consentimiento, Vercel Analytics
src/styles.css        Estilos
src/pages/            Contenido de cada página (encabezado JSON con título, descripción, schema)
build.mjs             Compila JS/CSS y genera los .html, sitemap.xml
```

Los archivos generados (`index.html`, `guias/*.html`, `assets/`, `sitemap.xml`) se versionan para que Vercel sirva el sitio estático sin paso de compilación.

## Desarrollo

```bash
npm install
npm run bundle      # recompila assets y páginas
npx serve .         # vista local
```

Edita siempre en `src/` y vuelve a ejecutar `npm run bundle`; no edites los .html de la raíz a mano.

## Publicidad

- `ads.txt` ya incluye el ID de editor `pub-9781408296787253`.
- Por defecto se usan anuncios automáticos. Para bloques manuales, crea las unidades en AdSense y pega sus IDs en `AD_SLOTS` dentro de `src/consent.js`.
- AdSense solo se carga si el visitante acepta las cookies publicitarias.

## Seguridad

- Cabeceras HSTS, `X-Frame-Options: DENY`, `nosniff`, `Permissions-Policy` restrictiva y CSP (`object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`).
- La CSP no restringe orígenes de scripts porque AdSense no es compatible con listas de dominios permitidos; los scripts propios se sirven desde el mismo dominio.
- Límite de 30 MB y 300.000 filas por archivo. El lector de Excel (SheetJS 0.20.3, versión con parches de seguridad) se carga solo cuando se abre un .xlsx.
