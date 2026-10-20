import { NextResponse } from 'next/server';
import { getAccount } from '@/lib/accounts';
import { getEmail } from '@/lib/db';
import { sessionFromRequest } from '@/lib/guard';
import { readEmail } from '@/lib/proton/mail';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/** Lee un correo en vivo desde Proton y lo guarda (cuerpo, HTML, imágenes y adjuntos): POST {account, id}. */
export async function POST(request) {
  if (!(await sessionFromRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { account: accountId, id } = await request.json().catch(() => ({}));
  if (!accountId || typeof id !== 'string' || !id) return NextResponse.json({ error: 'Faltan account e id' }, { status: 400 });
  try {
    const account = await getAccount(accountId);
    // la carpeta guardada importa: los borradores solo se pueden abrir desde su propia lista
    const folder = (await getEmail(account.id, id))?.folder === 'drafts' ? 'drafts' : 'all';
    const email = await readEmail(account, { id, folder, refresh: true });
    if (email.pending || !email.messages?.length) {
      return NextResponse.json({ error: 'Proton no devolvió el contenido de este correo' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, attachments: email.attachments?.length ?? 0 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
