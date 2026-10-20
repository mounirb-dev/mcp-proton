# Proton MCP

Servidor MCP (HTTP + OAuth 2.1) que deja a Claude **leer y enviar correos de cuentas gratuitas de Proton Mail**.
Las cuentas gratis no tienen IMAP/SMTP ni Bridge, así que el servidor maneja un **Chromium headless (Playwright)**
que inicia sesión en `mail.proton.me`. El navegador es *serverless*: se lanza bajo demanda por cuenta y se cierra tras
`BROWSER_IDLE_MS` sin uso.

Stack: Bun (instalación/build) · Next.js 16 · React 19 · JSX · Playwright.

## Herramientas MCP

| Tool | Qué hace |
|---|---|
| `proton_list_accounts` | Cuentas configuradas y estado de sesión |
| `proton_list_emails` | Lista una carpeta (inbox, sent, drafts, archive, spam, trash, starred, all) |
| `proton_search_emails` | Búsqueda por palabra clave |
| `proton_read_email` | Lee un correo/conversación por id |
| `proton_send_email` | Envía texto plano (to/cc/bcc, asunto, cuerpo) |
| `proton_cached_emails` | Búsqueda de texto completo en los correos ya guardados en PostgreSQL (sin abrir navegador) |
| `proton_screenshot` | Captura del navegador para diagnosticar captcha/2FA/cambios de UI |

Varias cuentas: cada una tiene su perfil de navegador persistente (`/data/profiles/<id>`); el parámetro `account`
acepta email, etiqueta o id (opcional si hay una sola).

## Almacén de correos (PostgreSQL)

Igual que OpenWA guarda en SQLite lo que scrapea, cada correo listado, buscado o leído se guarda en el contenedor `postgres` (tabla `emails`, índice de texto completo). El panel tiene **Sincronizar** por cuenta y la página **/emails** para buscar; Claude puede usar `proton_cached_emails`. Sin `DATABASE_URL` la función se desactiva sin afectar al resto. Al eliminar una cuenta se borran sus correos.

## Autenticación (Better Auth)

