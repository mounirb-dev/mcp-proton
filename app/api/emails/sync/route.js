import { NextResponse } from 'next/server';
import { getAccount } from '@/lib/accounts';
import { dbEnabled } from '@/lib/db';
import { sessionFromRequest } from '@/lib/guard';
import { syncFolder } from '@/lib/proton/mail';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const FOLDERS = ['inbox', 'sent', 'drafts', 'archive', 'spam', 'trash', 'starred', 'all'];

/** Trae los correos recientes de una carpeta (solo metadatos, ~2 s): POST {account, folder?}. Los cuerpos se leen al abrir cada correo. */
export async function POST(request) {
  if (!(await sessionFromRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!dbEnabled()) return NextResponse.json({ error: 'Define DATABASE_URL para activar el almacén' }, { status: 400 });
  const { account: accountId, folder = 'inbox' } = await request.json().catch(() => ({}));
  if (!accountId || !FOLDERS.includes(folder)) return NextResponse.json({ error: 'Cuenta o carpeta no válida' }, { status: 400 });
  try {
    const account = await getAccount(accountId);
    return NextResponse.json(await syncFolder(account, { folder, limit: 150 }));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
