import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const EMPTY = () => ({ accounts: [] });

// Next.js puede empaquetar este módulo varias veces (una por ruta):
// el candado debe vivir en globalThis para serializar entre todas las copias.
const g = globalThis;
g.__protonStoreLock ??= Promise.resolve();

const file = () => path.join(config.dataDir, 'state.json');

async function load() {
  try {
    const raw = await fs.readFile(file(), 'utf8');
    return { ...EMPTY(), ...JSON.parse(raw) };
  } catch (err) {
    if (err.code === 'ENOENT') return EMPTY();
    throw err;
  }
}

async function save(state) {
  await fs.mkdir(config.dataDir, { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file());
}

export function readState() {
  const run = g.__protonStoreLock.then(load);
  g.__protonStoreLock = run.catch(() => {});
  return run;
}

/** Lectura-modificación-escritura atómica. `fn` recibe el estado y puede devolver un valor. */
export function mutate(fn) {
  const run = g.__protonStoreLock.then(async () => {
    const state = await load();
    const result = await fn(state);
    await save(state);
    return result;
  });
  g.__protonStoreLock = run.catch(() => {});
  return run;
}
