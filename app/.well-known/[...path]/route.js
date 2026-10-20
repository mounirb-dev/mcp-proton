import { getAuth, initAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Descubrimiento OAuth (RFC 8414 / RFC 9728): lo responde el plugin MCP de Better Auth.
// Cubre /.well-known/oauth-authorization-server[/api/auth], openid-configuration y oauth-protected-resource[/mcp].
async function handler(request) {
  await initAuth();
  const response = await getAuth().handler(request);
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(response.body, { status: response.status, headers });
}

export { handler as GET, handler as HEAD };
