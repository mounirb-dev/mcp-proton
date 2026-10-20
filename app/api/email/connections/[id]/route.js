import { NextResponse } from 'next/server';
import { apiAccess } from '@/lib/api-auth';
import { removeOAuthConnection } from '@/lib/oauth-mail';

export async function DELETE(request, { params }) {
  const access = await apiAccess(request);
  if (!access?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  await removeOAuthConnection(access.user.id, (await params).id);
  return NextResponse.json({ deleted: true });
}
