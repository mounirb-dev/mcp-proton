import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpProtectedRequestHandler } from '@better-auth/mcp';
import { API_KEY_PREFIX, authIssuer, getAuth, initAuth, mcpResource } from '@/lib/auth';
import { config } from '@/lib/config';
import { createMcpServer } from '@/lib/mcp/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
};

const preflight = () =>
  new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, MCP-Protocol-Version, Mcp-Session-Id',
      'Access-Control-Max-Age': '86400',
    },
  });

/** Modo stateless: un servidor + transporte por petición, respuestas JSON. */
async function runMcp(request) {
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  headers.set('Cache-Control', 'no-store');
  server.close().catch(() => {});
  return new Response(response.body, { status: response.status, headers });
}

const unauthorized = () =>
  new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'API key inválida o ausente' }, id: null }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

/** API key de Better Auth: cabecera `x-api-key` o `Authorization: Bearer pmcp_...` (para clientes sin OAuth). */
function apiKeyFrom(request) {
  const direct = request.headers.get('x-api-key');
  if (direct) return direct;
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  return bearer?.startsWith(API_KEY_PREFIX) ? bearer : null;
}

async function handle(request) {
  if (request.method === 'OPTIONS') return preflight();
  await initAuth();
  const auth = getAuth();

  const key = apiKeyFrom(request);
  if (key) {
    const result = await auth.api.verifyApiKey({ body: { key } }).catch(() => null);
    return result?.valid ? runMcp(request) : unauthorized();
  }

  // OAuth 2.1: token emitido por Better Auth. El JWKS se lee por la URL interna (sin salir al proxy público).
  const protectedHandler = createMcpProtectedRequestHandler(
    { audience: mcpResource(), issuer: authIssuer(), jwksUrl: `${config.internalUrl}/api/auth/jwks` },
    (req) => runMcp(req),
  );
  const response = await protectedHandler(request);
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

export { handle as GET, handle as POST, handle as DELETE, handle as OPTIONS };
