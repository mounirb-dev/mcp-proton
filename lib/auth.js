import { apiKey } from '@better-auth/api-key';
import { mcp } from '@better-auth/mcp';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { nextCookies } from 'better-auth/next-js';
import { jwt } from 'better-auth/plugins';
import pg from 'pg';
import { assertConfigured, config } from './config.js';

export const API_KEY_PREFIX = 'pmcp_';
export const mcpResource = () => `${config.publicUrl}/mcp`;
export const authIssuer = () => `${config.publicUrl}/api/auth`;

const g = globalThis;

function create() {
  assertConfigured();
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5, idleTimeoutMillis: 30_000 });
  pool.on('error', () => {});

  return betterAuth({
    appName: 'Proton MCP',
    baseURL: config.publicUrl,
    secret: config.secretKey,
    database: pool,
    trustedOrigins: [config.publicUrl],
    // /token lo sustituye el endpoint OAuth del plugin MCP (el plugin jwt expone otro con el mismo nombre)
    disabledPaths: ['/token'],
    emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
    databaseHooks: {
      user: {
        create: {
          // Instancia de un solo administrador: solo se puede crear el primer usuario (lo siembra el arranque)
          before: async () => {
            const { rows } = await pool.query('select count(*)::int as n from "user"');
            if (rows[0].n > 0) return false;
          },
        },
      },
    },
    plugins: [
      jwt(),
      mcp({
        loginPage: '/login',
        consentPage: '/consent',
        resource: mcpResource(),
        scopes: ['mcp', 'offline_access'],
        clientRegistrationDefaultScopes: ['mcp'],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
      apiKey({ defaultPrefix: API_KEY_PREFIX, requireName: true }),
      nextCookies(), // siempre el último
    ],
  });
}

/** Instancia perezosa: durante `next build` no hay variables de entorno ni base de datos. */
export const getAuth = () => (g.__protonAuth2 ??= create());

/** Migra el esquema de Better Auth y siembra el administrador la primera vez. */
export function initAuth() {
  g.__protonAuthReady ??= (async () => {
    const auth = getAuth();
    const { runMigrations } = await getMigrations(auth.options);
    await runMigrations();
    const ctx = await auth.$context;
    const users = await ctx.adapter.count({ model: 'user' });
    if (users === 0) {
      await auth.api.signUpEmail({ body: { name: 'Admin', email: config.adminEmail, password: config.adminPassword } });
      console.error('[auth] administrador creado:', config.adminEmail);
    }
  })().catch((err) => {
    g.__protonAuthReady = null;
    throw err;
  });
  return g.__protonAuthReady;
}
