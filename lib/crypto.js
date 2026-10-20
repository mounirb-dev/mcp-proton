import crypto from 'node:crypto';
import { config } from './config.js';

let cachedKey;
let cachedFor;

function key() {
  if (cachedKey && cachedFor === config.secretKey) return cachedKey;
  cachedFor = config.secretKey;
  // SECRET_KEY ya es de alta entropía; la sal se deriva de él (no hay valor fijo en el código)
  const salt = crypto.createHash('sha256').update(`salt:${config.secretKey}`).digest();
  cachedKey = crypto.scryptSync(config.secretKey, salt, 32);
  return cachedKey;
}

/** AES-256-GCM. Formato: iv.tag.ciphertext (base64url). */
export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(payload) {
  const [iv, tag, ct] = payload.split('.').map((s) => Buffer.from(s, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// --- Cifrado de campos de correo en reposo (BD) ---
// Clave por cuenta derivada con HKDF de SECRET_KEY; el AAD (id del correo + columna) impide mover un valor a otra fila/columna.
export const FIELD_PREFIX = 'enc:v1:';
const fieldKeys = new Map();
let fieldKeysFor;

function fieldKey(accountId) {
  const root = key();
  if (fieldKeysFor !== cachedFor) {
    fieldKeys.clear();
    fieldKeysFor = cachedFor;
  }
  let k = fieldKeys.get(accountId);
  if (!k) {
    const salt = crypto.createHash('sha256').update(`hkdf-salt:${config.secretKey}`).digest();
    k = Buffer.from(crypto.hkdfSync('sha256', root, salt, `proton-mcp:emails:v1:account:${accountId}`, 32));
    fieldKeys.set(accountId, k);
  }
  return k;
}

export function sealField(accountId, aad, plain) {
  if (plain == null || plain === '') return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', fieldKey(accountId), iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return FIELD_PREFIX + [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.');
}

/** Valores sin prefijo (filas antiguas aún sin migrar) se devuelven tal cual. */
export function openField(accountId, aad, stored) {
  if (typeof stored !== 'string' || !stored.startsWith(FIELD_PREFIX)) return stored;
  try {
    const [iv, tag, ct] = stored.slice(FIELD_PREFIX.length).split('.').map((s) => Buffer.from(s, 'base64url'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', fieldKey(accountId), iv);
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return '[no se pudo descifrar: ¿cambió SECRET_KEY?]';
  }
}

/** Cifra bytes (adjuntos/imágenes) con la clave de la cuenta. Formato: iv(12) | tag(16) | ciphertext. */
export function sealBytes(accountId, aad, buf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', fieldKey(accountId), iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function openBytes(accountId, aad, buf) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', fieldKey(accountId), buf.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('base64url');

export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function hmac(value) {
  return crypto.createHmac('sha256', key()).update(value).digest('base64url');
}

/** TOTP RFC 6238 (SHA-1, 6 dígitos, 30 s) a partir de un secreto base32. */
export function totp(secretBase32, now = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secretBase32.replace(/[\s=-]/g, '').toUpperCase();
  let bits = '';
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) throw new Error('Secreto TOTP inválido (base32)');
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = crypto.createHmac('sha1', bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}
