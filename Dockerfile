# syntax=docker/dockerfile:1
# Imagen Alpine: Bun alpine + Chromium del sistema (apk). El Chromium de Playwright es glibc y no corre en musl.
# Nombre completo con registro: Podman no resuelve nombres cortos sin terminal interactiva
FROM docker.io/oven/bun:1.4.3-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM base AS runner
# chromium (con sus librerías), fuentes, certificados y su-exec (para bajar de root a bun en el entrypoint)
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont su-exec \
 # GPU desactivada (--disable-gpu): mesa/LLVM (~230 MB) solo se cargan por dlopen para GL, no hacen falta
 && rm -f /usr/lib/libLLVM*.so* /usr/lib/libgallium*.so* /usr/lib/libgallium* \
 && rm -rf /usr/lib/dri /usr/share/icu/*/*.dat.bak \
 # locales de Chromium: solo en-US
 && (find /usr/lib/chromium/locales -type f ! -name 'en-US.pak' -delete 2>/dev/null || true)
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data \
    BROWSER_NO_SANDBOX=true \
    BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
COPY --from=build --chown=bun:bun /app/.next/standalone ./
COPY --from=build --chown=bun:bun /app/.next/static ./.next/static
RUN mkdir -p /data && chown bun:bun /data
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
VOLUME ["/data"]
# el entrypoint arranca como root, arregla permisos de /data y baja a bun
ENTRYPOINT ["docker-entrypoint.sh"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "server.js"]
