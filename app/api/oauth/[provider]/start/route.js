import { redirect } from 'next/navigation';
import { sessionAccess } from '@/lib/api-auth';
import { oauthState, provider } from '@/lib/oauth-mail';
import { config } from '@/lib/config';

export async function GET(request, { params }) {
  const access = await sessionAccess(request);
  if (!access) redirect('/login');
  const providerName = (await params).provider;
  const p = provider(providerName);
  const redirectUri = `${config.publicUrl}/api/oauth/${providerName}/callback`;
  const state = oauthState(providerName, access.user.id, redirectUri);
  const url = new URL(p.authorizationEndpoint);
  url.searchParams.set('client_id', p.clientId());
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', p.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  redirect(url.toString());
}
