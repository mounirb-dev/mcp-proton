import { headers } from 'next/headers';
import { getAuth, initAuth } from './auth.js';

/** Sesión del administrador en un route handler (cookie de Better Auth en la petición). */
export async function sessionFromRequest(request) {
  await initAuth();
  return getAuth().api.getSession({ headers: request.headers });
}

/** Sesión del administrador en un server component. */
export async function sessionFromCookies() {
  await initAuth();
  return getAuth().api.getSession({ headers: await headers() });
}
