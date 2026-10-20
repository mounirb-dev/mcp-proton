import { getAuth, initAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Todo el flujo de autenticación (login, sesiones, API keys, OAuth/MCP) lo sirve el handler de Better Auth.
async function handler(request) {
  await initAuth();
  return getAuth().handler(request);
}

export { handler as GET, handler as POST };
