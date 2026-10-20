import { NextResponse } from 'next/server';
import { sessionAccess } from '@/lib/api-auth';
import { removeSmtpConnection } from '@/lib/smtp';

export async function DELETE(request, { params }) {
  const access = await sessionAccess(request);
  if (!access) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  await removeSmtpConnection(access.user.id, (await params).id);
  return NextResponse.json({ deleted: true });
}
