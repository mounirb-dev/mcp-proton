import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { config } from '../config.js';

// Gestor "serverless": el navegador se lanza bajo demanda por cuenta, las
// operaciones de una misma cuenta se serializan y se cierra tras inactividad.
// Vive en globalThis porque Next puede cargar este módulo varias veces.
const g = globalThis;
g.__protonBrowsers ??= new Map();
const entries = g.__protonBrowsers;

/** context -> { x-pm-uid, x-pm-appversion } capturadas de las peticiones reales de la app. */
export const authHeaders = (g.__protonAuth ??= new WeakMap());

if (!g.__protonBrowserShutdownHooked) {
  g.__protonBrowserShutdownHooked = true;
  const shutdown = async () => {
    await Promise.allSettled([...entries.values()].map((e) => e.context?.close()));
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

function entryFor(id) {
  let entry = entries.get(id);
  if (!entry) {
    entry = { id, context: null, queue: Promise.resolve(), timer: null, busy: false, lastUsed: Date.now() };
    entries.set(id, entry);
  }
  return entry;
}

async function closeEntry(entry) {
  clearTimeout(entry.timer);
  const ctx = entry.context;
  entry.context = null;
  await ctx?.close().catch(() => {});
}

async function evictIfNeeded(exceptId) {
  const open = [...entries.values()].filter((e) => e.context && e.id !== exceptId);
  if (open.length < config.maxBrowsers) return;
  const idle = open.filter((e) => !e.busy).sort((a, b) => a.lastUsed - b.lastUsed)[0];
  if (idle) await closeEntry(idle);
}

async function launch(entry) {
  await evictIfNeeded(entry.id);
  const dir = path.join(config.dataDir, 'profiles', entry.id);
  await fs.mkdir(dir, { recursive: true });
  // Chrome deja SingletonLock/Cookie/Socket con el hostname del contenedor anterior; al recrear el contenedor
  // (nuevo hostname) se niega a abrir el perfil. Este proceso es el único dueño del perfil: se limpian.
  await Promise.all(
    ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].map((f) => fs.rm(path.join(dir, f), { force: true }).catch(() => {})),
  );
  const args = ['--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'];
  if (config.noSandbox) args.push('--no-sandbox');
  // Perfil de bajo consumo para VPS pequeños (desactiva GPU, extensiones, servicios en segundo plano y limita el heap de V8)
  if (config.lean) {
    args.push(
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-component-update',
      '--disable-default-apps',
      '--no-first-run',
      '--mute-audio',
      '--renderer-process-limit=1',
      '--enable-low-end-device-mode',
      '--disable-breakpad',
      '--disable-crash-reporter',
      '--disable-component-extensions-with-background-pages',
      '--disable-ipc-flooding-protection',
      '--no-pings',
      ...(config.noSandbox ? ['--no-zygote'] : []),
      '--disable-features=Translate,BackForwardCache,MediaRouter,OptimizationHints',
      `--js-flags=--max-old-space-size=${config.heapMb}`,
    );
  }
  const context = await chromium.launchPersistentContext(dir, {
    // headless "nuevo" (Chromium completo) se comporta como un Chrome real; BROWSER_SHELL=true usa chromium-headless-shell (más ligero)
    ...(config.executablePath ? { executablePath: config.executablePath } : config.shell ? {} : { channel: 'chromium' }),
    headless: config.headless,
    args,
    locale: 'en-US', // los textos de la UI no dependen del idioma del servidor
    viewport: { width: 1366, height: 900 },
    userAgent: config.userAgent || undefined,
    acceptDownloads: true, // se descargan los adjuntos de los correos para guardarlos cifrados
  });
  context.setDefaultTimeout(20_000);
  // Vídeo/audio y fuentes no hacen falta para leer el correo y consumen RAM. Las imágenes NO se bloquean: se guardan con el correo.
  if (config.lean && config.blockMedia) {
    await context.route('**/*', (route) => {
      const t = route.request().resourceType();
      return t === 'media' || t === 'font' ? route.abort() : route.continue();
    });
  }
  // Cabeceras de sesión de la propia app: permiten llamar a la API web de Proton desde la página (listados masivos).
  context.on('request', (req) => {
    const h = req.headers();
    if (h['x-pm-uid'] && req.url().startsWith('https://mail.proton.me/api/')) {
      authHeaders.set(context, { 'x-pm-uid': h['x-pm-uid'], 'x-pm-appversion': h['x-pm-appversion'] ?? '' });
    }
  });
  context.on('close', () => {
    if (entry.context === context) entry.context = null;
  });
  entry.context = context;
  return context;
}

/** Ejecuta fn(page, context) con el navegador de la cuenta; serializa por cuenta. */
export function withPage(accountId, fn) {
  const entry = entryFor(accountId);
  const run = entry.queue.then(async () => {
    clearTimeout(entry.timer);
    entry.busy = true;
    try {
      const context = entry.context ?? (await launch(entry));
      const page = context.pages()[0] ?? (await context.newPage());
      return await fn(page, context);
    } finally {
      entry.busy = false;
      entry.lastUsed = Date.now();
      entry.timer = setTimeout(() => closeEntry(entry), config.browserIdleMs);
      entry.timer.unref?.();
    }
  });
  entry.queue = run.catch(() => {});
  return run;
}

export async function closeBrowser(accountId) {
  const entry = entries.get(accountId);
  if (entry) await closeEntry(entry);
}

export function browserStates() {
  return Object.fromEntries([...entries.values()].map((e) => [e.id, e.context ? (e.busy ? 'busy' : 'idle') : 'closed']));
}
