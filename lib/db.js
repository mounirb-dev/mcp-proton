import crypto from 'node:crypto';
import pg from 'pg';
import { FIELD_PREFIX, openField, sealField } from './crypto.js';

// Almacén de correos (equivalente al SQLite de OpenWA, pero en PostgreSQL).
// Opcional: sin DATABASE_URL todo funciona, pero no se guarda nada.
const g = globalThis;

export const dbEnabled = () => Boolean(process.env.DATABASE_URL);

function pool() {
  if (!g.__protonPool) {
    g.__protonPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    g.__protonPool.on('error', () => {}); // conexiones inactivas caídas: el pool se recupera solo
  }
  return g.__protonPool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS emails (
  account_id  text        NOT NULL,
  element_id  text        NOT NULL,
  folder      text        NOT NULL DEFAULT 'inbox',
  sender      text        NOT NULL DEFAULT '',
  subject     text        NOT NULL DEFAULT '',
  time_text   text        NOT NULL DEFAULT '',
  unread      boolean     NOT NULL DEFAULT false,
  summary     text        NOT NULL DEFAULT '',
  body        text,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, element_id)
);
CREATE INDEX IF NOT EXISTS emails_recent_idx ON emails (account_id, fetched_at DESC);
ALTER TABLE emails ADD COLUMN IF NOT EXISTS html text; -- JSON cifrado con el HTML saneado de cada mensaje
CREATE TABLE IF NOT EXISTS blobs (
  id         uuid PRIMARY KEY,
  account_id text  NOT NULL,
  data       bytea            -- bytes cifrados; NULL si están en S3
);
CREATE INDEX IF NOT EXISTS blobs_account_idx ON blobs (account_id);
CREATE TABLE IF NOT EXISTS attachments (
  blob_id    uuid PRIMARY KEY REFERENCES blobs(id) ON DELETE CASCADE,
  account_id text   NOT NULL,
  element_id text   NOT NULL,
  kind       text   NOT NULL, -- 'file' (adjunto) | 'inline' (imagen incrustada en el HTML)
  name       text   NOT NULL, -- cifrado
  mime       text   NOT NULL,
  size       bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_email_idx ON attachments (account_id, element_id);
CREATE TABLE IF NOT EXISTS comments (
  id         uuid PRIMARY KEY,
  account_id text        NOT NULL,
  element_id text        NOT NULL,
  author     text        NOT NULL,
  body       text        NOT NULL, -- cifrado
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_email_idx ON comments (account_id, element_id, created_at);
DROP INDEX IF EXISTS emails_fts_idx; -- indexaba texto plano; con cifrado en reposo la búsqueda se hace en memoria
`;

// remitente, asunto, resumen y cuerpo se guardan cifrados (AES-256-GCM, clave por cuenta). El resto es metadato operativo.
const aad = (elementId, col) => `${elementId}:${col}`;
const seal = (accountId, elementId, col, v) => sealField(accountId, aad(elementId, col), v);
const open = (accountId, elementId, col, v) => openField(accountId, aad(elementId, col), v);

function openRow(r) {
  const out = { ...r };
  for (const [col, key] of [['sender', 'from'], ['subject', 'subject'], ['summary', 'summary'], ['body', 'body'], ['html', 'html']]) {
    if (key in out) out[key] = open(r.account_id, r.id ?? r.element_id, col, out[key]);
  }
  return out;
}

/** Cifra las filas guardadas en texto plano por versiones anteriores (una sola vez). */
async function migrateLegacy(db) {
  const plain = (c) => `(${c} IS NOT NULL AND ${c} <> '' AND ${c} NOT LIKE '${FIELD_PREFIX}%')`;
  let migrated = 0;
  for (;;) {
    const { rows } = await db.query(
      `SELECT account_id, element_id, sender, subject, summary, body FROM emails
        WHERE ${['sender', 'subject', 'summary', 'body'].map(plain).join(' OR ')} LIMIT 200`,
    );
    if (!rows.length) break;
    for (const r of rows) {
      const s = (col) => (r[col] && !r[col].startsWith(FIELD_PREFIX) ? seal(r.account_id, r.element_id, col, r[col]) : r[col]);
      await db.query('UPDATE emails SET sender=$3, subject=$4, summary=$5, body=$6 WHERE account_id=$1 AND element_id=$2', [
        r.account_id, r.element_id, s('sender'), s('subject'), s('summary'), s('body'),
      ]);
    }
    migrated += rows.length;
  }
  // los tuplos antiguos en claro siguen en disco hasta que se reescribe la tabla
  if (migrated) await db.query('VACUUM FULL emails').catch(() => {});
  if (migrated) console.log(`[db] ${migrated} correos antiguos cifrados en reposo`);
}

async function ready() {
  g.__protonSchema ??= pool()
    .query(SCHEMA)
    .then(() => migrateLegacy(pool()))
    .catch((err) => {
      g.__protonSchema = null; // reintenta en la siguiente llamada
      throw err;
    });
  await g.__protonSchema;
  return pool();
}

/** Pool con el esquema listo (lo usa lib/storage.js). */
export const getDb = ready;

/** Guarda sin romper la operación principal: un fallo de BD nunca debe tumbar una lectura de correo. */
async function safely(fn) {
  if (!dbEnabled()) return null;
  try {
    return await fn(await ready());
  } catch (err) {
    console.error('[db]', err.message);
    return null;
  }
}

export const saveList = (accountId, folder, items) =>
  safely(async (db) => {
    const rows = items.filter((i) => i.id);
    for (const i of rows) {
      await db.query(
        `INSERT INTO emails (account_id, element_id, folder, sender, subject, time_text, unread, summary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (account_id, element_id) DO UPDATE SET
           folder = CASE WHEN EXCLUDED.folder = 'all' THEN emails.folder ELSE EXCLUDED.folder END, sender = EXCLUDED.sender, subject = EXCLUDED.subject,
           time_text = EXCLUDED.time_text, unread = EXCLUDED.unread, summary = EXCLUDED.summary,
           fetched_at = now()`,
        [
          accountId, i.id, folder,
          seal(accountId, i.id, 'sender', i.from ?? ''),
          seal(accountId, i.id, 'subject', i.subject ?? ''),
          i.time, i.unread,
          seal(accountId, i.id, 'summary', i.summary ?? ''),
        ],
      );
    }
    return rows.length;
  });

export const saveBody = (accountId, elementId, subject, messages, htmls = []) =>
  safely((db) =>
    db.query(
      `INSERT INTO emails (account_id, element_id, subject, body, html)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (account_id, element_id) DO UPDATE SET
         body = EXCLUDED.body,
         html = EXCLUDED.html,
         subject = CASE WHEN emails.subject = '' THEN EXCLUDED.subject ELSE emails.subject END,
         unread = false, fetched_at = now()`,
      [
        accountId, elementId,
        seal(accountId, elementId, 'subject', subject ?? ''),
        seal(accountId, elementId, 'body', messages.join('\n\n---\n\n')),
        htmls.some(Boolean) ? seal(accountId, elementId, 'html', JSON.stringify(htmls)) : null,
      ],
    ),
  );

/** HTML saneado de un correo (array, un elemento por mensaje de la conversación) o null. */
export async function getEmailHtml(accountId, elementId) {
  const row = await safely(async (db) => {
    const { rows } = await db.query('SELECT html FROM emails WHERE account_id = $1 AND element_id = $2', [accountId, elementId]);
    return rows[0];
  });
  if (!row?.html) return null;
  try {
    return JSON.parse(open(accountId, elementId, 'html', row.html));
  } catch {
    return null;
  }
}

/** Correo ya leído y guardado (con cuerpo): evita abrir el navegador. */
export const getCachedEmail = (accountId, elementId) =>
  safely(async (db) => {
    const { rows } = await db.query(
      'SELECT element_id, subject, body FROM emails WHERE account_id = $1 AND element_id = $2 AND body IS NOT NULL',
      [accountId, elementId],
    );
    if (!rows[0]) return null;
    const subject = open(accountId, elementId, 'subject', rows[0].subject);
    const body = open(accountId, elementId, 'body', rows[0].body);
    return { id: rows[0].element_id, subject, header: '', messages: body.split('\n\n---\n\n'), cached: true };
  });

/** De los ids dados, los que aún no tienen cuerpo guardado (sin BD: todos). */
export async function missingBodyIds(accountId, ids) {
  if (!dbEnabled() || ids.length === 0) return ids;
  const have = await safely(async (db) => {
    const { rows } = await db.query('SELECT element_id FROM emails WHERE account_id = $1 AND element_id = ANY($2) AND body IS NOT NULL', [accountId, ids]);
    return new Set(rows.map((r) => r.element_id));
  });
  return ids.filter((id) => !have?.has(id));
}

export const purgeAccount = (accountId) =>
  safely(async (db) => {
    await db.query('DELETE FROM comments WHERE account_id = $1', [accountId]);
    await db.query('DELETE FROM emails WHERE account_id = $1', [accountId]);
  });

/** Un correo guardado con su cuerpo descifrado (para el lector). */
export async function getEmail(accountId, elementId) {
  const row = await safely(async (db) => {
    const { rows } = await db.query(
      'SELECT account_id, element_id AS id, folder, sender AS "from", subject, time_text AS time, unread, summary, body, (html IS NOT NULL) AS has_html, fetched_at FROM emails WHERE account_id = $1 AND element_id = $2',
      [accountId, elementId],
    );
    return rows[0];
  });
  return row ? openRow(row) : null;
}

const COMMENT_MAX = 4000;

/** Comentarios del correo, del más antiguo al más reciente. */
export async function listComments(accountId, elementId) {
  const rows =
    (await safely(async (db) => {
      const { rows: r } = await db.query(
        'SELECT id, author, body, created_at FROM comments WHERE account_id = $1 AND element_id = $2 ORDER BY created_at',
        [accountId, elementId],
      );
      return r;
    })) ?? [];
  return rows.map((r) => ({ id: r.id, author: r.author, created_at: r.created_at, body: openField(accountId, `${r.id}:comment`, r.body) }));
}

export async function addComment(accountId, elementId, author, text) {
  if (!dbEnabled()) throw new Error('Almacén desactivado: define DATABASE_URL.');
  const body = String(text ?? '').trim().slice(0, COMMENT_MAX);
  if (!body) throw new Error('El comentario está vacío');
  const id = crypto.randomUUID();
  const db = await ready();
  const { rows } = await db.query(
    'INSERT INTO comments (id, account_id, element_id, author, body) VALUES ($1,$2,$3,$4,$5) RETURNING created_at',
    [id, accountId, elementId, author, sealField(accountId, `${id}:comment`, body)],
  );
  return { id, author, body, created_at: rows[0].created_at };
}

export async function deleteComment(accountId, id) {
  if (!dbEnabled()) return false;
  const db = await ready();
  const { rowCount } = await db.query('DELETE FROM comments WHERE account_id = $1 AND id = $2', [accountId, id]);
  return rowCount > 0;
}

/** Nº de comentarios por correo: { 'cuenta:correo': n }. */
export async function commentCounts() {
  const rows = (await safely(async (db) => (await db.query('SELECT account_id, element_id, count(*)::int AS n FROM comments GROUP BY 1, 2')).rows)) ?? [];
  return Object.fromEntries(rows.map((r) => [`${r.account_id}:${r.element_id}`, r.n]));
}

/** Búsqueda/lectura desde la BD (sin abrir navegador). */
export async function queryEmails({ accountId, query, folder, unreadOnly, withBody = false, limit = 50 }) {
  if (!dbEnabled()) throw new Error('Almacén desactivado: define DATABASE_URL (PostgreSQL).');
  const db = await ready();
  const where = [];
  const args = [];
  const add = (sql, value) => {
    args.push(value);
    where.push(sql.replace('?', `$${args.length}`));
  };
  if (accountId) add('account_id = ?', accountId);
  if (folder) add('folder = ?', folder);
  if (unreadOnly) where.push('unread');
  const cap = Math.min(Math.max(limit, 1), 200);
  // Con el contenido cifrado la BD no puede buscar: se traen los más recientes y se filtra tras descifrar (tope SEARCH_SCAN_MAX).
  const needBody = withBody || Boolean(query);
  args.push(query ? SEARCH_SCAN_MAX : cap);
  const { rows } = await db.query(
    `SELECT account_id, element_id AS id, folder, sender AS "from", subject, time_text AS time, unread, summary,
            ${needBody ? 'body' : '(body IS NOT NULL) AS has_body'}, (html IS NOT NULL) AS has_html, fetched_at
       FROM emails ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY (CASE WHEN time_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN time_text ELSE '' END) DESC, fetched_at DESC
      LIMIT $${args.length}`,
    args,
  );
  let out = rows.map(openRow);
  if (query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    out = out
      .filter((r) => {
        const hay = `${r.from} ${r.subject} ${r.summary} ${r.body ?? ''}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .slice(0, cap);
    if (!withBody) {
      out = out.map(({ body, ...r }) => ({ ...r, has_body: body != null }));
    }
  }
  return out;
}

const SEARCH_SCAN_MAX = 5000;

export async function emailStats() {
  if (!dbEnabled()) return null;
  return safely(async (db) => {
    const { rows } = await db.query('SELECT account_id, count(*)::int AS total, count(body)::int AS with_body FROM emails GROUP BY account_id');
    return Object.fromEntries(rows.map((r) => [r.account_id, r]));
  });
}
