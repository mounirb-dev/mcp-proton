import nodemailer from 'nodemailer';
import { getDb } from './db.js';
import { decrypt, encrypt, randomToken } from './crypto.js';

const g = globalThis;

async function ready() {
  g.__smtpSchema ??= getDb().then((db) => db.query(`
    CREATE TABLE IF NOT EXISTS smtp_connections (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      name text NOT NULL,
      host text NOT NULL,
      port integer NOT NULL,
      secure boolean NOT NULL DEFAULT false,
      username text NOT NULL,
      password_enc text NOT NULL,
      from_email text NOT NULL,
      from_name text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS smtp_connections_user_idx ON smtp_connections (user_id);
  `).then(() => getDb()));
  return g.__smtpSchema;
}

const view = (row) => ({
  id: row.id,
  name: row.name,
  host: row.host,
  port: row.port,
  secure: row.secure,
  username: row.username,
  fromEmail: row.from_email,
  fromName: row.from_name,
  createdAt: row.created_at,
});

function cleanPort(port, secure) {
  const n = Number(port || (secure ? 465 : 587));
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('Puerto SMTP inválido');
  return n;
}

export async function listSmtpConnections(userId) {
  const db = await ready();
  const { rows } = await db.query('SELECT * FROM smtp_connections WHERE user_id=$1 ORDER BY created_at DESC', [userId]);
  return rows.map(view);
}

export async function createSmtpConnection(userId, input) {
  const secure = Boolean(input.secure);
  const row = {
    id: randomToken(12),
    userId,
    name: String(input.name || input.host).trim().slice(0, 80),
    host: String(input.host || '').trim().toLowerCase().slice(0, 255),
    port: cleanPort(input.port, secure),
    secure,
    username: String(input.username || '').trim().slice(0, 320),
    password: String(input.password || ''),
    fromEmail: String(input.fromEmail || input.username || '').trim().toLowerCase().slice(0, 320),
    fromName: String(input.fromName || '').trim().slice(0, 160),
  };
  if (!row.host || !row.username || !row.password || !row.fromEmail.includes('@')) throw new Error('host, username, password y fromEmail son obligatorios');
  const db = await ready();
  await db.query(
    `INSERT INTO smtp_connections (id,user_id,name,host,port,secure,username,password_enc,from_email,from_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [row.id, row.userId, row.name, row.host, row.port, row.secure, row.username, encrypt(row.password), row.fromEmail, row.fromName],
  );
  return view({ ...row, password_enc: null, from_email: row.fromEmail, from_name: row.fromName, user_id: row.userId, created_at: new Date() });
}

async function getConnection(userId, id) {
  const db = await ready();
  const { rows } = await db.query('SELECT * FROM smtp_connections WHERE id=$1 AND user_id=$2', [id, userId]);
  if (!rows[0]) throw new Error('Conexión SMTP no encontrada');
  return rows[0];
}

export async function removeSmtpConnection(userId, id) {
  const db = await ready();
  await db.query('DELETE FROM smtp_connections WHERE id=$1 AND user_id=$2', [id, userId]);
}

export async function sendSmtpEmail(userId, connectionId, mail, { verifyOnly = false } = {}) {
  const row = await getConnection(userId, connectionId);
  const transport = nodemailer.createTransport({
    host: row.host,
    port: row.port,
    secure: row.secure,
    auth: { user: row.username, pass: decrypt(row.password_enc) },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  await transport.verify();
  if (verifyOnly) return { verified: true, connection: view(row) };
  const info = await transport.sendMail({
    from: row.from_name ? `"${row.from_name.replaceAll('"', '')}" <${row.from_email}>` : row.from_email,
    to: mail.to,
    cc: mail.cc?.length ? mail.cc : undefined,
    bcc: mail.bcc?.length ? mail.bcc : undefined,
    replyTo: mail.replyTo || undefined,
    subject: mail.subject,
    text: mail.text,
    html: mail.html || undefined,
  });
  transport.close();
  return { sent: true, messageId: info.messageId, accepted: info.accepted };
}