Todo el acceso pasa por [Better Auth](https://better-auth.com) usando solo su SDK y sus plugins oficiales:

| Pieza | Plugin | Para qué |
|---|---|---|
| Login del panel | `emailAndPassword` | Un único administrador (`ADMIN_EMAIL` / `ADMIN_PASSWORD`), creado en el primer arranque; el registro público queda bloqueado |
| Claude y otros clientes MCP | `@better-auth/mcp` + `jwt` | OAuth 2.1 con registro dinámico, PKCE y pantalla de consentimiento (`/consent`) |
| Clientes sin OAuth (Claude Code, scripts) | `@better-auth/api-key` | API key `pmcp_…` en `x-api-key` o `Authorization: Bearer`, creada y revocada desde el panel |

Las tablas (`user`, `session`, `apikey`, `oauth*`, `jwks`) se migran solas al arrancar y viven en PostgreSQL.
Cambiar `ADMIN_PASSWORD` después del primer arranque no modifica la contraseña ya creada. Los clientes que se registran con
`localhost` deben declararse `application_type: native`; los web exigen https.

## Sincronización automática

El servidor sincroniza solo, en segundo plano (`SYNC_INTERVAL_MIN`, 15 min por defecto; `0` la desactiva). En cada ciclo y
por cada cuenta con sesión activa:

- lista las carpetas `inbox` y `sent` por la API de Proton (~2 s) y guarda los metadatos nuevos en PostgreSQL;
- descarga el cuerpo de hasta `SYNC_MAX_BODIES` (15) correos de la bandeja que aún no estén guardados.

La primera vez que se sincroniza una cuenta trae hasta 3 000 correos por carpeta; después solo los `SYNC_RECENT_LIMIT` (300)
más recientes. Cada cuenta tiene un interruptor **Automática** en el panel, junto a la fecha y el resultado de la última
sincronización. Nunca sincroniza cuentas en estado de error, 2FA o captcha, para no repetir logins fallidos contra Proton.
Cada ciclo abre el navegador unos segundos (~0,8 GB de RAM) y lo cierra a los `BROWSER_IDLE_MS`; en un VPS pequeño sube el
intervalo (p. ej. 60) o desactívala.

## Despliegue en Dokploy

1. Sube este directorio a un repo Git (GitHub/Gitea…).
2. Dokploy → **Create Service → Compose** → tu repo, *Compose Path* `./docker-compose.yml`.
   (También vale una *Application* con build type *Dockerfile*, puerto 3000 y un volumen montado en `/data`.)
3. Pestaña **Environment**:
   ```
   ADMIN_EMAIL=tu@correo.com
   ADMIN_PASSWORD=<mín. 8 caracteres>
   SECRET_KEY=<openssl rand -hex 32>
   POSTGRES_PASSWORD=<openssl rand -hex 16>
   PUBLIC_URL=https://proton-mcp.tudominio.com
   ```
4. Pestaña **Domains**: tu dominio → servicio `proton-mcp`, puerto `3000`, HTTPS (Let's Encrypt).
5. Deploy. Abre la URL, entra con `ADMIN_PASSWORD`, añade tu cuenta de Proton y pulsa **Probar login**.

> El volumen `proton-data` guarda `state.json` (cuentas cifradas, clientes/tokens OAuth hasheados) y los perfiles del
> navegador. Si lo pierdes, hay que volver a iniciar sesión y reconectar Claude. Si cambias `SECRET_KEY`, las
> credenciales guardadas dejan de descifrarse.

## Conectar con Claude

Claude → Ajustes → Conectores → **Añadir conector personalizado** → pega `https://TU-DOMINIO/mcp`.
Claude descubre el OAuth solo (`/.well-known/oauth-protected-resource`, registro dinámico, PKCE S256); en la pantalla de
autorización introduce `ADMIN_PASSWORD` y pulsa **Permitir**. Claude Code:

```bash
claude mcp add --transport http proton https://TU-DOMINIO/mcp
```

## Desarrollo local

```bash
bun install
bunx playwright-core install chromium   # solo la primera vez
cp .env.example .env.local              # rellena ADMIN_PASSWORD y SECRET_KEY
bun run dev
```

Con `HEADLESS=false` ves el navegador mientras trabaja (útil para ajustar selectores).

## Seguridad

- Credenciales de Proton cifradas con AES-256-GCM (clave derivada de `SECRET_KEY`); nunca se devuelven por API ni por MCP.
- Tokens OAuth guardados como hash SHA-256; refresh tokens rotativos; códigos de un solo uso; PKCE obligatorio.
- La autorización exige `ADMIN_PASSWORD` en cada consentimiento (con límite de intentos por IP).
- `redirect_uri` solo https o loopback y debe coincidir exactamente con el registrado.
- El contenido de los correos se marca como no confiable en las respuestas de las tools (riesgo de prompt injection).
- Revoca clientes desde el panel (**Clientes autorizados**).

## Limitaciones conocidas

- **Captcha / verificación humana**: no se evade. La cuenta queda en *Requiere atención*; usa la captura del panel.
- **2FA**: soporta TOTP (guarda el secreto base32 al añadir la cuenta) o código manual desde el panel. Cuentas en modo
  *dos contraseñas* (clave de buzón aparte) no están soportadas.
- Automatizar la web puede chocar con los términos de Proton y se rompe si Proton cambia su interfaz. Todo lo que
  depende del DOM está en [`lib/proton/selectors.js`](lib/proton/selectors.js). Verificado contra Proton real: el
  formulario de login. **Lista/lectura/envío usan selectores `data-testid` de mejor esfuerzo sin validar contra una
  sesión real**: prueba con `HEADLESS=false` y ajusta ahí si algo falla.
- Una operación por cuenta a la vez; cada llamada puede tardar varios segundos.

## Perfil mínimo para VPS pequeño

Valores por defecto de `docker-compose.yml` (medidos en Docker, misma carga: listar 300 + 15 cuerpos):

| | Antes | Ahora |
|---|---|---|
| Imagen de la app | 3,82 GB (base Playwright con 3 navegadores) | **1,1 GB** (Bun slim + solo `chromium-headless-shell` y sus librerías) |
| RAM en reposo (app + PostgreSQL) | ~270 MB | **~75 MB** (52 + 23) |
| RAM con el navegador abierto | ~1,9 GB | **~0,8 GB** |
| Navegador | `chromium` completo, 2 abiertos, 5 min | `headless-shell` + flags ligeros, **1** abierto, se cierra a los **90 s** |

Variables: `BROWSER_SHELL` (true), `BROWSER_LEAN` (true), `BROWSER_HEAP_MB` (384), `MAX_BROWSERS` (1),
`BROWSER_IDLE_MS` (90000). PostgreSQL va ajustado (`shared_buffers=16MB`, `max_connections=10`). Con 1 GB de RAM añade
2 GB de swap: el navegador es lo que más pesa y solo está abierto mientras trabaja. `BROWSER_SHELL=false` vuelve al
Chromium completo (~20 % más rápido, ~+500 MB).

## Rendimiento

Medido en Docker (Chromium headless) con una bandeja de 2 368 conversaciones:

| Operación | Cómo | Tiempo |
|---|---|---|
| Listar toda la bandeja | Petición paginada (150/página) a la API web de Proton desde la sesión del navegador; los metadatos no van cifrados | **~2 s por 300** · 2 368 en una llamada |
| Leer cuerpos | La lista de Proton es paginada (50/página, `#page=N`): se calcula la página de cada correo con el orden de la API, se abre y se lee con clic + volver | **~2 s/correo** (antes ~20 s) |
| Cuerpo ya guardado | PostgreSQL | **milisegundos** |

Los cuerpos viajan cifrados (solo el navegador tiene las claves), por eso se leen de la pantalla. `proton_sync_folder`
con `with_bodies` trabaja por **tandas acotadas** (`BATCH_DEADLINE_MS`, 100 s por defecto): cada llamada trae los
cuerpos que aún no están en PostgreSQL y devuelve el control; repítela hasta que `bodies_fetched` llegue a 0. Si la API
interna cambia, el listado cae solo al scraping del DOM (máx. 50 filas).

**Bun como runtime.** El contenedor ejecuta el servidor con Bun (`bun server.js`, versión fijada a 1.4.3). Playwright
funciona bajo Bun **en Linux con 1.4.x**; con Bun 1.3.10 en Windows se queda colgado (la tubería hacia Chrome y el
WebSocket del paquete `ws` no completan), así que en desarrollo local en Windows usa Node (`next dev` ya lo hace).
Medido en el contenedor: lanzar Chromium y abrir el login tarda ~0,8–0,97 s tanto en Node como en Bun, y la
sincronización de ~50 cuerpos ~2 min en ambos: el tiempo lo ponen Chromium y la web de Proton, no el runtime. Para
volver a Node cambia el `CMD` del Dockerfile a `["node", "server.js"]`.

## Cifrado de los correos guardados

Remitente, asunto, resumen y cuerpo se guardan en PostgreSQL **cifrados** (AES-256-GCM, clave distinta por cuenta derivada de `SECRET_KEY`, enlazados a su fila con AAD). Un volcado o backup de la BD no revela el contenido. Los correos antiguos en claro se cifran solos al arrancar.

- La búsqueda descifra en memoria los 5000 correos más recientes (no hay índice sobre texto plano).
- Cambiar `SECRET_KEY` deja ilegibles los correos guardados (y las contraseñas de cuenta): rótala solo si estás dispuesto a volver a sincronizar.
- La clave vive en el servidor: protege la BD y sus backups, no un servidor comprometido. Para no guardar nada, no definas `DATABASE_URL`.
- `/data` contiene los perfiles del navegador (sesiones de Proton): usa cifrado de disco en el host.

## Podman

El mismo `Dockerfile` y `docker-compose.yml` funcionan con Podman (rootless incluido). Requiere `podman-compose` reciente (soporte de `${VAR:?}` y `condition: service_healthy`):

```bash
podman compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

- Las imágenes llevan el registro completo (`docker.io/...`): Podman no resuelve nombres cortos sin terminal interactiva.
- El `healthcheck` está declarado en el compose porque Podman construye en formato OCI y descarta el `HEALTHCHECK` del Dockerfile.
- Con bind mounts y SELinux, añade `:z` al montaje. Los volúmenes con nombre no lo necesitan.
- Sin probar en una instalación real de Podman.

## Correos HTML, imágenes y adjuntos

Al leer un correo se guarda, además del texto:

- **HTML saneado** (sin scripts, formularios, manejadores `on*` ni URLs `javascript:`), cifrado como el resto del correo.
- **Imágenes** incrustadas (`data:`, `blob:`) y remotas. Con `LOAD_REMOTE_CONTENT=true` (por defecto) se pulsa «Cargar contenido» y las imágenes llegan por el proxy de Proton; ponlo en `false` para no cargarlas.
- **Adjuntos** (hasta 10 por correo y `MAX_ATTACHMENT_MB`, 10 por defecto).

En `/emails` el HTML se muestra en un `<iframe>` aislado (`sandbox` sin permisos + CSP sin red ni scripts; las imágenes se incrustan al vuelo) y los adjuntos aparecen como botones de descarga. Las herramientas MCP devuelven `has_html` y la lista de adjuntos (nombre, tipo, tamaño).

### Dónde se guardan los archivos

Las imágenes y adjuntos se **cifran con AES-256-GCM antes de salir del proceso** (clave por cuenta); el almacén solo ve bytes opacos, y los nombres de archivo también van cifrados.

| Opción | Cómo |
|---|---|
| **PostgreSQL** (por defecto) | No hace falta configurar nada. |
| **Cualquier S3 compatible** (AWS, Cloudflare R2, Backblaze B2, Wasabi, Garage, MinIO…) | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (+ `S3_REGION`, `S3_PATH_STYLE`). Cliente SigV4 propio, sin SDK. |
| **MinIO propio sobre Alpine** (~75 MiB de RAM en reposo) | `COMPOSE_PROFILES=s3` y en `.env`: `S3_ENDPOINT=http://minio:9000`, `S3_BUCKET=proton-mcp`, `S3_ACCESS_KEY=<usuario>`, `S3_SECRET_KEY=<8+ caracteres>`. Imagen en [minio/](minio/), crea el bucket sola. |

Si cambias de PostgreSQL a S3, los archivos antiguos siguen en PostgreSQL (la fila indica dónde está cada uno), pero los nuevos van a S3.

### Limitaciones

- La captura de imágenes remotas y de **adjuntos depende de la interfaz de Proton** (selectores en [lib/proton/selectors.js](lib/proton/selectors.js)). Probado con un correo HTML de prueba en Chromium, PostgreSQL y MinIO, **no contra una cuenta real de Proton**: si no se descargan adjuntos, ajusta `attachmentItem` / `attachmentDownload`.
- Los correos leídos antes de esta versión solo tienen texto: léelos de nuevo con `refresh` para guardar su HTML.
- Cargar contenido remoto avisa al remitente de que el correo se abrió (la IP queda oculta por el proxy de Proton). Desactívalo con `LOAD_REMOTE_CONTENT=false`.

## Interfaz de correo, comentarios y tema

`/emails` funciona como un cliente de correo en tres columnas: cuentas y carpetas, lista de mensajes y lector. El estado vive en la URL (`account`, `folder`, `q`, `unread`, `sa`, `id`), así que cada vista se puede enlazar. En móvil se muestra la lista o el lector, con un botón para volver.

- **Comentarios:** cada correo tiene notas internas bajo el lector. Se guardan cifradas (AES-256-GCM, clave por cuenta), solo las ve el administrador y nunca llegan a Proton. La lista muestra cuántas tiene cada correo. API: `/api/emails/comments`.
- **Tema:** claro, oscuro o sistema, con el selector de la cabecera (`next-themes`). La preferencia se guarda en el navegador.
- **Componentes:** shadcn/ui (`new-york`): accordion, avatar, dropdown-menu, scroll-area, select, textarea, tooltip, además de los que ya había.

### Leer y enviar desde la web

- **Redactar:** botón en la cabecera de `/emails`. Elige la cuenta (si hay varias), destinatarios (Para, Cc, Cco), asunto y mensaje en texto plano. Envía automatizando el redactor web de Proton, así que tarda unos segundos y no se puede deshacer. Solo el administrador puede usarlo (`POST /api/emails/send`).
- **Sincronizar:** el botón de la cabecera trae de Proton los 150 correos más recientes de la carpeta elegida (solo metadatos, ~2 s). Con «Todas las cuentas» sincroniza cada una.
- **Leer:** al abrir un correo cuyo cuerpo no está guardado aparece «Leer desde Proton», que lo descarga y guarda cifrado con su HTML, imágenes y adjuntos. «Actualizar» lo vuelve a leer.
- Probado: autenticación y validación de las rutas contra la imagen real. **No probado** el envío ni la lectura contra una cuenta real de Proton (dependen de su interfaz web).
