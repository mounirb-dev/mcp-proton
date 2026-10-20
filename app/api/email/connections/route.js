import { NextResponse } from 'next/server';
import { apiAccess } from '@/lib/api-auth';
import { listOAuthConnections } from '@/lib/oauth-mail';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const access = await apiAccess(request);
  if (!access?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  return NextResponse.json({ connections: await listOAuthConnections(access.user.id) });
}
