import crypto from 'node:crypto';
import { openBytes, openField, sealBytes, sealField } from './crypto.js';
import { dbEnabled, getDb } from './db.js';

// Adjuntos e imágenes de los correos. Se cifran (AES-256-GCM, clave por cuenta) antes de salir del proceso,
// así que S3 o PostgreSQL solo reciben bytes opacos. Sin S3 configurado van a PostgreSQL (bytea).
//
// S3 compatible (AWS, MinIO, Cloudflare R2, Backblaze B2, Garage, Wasabi…): S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY,
// S3_SECRET_KEY y, opcionalmente, S3_REGION (us-east-1; en R2 "auto") y S3_PATH_STYLE (true).

const env = () => process.env;
export const s3Enabled = () => Boolean(env().S3_ENDPOINT && env().S3_BUCKET && env().S3_ACCESS_KEY && env().S3_SECRET_KEY);
export const storageEnabled = () => dbEnabled();
export const maxBlobBytes = () => (Number.parseFloat(env().MAX_ATTACHMENT_MB ?? '10') || 10) * 1024 * 1024;

const hex = (b) => Buffer.from(b).toString('hex');
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Petición S3 firmada con AWS Signature V4, sin SDK. */
async function s3(method, key, body) {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION = 'us-east-1', S3_PATH_STYLE = 'true' } = env();
  const base = new URL(S3_ENDPOINT);
  const pathStyle = S3_PATH_STYLE !== 'false';
  const host = pathStyle ? base.host : `${S3_BUCKET}.${base.host}`;
  const path = `${base.pathname.replace(/\/$/, '')}${pathStyle ? `/${S3_BUCKET}` : ''}/${key.split('/').map(enc).join('/')}`;
  const payloadHash = sha(body ?? '');
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map((h) => `${h}:${headers[h]}\n`).join('');
  const canonical = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${S3_REGION}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canonical)].join('\n');
  const signingKey = [S3_REGION, 's3', 'aws4_request'].reduce((k, part) => hmac(k, part), hmac(`AWS4${S3_SECRET_KEY}`, day));
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${S3_ACCESS_KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hex(hmac(signingKey, toSign))}`;
  const res = await fetch(`${base.protocol}//${host}${path}`, { method, headers, body });
  if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
    throw new Error(`S3 ${method} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  return res;
}

const objectKey = (accountId, blobId) => `${accountId}/${blobId}`;

/** Guarda un archivo cifrado. Devuelve su id. */
export async function putBlob(accountId, elementId, { name, mime, bytes, kind }) {
  if (!dbEnabled()) return null;
  const blobId = crypto.randomUUID();
  const sealed = sealBytes(accountId, blobId, bytes);
  const db = await getDb();
  if (s3Enabled()) await s3('PUT', objectKey(accountId, blobId), sealed);
  await db.query('INSERT INTO blobs (id, account_id, data) VALUES ($1,$2,$3)', [blobId, accountId, s3Enabled() ? null : sealed]);
  await db.query(
    'INSERT INTO attachments (blob_id, account_id, element_id, kind, name, mime, size) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [blobId, accountId, elementId, kind, sealField(accountId, `${blobId}:name`, name), mime || 'application/octet-stream', bytes.length],
  );
  return blobId;
}

/** Descifra y devuelve { bytes, name, mime } (o null si no existe / no es de esa cuenta). */
export async function getBlob(accountId, blobId) {
  if (!dbEnabled() || !/^[0-9a-f-]{36}$/.test(blobId)) return null;
  const db = await getDb();
  const { rows } = await db.query(
    'SELECT b.data, a.name, a.mime FROM blobs b JOIN attachments a ON a.blob_id = b.id WHERE b.id = $1 AND b.account_id = $2',
    [blobId, accountId],
  );
  if (!rows[0]) return null;
  let sealed = rows[0].data;
  if (!sealed) sealed = Buffer.from(await (await s3('GET', objectKey(accountId, blobId))).arrayBuffer());
  return {
    bytes: openBytes(accountId, blobId, Buffer.from(sealed)),
    name: openField(accountId, `${blobId}:name`, rows[0].name),
    mime: rows[0].mime,
  };
}

/** Metadatos de los adjuntos de un correo (sin descargar los bytes). */
export async function listAttachments(accountId, elementId, kind = 'file') {
  if (!dbEnabled()) return [];
  try {
    const db = await getDb();
    const { rows } = await db.query(
      'SELECT blob_id, name, mime, size FROM attachments WHERE account_id = $1 AND element_id = $2 AND kind = $3 ORDER BY name',
      [accountId, elementId, kind],
    );
    return rows.map((r) => ({ blob_id: r.blob_id, name: openField(accountId, `${r.blob_id}:name`, r.name), mime: r.mime, size: r.size }));
  } catch (err) {
    console.error('[storage]', err.message);
    return [];
  }
}

/** Reemplaza los archivos de un correo al releerlo (evita duplicados). */
export async function dropEmailBlobs(accountId, elementId) {
  if (!dbEnabled()) return;
  const db = await getDb();
  const { rows } = await db.query('SELECT blob_id FROM attachments WHERE account_id = $1 AND element_id = $2', [accountId, elementId]);
  await removeBlobs(db, accountId, rows.map((r) => r.blob_id));
}

/** Borra todos los archivos de una cuenta (al eliminar la cuenta). */
export async function purgeBlobs(accountId) {
  if (!dbEnabled()) return;
  const db = await getDb();
  const { rows } = await db.query('SELECT id FROM blobs WHERE account_id = $1', [accountId]);
  await removeBlobs(db, accountId, rows.map((r) => r.id));
}

async function removeBlobs(db, accountId, ids) {
  if (!ids.length) return;
  if (s3Enabled()) await Promise.allSettled(ids.map((id) => s3('DELETE', objectKey(accountId, id))));
  await db.query('DELETE FROM attachments WHERE blob_id = ANY($1)', [ids]);
  await db.query('DELETE FROM blobs WHERE id = ANY($1)', [ids]);
}
