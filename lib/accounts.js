import { mutate, readState } from './store.js';
import { decrypt, encrypt, randomToken } from './crypto.js';

export const STATUS = {
  NEW: 'new',
  OK: 'ok',
  NEEDS_2FA: 'needs_2fa',
  NEEDS_ATTENTION: 'needs_attention',
  ERROR: 'error',
};

const publicView = (a) => ({
  id: a.id,
  label: a.label,
  email: a.email,
  hasTotp: Boolean(a.totpEnc),
  status: a.status,
  statusMessage: a.statusMessage,
  lastCheckedAt: a.lastCheckedAt,
  createdAt: a.createdAt,
  autoSync: a.autoSync !== false, // activada por defecto
  lastSyncAt: a.lastSyncAt ?? null,
  lastSyncNote: a.lastSyncNote ?? '',
});

export async function listAccounts() {
  const state = await readState();
  return state.accounts.map(publicView);
}

export async function getAccount(idOrLabel) {
  const state = await readState();
  const { accounts } = state;
  if (!idOrLabel) {
    if (accounts.length === 1) return accounts[0];
    if (accounts.length === 0) throw new Error('No hay cuentas de Proton configuradas. Añade una en el panel.');
    throw new Error(`Hay ${accounts.length} cuentas; indica "account" (email, etiqueta o id).`);
  }
  const needle = String(idOrLabel).toLowerCase();
  const found = accounts.find(
    (a) => a.id === idOrLabel || a.email.toLowerCase() === needle || a.label.toLowerCase() === needle,
  );
  if (!found) throw new Error(`Cuenta "${idOrLabel}" no encontrada.`);
  return found;
}

export function readCredentials(account) {
  return {
    email: account.email,
    password: decrypt(account.passwordEnc),
    totpSecret: account.totpEnc ? decrypt(account.totpEnc) : null,
  };
}

export async function addAccount({ label, email, password, totpSecret }) {
  const clean = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('Email inválido');
  if (!password) throw new Error('Contraseña requerida');
  const account = {
    id: randomToken(9),
    label: String(label || clean.split('@')[0]).slice(0, 60),
    email: clean,
    passwordEnc: encrypt(password),
    totpEnc: totpSecret ? encrypt(String(totpSecret).replace(/\s+/g, '')) : null,
    status: STATUS.NEW,
    statusMessage: 'Sin verificar',
    lastCheckedAt: null,
    createdAt: Date.now(),
  };
  await mutate((state) => {
    if (state.accounts.some((a) => a.email === clean)) throw new Error('Esa cuenta ya existe');
    state.accounts.push(account);
  });
  return publicView(account);
}

export async function removeAccount(id) {
  await mutate((state) => {
    state.accounts = state.accounts.filter((a) => a.id !== id);
  });
}

/** Cuentas con la sincronización automática activada y sesión operativa. */
export async function listAutoSyncAccounts() {
  const state = await readState();
  return state.accounts.filter((a) => a.autoSync !== false && a.status === STATUS.OK);
}

export async function setAutoSync(id, enabled) {
  await mutate((state) => {
    const account = state.accounts.find((a) => a.id === id);
    if (account) account.autoSync = Boolean(enabled);
  });
}

export async function setSyncInfo(id, note) {
  await mutate((state) => {
    const account = state.accounts.find((a) => a.id === id);
    if (!account) return;
    account.lastSyncAt = Date.now();
    account.lastSyncNote = String(note).slice(0, 200);
  });
}

export async function setStatus(id, status, statusMessage) {
  await mutate((state) => {
    const account = state.accounts.find((a) => a.id === id);
    if (!account) return;
    account.status = status;
    account.statusMessage = statusMessage;
    account.lastCheckedAt = Date.now();
  });
}
