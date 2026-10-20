import { getAccount, listAutoSyncAccounts, setSyncInfo } from './accounts.js';
import { dbEnabled, emailStats } from './db.js';
import { syncFolder } from './proton/mail.js';

// Sincronización automática en segundo plano: trae metadatos nuevos (API de Proton, ~2 s) y los cuerpos que falten
// (por tandas pequeñas). Solo toca cuentas con sesión operativa y el interruptor activado: nunca reintenta logins
// fallidos contra Proton. El navegador se abre bajo demanda y se cierra solo (BROWSER_IDLE_MS).
const g = globalThis;

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const FOLDERS = ['inbox', 'sent'];

async function syncAccount(listed) {
  const account = await getAccount(listed.id);
  const stats = await emailStats();
  const firstTime = !stats?.[account.id]?.total;
  const maxBodies = num(process.env.SYNC_MAX_BODIES, 15);
  const limit = firstTime ? 3000 : num(process.env.SYNC_RECENT_LIMIT, 300);
  const parts = [];
  for (const folder of FOLDERS) {
    const r = await syncFolder(account, { folder, limit, withBodies: folder === 'inbox' && maxBodies > 0, maxBodies });
    parts.push(`${folder}: ${r.listed}${r.bodies_fetched ? ` (+${r.bodies_fetched} cuerpos)` : ''}`);
  }
  await setSyncInfo(account.id, parts.join(' · '));
  console.error(`[auto-sync] ${account.email} → ${parts.join(' · ')}`);
}

async function runOnce() {
  if (g.__protonAutoSyncBusy) return;
  g.__protonAutoSyncBusy = true;
  try {
    for (const account of await listAutoSyncAccounts()) {
      try {
        await syncAccount(account);
      } catch (err) {
        await setSyncInfo(account.id, `Error: ${err.message}`).catch(() => {});
        console.error(`[auto-sync] ${account.email} falló: ${err.message}`);
      }
    }
  } finally {
    g.__protonAutoSyncBusy = false;
  }
}

/** Arranca el planificador una sola vez por proceso. SYNC_INTERVAL_MIN=0 lo desactiva. */
export function startAutoSync() {
  const minutes = num(process.env.SYNC_INTERVAL_MIN, 15);
  if (g.__protonAutoSync || minutes === 0 || !dbEnabled()) return false;
  const first = setTimeout(runOnce, num(process.env.SYNC_FIRST_DELAY_S, 60) * 1000);
  const timer = setInterval(runOnce, minutes * 60_000);
  first.unref?.();
  timer.unref?.();
  g.__protonAutoSync = { timer, minutes };
  console.error(`[auto-sync] activo: cada ${minutes} min`);
  return true;
}
