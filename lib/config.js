import path from 'node:path';

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  get adminPassword() {
    return process.env.ADMIN_PASSWORD || '';
  },
  get secretKey() {
    return process.env.SECRET_KEY || '';
  },
  get publicUrl() {
    const url = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
    return url.replace(/\/+$/, '');
  },
  get internalUrl() {
    // URL con la que el propio servidor se alcanza a sí mismo (JWKS de Better Auth), sin pasar por el proxy
    return process.env.INTERNAL_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
  },
  get adminEmail() {
    return process.env.ADMIN_EMAIL || '';
  },
  get databaseUrl() {
    return process.env.DATABASE_URL || '';
  },
  get dataDir() {
    return process.env.DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), 'data');
  },
  get browserIdleMs() {
    return int(process.env.BROWSER_IDLE_MS, 300_000);
  },
  get maxBrowsers() {
    return int(process.env.MAX_BROWSERS, 2);
  },
  get headless() {
    return (process.env.HEADLESS ?? 'true') !== 'false';
  },
  get noSandbox() {
    return process.env.BROWSER_NO_SANDBOX === 'true';
  },
  get lean() {
    return (process.env.BROWSER_LEAN ?? 'true') !== 'false';
  },
  get shell() {
    return process.env.BROWSER_SHELL === 'true';
  },
  get blockMedia() {
    return (process.env.BROWSER_BLOCK_MEDIA ?? 'true') !== 'false';
  },
  // Ruta a un Chromium del sistema (p. ej. /usr/bin/chromium en Alpine); vacío = el de Playwright
  get executablePath() {
    return process.env.BROWSER_EXECUTABLE_PATH || '';
  },
  get heapMb() {
    return int(process.env.BROWSER_HEAP_MB, 384);
  },
  get userAgent() {
    return process.env.BROWSER_USER_AGENT || '';
  },
};

export function assertConfigured() {
  if (!config.adminEmail.includes('@')) throw new Error('ADMIN_EMAIL no configurada (email del administrador)');
  if (!config.adminPassword || config.adminPassword.length < 8) {
    throw new Error('ADMIN_PASSWORD no configurada (mínimo 8 caracteres)');
  }
  if (!config.secretKey || config.secretKey.length < 32) {
    throw new Error('SECRET_KEY no configurada (mínimo 32 caracteres)');
  }
  if (!config.databaseUrl) throw new Error('DATABASE_URL no configurada (PostgreSQL: usuarios, sesiones y API keys)');
}

/** URL base pública, sin barra final. Prioriza PUBLIC_URL, luego headers del proxy. */
export function baseUrl(request) {
  if (config.publicUrl) return config.publicUrl;
  const h = request.headers;
  const host = (h.get('x-forwarded-host') || h.get('host') || 'localhost').split(',')[0].trim();
  const proto = (h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https'))
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}
