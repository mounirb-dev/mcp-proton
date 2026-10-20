import { decrypt, encrypt, randomToken } from './crypto.js';
import { getDb } from './db.js';
import { config } from './config.js';

const g = globalThis;

const PROVIDERS = {
  google: {
    label: 'Google Gmail',
    clientId: () => config.googleClientId,
    clientSecret: () => config.googleClientSecret,
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    userinfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send',
  },
  microsoft: {
    label: 'Microsoft Outlook',
    clientId: () => config.microsoftClientId,
    clientSecret: () => config.microsoftClientSecret,
    authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userinfoEndpoint: 'https://graph.microsoft.com/v1.0/me',
    scope: 'openid profile email offline_access User.Read Mail.ReadWrite Mail.Send',
  },
};

export function provider(name) {
  const value = PROVIDERS[name];
  if (!value) throw new Error(`Proveedor OAuth no soportado: ${name}`);
  if (!value.clientId() || !value.clientSecret()) throw new Error(`Faltan credenciales OAuth de ${value.label}`);
  return value;
}

export const supportedProviders = Object.entries(PROVIDERS).map(([id, value]) => ({ id, label: value.label, configured: Boolean(value.clientId() && value.clientSecret()) }));

async function ready() {
  g.__mailOAuthSchema ??= getDb().then((db) => db.query(`
    CREATE TABLE IF NOT EXISTS email_connections (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      provider text NOT NULL,
      email text NOT NULL,
      display_name text NOT NULL DEFAULT '',
      access_token_enc text NOT NULL,
      refresh_token_enc text,
      expires_at bigint,
      scope text NOT NULL DEFAULT '',
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, provider, email)
    );
    CREATE INDEX IF NOT EXISTS email_connections_user_idx ON email_connections (user_id);
  `).then(() => getDb()));
  return g.__mailOAuthSchema;
}

const view = (row) => ({ id: row.id, provider: row.provider, email: row.email, displayName: row.display_name, scope: row.scope, expiresAt: row.expires_at, createdAt: row.created_at, updatedAt: row.updated_at });

export function oauthState(providerName, userId, redirectUri) {
  return encrypt(JSON.stringify({ provider: providerName, userId, redirectUri, nonce: randomToken(18), exp: Date.now() + 10 * 60_000 }));
}

export function readOauthState(value) {
  if (!value) throw new Error('Falta el estado OAuth');
  const state = JSON.parse(decrypt(value));
  if (!state.exp || state.exp < Date.now()) throw new Error('El estado OAuth ha caducado');
  return state;
}

export async function upsertOAuthConnection(userId, providerName, tokens) {
  const p = provider(providerName);
  const accessToken = tokens.access_token;
  if (!accessToken) throw new Error('El proveedor no devolvió access_token');
  const userResponse = await fetch(p.userinfoEndpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!userResponse.ok) throw new Error(`No se pudo obtener el perfil de ${p.label}`);
  const profile = await userResponse.json();
  const email = profile.email || profile.mail || profile.userPrincipalName;
  if (!email) throw new Error(`El proveedor no devolvió el email de ${p.label}`);
  const displayName = profile.name || profile.displayName || '';
  const db = await ready();
  const { rows } = await db.query(
    `INSERT INTO email_connections (id,user_id,provider,email,display_name,access_token_enc,refresh_token_enc,expires_at,scope,metadata,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
     ON CONFLICT (user_id,provider,email) DO UPDATE SET display_name=EXCLUDED.display_name, access_token_enc=EXCLUDED.access_token_enc,
       refresh_token_enc=COALESCE(EXCLUDED.refresh_token_enc,email_connections.refresh_token_enc), expires_at=EXCLUDED.expires_at,
       scope=EXCLUDED.scope, metadata=EXCLUDED.metadata, updated_at=now()
     RETURNING *`,
    [randomToken(12), userId, providerName, email.toLowerCase(), displayName, encrypt(accessToken), tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      Date.now() + Number(tokens.expires_in || 3600) * 1000, tokens.scope || '', JSON.stringify(profile)],
  );
  return view(rows[0]);
}

