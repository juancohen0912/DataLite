# DataLite

Dashboards, gráficos y tablas dinámicas a partir de Excel y CSV, directo en el navegador. El análisis ocurre en el equipo del usuario; solo los proyectos que se guardan con DataLite Pro se suben a la nube.

Sitio: https://data-lite.vercel.app

## Estructura

```
src/main.jsx          App React: carga, cuenta, proyectos, puertas de Pro
src/app/              Tablero tipo Power BI (Dashboard, panel de visuales, fórmulas, filtros) y ventanas de la nube
src/lib/data.js       Lectura de archivos, detección de tipos, tabla dinámica, filtros
src/lib/formula.js    Intérprete de fórmulas tipo Excel (sin eval): columnas, medidas y funciones propias
src/lib/model.js      Modelo de datos: aplica columnas calculadas, medidas y funciones del usuario
src/lib/Chart.jsx     Gráficos SVG propios (sin Chart.js); Visuals.jsx: treemap, combinado, dispersión, medidor, KPI, matriz
src/lib/exporters.js  PowerPoint (gráficos nativos), PNG, Excel de varias hojas
src/lib/cloud.js      Cliente Supabase sin dependencias: enlace al correo (PKCE), RPC, Storage, pagos
src/config.js         URL y clave publicable de Supabase (públicas por diseño)
api/                  Funciones de Vercel: checkout, confirmación y webhook de Wompi
supabase/migrations/  Esquema, RLS y funciones de la base de datos
tests/                Pruebas unitarias (node --test tests/*.test.mjs)
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

- Cabeceras HSTS, `X-Frame-Options: DENY`, `nosniff`, `Permissions-Policy` restrictiva, CORS limitado al propio dominio y CSP con lista blanca: scripts solo del propio dominio y de Google AdSense (ver `vercel.json`). Si AdSense agrega un dominio nuevo, revisa la consola del navegador y súmalo a la CSP.
- Sesiones con enlace de un solo uso y PKCE; RLS en todas las tablas; la clave `service_role` y los secretos de Wompi solo existen en el servidor.
- Límite de 30 MB y 300.000 filas por archivo, y protección contra archivos comprimidos maliciosos (zip bombs).
- El lector y escritor de Excel es propio (`src/lib/xlsx.js`, con JSZip empaquetado): la app no ejecuta código de servidores externos. Los .xls antiguos no se leen; se pide guardarlos como .xlsx.

## DataLite Pro (pagos y nube)

- Base de datos: proyecto Supabase `dwluwzeqexgihihauuos` (esquema en `supabase/migrations/`). Todo pasa por funciones `SECURITY DEFINER` con permisos validados; las tablas no se pueden leer ni escribir directo desde el navegador. Los datos de cada proyecto van comprimidos en el bucket privado `datalite/<id>/data.bin`.
- Permisos: dueño (Pro), editor (solo si el dueño lo autorizó y su plan está activo) y lector (gratis, puede pedir permiso de edición).
- Pagos con Wompi, igual que en custodia-ia: firma de integridad en el servidor, monto tomado del catálogo de la base, eventos verificados con checksum, aplicación idempotente. Periodos de 30 días sin renovación automática.
- El comercio de Wompi es el mismo de Custodia IA, que tiene la única URL de eventos: su webhook reenvía las referencias `DL-` a `/api/pagos/webhook` de DataLite. Además, la página `/pago` confirma la transacción al volver del checkout.
- Variables de entorno en Vercel: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (sensible), `WOMPI_PUBLIC_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTS_SECRET`, `SITE_URL`. Sin ellas, el botón de pago muestra «se habilita en los próximos días» y nada se rompe.
- Activación manual (soporte): `select public.dl_admin_activate_plan('correo@ejemplo.com');` con la cuenta de administrador.

## Agente de contenido semanal

Una tarea programada toma cada semana el primer tema pendiente de `content-plan.md`, escribe la guía en `src/pages/guias/`, recompila y abre un pull request con un post sugerido para LinkedIn y otro para X. Para publicar, revisa el PR y haz merge. El índice de guías y el sitemap se actualizan solos.

Los artículos pueden enlazar a la herramienta con un ejemplo ya cargado: `/?ejemplo=ventas`, `/?ejemplo=produccion` o `/?ejemplo=gastos`.
