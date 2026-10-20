import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { exchangeOAuthCode, oauthState, provider, readOauthState, upsertOAuthConnection } from '@/lib/oauth-mail';

export async function GET(request, { params }) {
  const providerName = (await params).provider;
  const url = new URL(request.url);
  try {
    const state = readOauthState(url.searchParams.get('state'));
    if (state.provider !== providerName) throw new Error('Proveedor OAuth inválido');
    if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error_description') || url.searchParams.get('error'));
    const tokens = await exchangeOAuthCode(providerName, url.searchParams.get('code'), state.redirectUri);
    await upsertOAuthConnection(state.userId, providerName, tokens);
    return NextResponse.redirect(`${config.publicUrl}/?oauth=${encodeURIComponent(providerName)}&connected=1`);
  } catch (err) {
    return NextResponse.redirect(`${config.publicUrl}/?oauth_error=${encodeURIComponent(err.message)}`);
  }
}
