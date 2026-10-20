import { getAuth, initAuth } from './auth.js';

/** Permite usar una sesión web o una API key para las APIs públicas. */
export async function apiAccess(request) {
  await initAuth();
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (session?.user) return { user: session.user, via: 'session' };

  const key = request.headers.get('x-api-key') || request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!key) return null;
  const result = await auth.api.verifyApiKey({ body: { key } }).catch(() => null);
  if (!result?.valid) return null;
  const userId = result.key?.userId ?? result.userId ?? null;
  return { user: userId ? { id: userId } : null, via: 'api-key' };
}

export async function sessionAccess(request) {
  await initAuth();
  const session = await getAuth().api.getSession({ headers: request.headers }).catch(() => null);
  return session?.user ? { user: session.user, via: 'session' } : null;
}
