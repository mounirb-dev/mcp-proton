import { NextResponse } from 'next/server';
import { removeAccount, setAutoSync } from '@/lib/accounts';
import { purgeAccount } from '@/lib/db';
import { closeBrowser } from '@/lib/proton/browser';
import { purgeBlobs } from '@/lib/storage';
import { sessionFromRequest } from '@/lib/guard';

export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  if (!(await sessionFromRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (typeof body.autoSync !== 'boolean') return NextResponse.json({ error: 'autoSync debe ser booleano' }, { status: 400 });
  await setAutoSync(id, body.autoSync);
  return NextResponse.json({ ok: true, autoSync: body.autoSync });
}

export async function DELETE(request, { params }) {
  if (!(await sessionFromRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { id } = await params;
  await closeBrowser(id);
  await removeAccount(id);
  await purgeBlobs(id); // adjuntos/imágenes (S3 o PostgreSQL) antes de borrar las filas
  await purgeAccount(id);
  return NextResponse.json({ ok: true });
}
