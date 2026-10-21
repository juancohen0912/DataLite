# Política de seguridad

## Cómo reportar una vulnerabilidad

Si encuentras un problema de seguridad en DataLite (https://data-lite.vercel.app), repórtalo de forma privada en
[GitHub Security Advisories](https://github.com/juancohen0912/DataLite/security/advisories/new)
o escríbeme por [LinkedIn](https://www.linkedin.com/in/juan-cohen-91b175b0). No abras un issue público.

Incluye la URL afectada, los pasos para reproducirlo y el impacto que observaste. Responderé en un plazo de 5 días hábiles.

## Alcance

- El sitio data-lite.vercel.app y el código de este repositorio.
- Fuera de alcance: anuncios de Google AdSense, la infraestructura de Vercel y ataques de denegación de servicio.

## Diseño de seguridad

- Los archivos de los usuarios se procesan solo en su navegador; no hay servidor que reciba datos.
- La app no ejecuta código de servidores externos: React, JSZip y PptxGenJS se empaquetan en el propio sitio.
- Política de seguridad de contenido (CSP) con lista blanca, `frame-ancestors 'none'`, `object-src 'none'`, HSTS con preload y `Permissions-Policy` restrictiva (ver `vercel.json`).
- Límites de tamaño y protección contra archivos comprimidos maliciosos al leer Excel.
- Las exportaciones a Excel guardan los textos como texto, así que no se pueden ejecutar fórmulas inyectadas.
- La rama `main` está protegida contra reescritura y borrado; GitHub escanea secretos y avisa de dependencias vulnerables.