export async function listOAuthConnections(userId) {
  const db = await ready();
  const { rows } = await db.query('SELECT * FROM email_connections WHERE user_id=$1 ORDER BY updated_at DESC', [userId]);
  return rows.map(view);
}

export async function removeOAuthConnection(userId, id) {
  const db = await ready();
  await db.query('DELETE FROM email_connections WHERE id=$1 AND user_id=$2', [id, userId]);
}

export async function getOAuthConnection(userId, id) {
  const db = await ready();
  const { rows } = await db.query('SELECT * FROM email_connections WHERE id=$1 AND user_id=$2', [id, userId]);
  if (!rows[0]) throw new Error('Conexión OAuth no encontrada');
  return rows[0];
}

export async function accessTokenFor(row) {
  if (row.expires_at && Number(row.expires_at) > Date.now() + 60_000) return decrypt(row.access_token_enc);
  if (!row.refresh_token_enc) throw new Error('La conexión OAuth no tiene refresh token; vuelve a autorizarla');
  const p = provider(row.provider);
  const body = new URLSearchParams({ client_id: p.clientId(), client_secret: p.clientSecret(), grant_type: 'refresh_token', refresh_token: decrypt(row.refresh_token_enc) });
  const response = await fetch(p.tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const tokens = await response.json();
  if (!response.ok || !tokens.access_token) throw new Error(tokens.error_description || `No se pudo renovar OAuth de ${p.label}`);
  const db = await ready();
  await db.query('UPDATE email_connections SET access_token_enc=$2, expires_at=$3, updated_at=now() WHERE id=$1', [row.id, encrypt(tokens.access_token), Date.now() + Number(tokens.expires_in || 3600) * 1000]);
  return tokens.access_token;
}

export async function exchangeOAuthCode(providerName, code, redirectUri) {
  const p = provider(providerName);
  const body = new URLSearchParams({ client_id: p.clientId(), client_secret: p.clientSecret(), code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  const response = await fetch(p.tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const tokens = await response.json();
  if (!response.ok) throw new Error(tokens.error_description || `OAuth rechazado por ${p.label}`);
  return tokens;
}

export async function sendOAuthEmail(userId, connectionId, mail) {
  const row = await getOAuthConnection(userId, connectionId);
  const token = await accessTokenFor(row);
  const to = (Array.isArray(mail.to) ? mail.to : [mail.to]).join(', ');
  if (row.provider === 'google') {
    const headers = [
      `From: ${row.email}`,
      `To: ${to}`,
      ...(mail.cc?.length ? [`Cc: ${mail.cc.join(', ')}`] : []),
      ...(mail.replyTo ? [`Reply-To: ${mail.replyTo}`] : []),
      `Subject: ${mail.subject}`,
      'MIME-Version: 1.0',
      mail.html ? 'Content-Type: text/html; charset=UTF-8' : 'Content-Type: text/plain; charset=UTF-8',
    ];
    const raw = Buffer.from(`${headers.join('\r\n')}\r\n\r\n${mail.html || mail.text}`).toString('base64url');
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'Gmail rechazó el envío');
    return { sent: true, provider: 'google', messageId: result.id };
  }
  if (row.provider === 'microsoft') {
    const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { subject: mail.subject, body: { contentType: mail.html ? 'HTML' : 'Text', content: mail.html || mail.text }, toRecipients: (Array.isArray(mail.to) ? mail.to : [mail.to]).map((address) => ({ emailAddress: { address } })), ...(mail.cc?.length ? { ccRecipients: mail.cc.map((address) => ({ emailAddress: { address } })) } : {}), ...(mail.bcc?.length ? { bccRecipients: mail.bcc.map((address) => ({ emailAddress: { address } })) } : {}) }, saveToSentItems: true }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error?.message || 'Microsoft Graph rechazó el envío');
    }
    return { sent: true, provider: 'microsoft' };
  }
  throw new Error(`Envío OAuth no implementado para ${row.provider}`);
}
