import { NextResponse } from 'next/server';
import { getAccount } from '@/lib/accounts';
import { addComment, deleteComment, listComments } from '@/lib/db';
import { sessionFromRequest } from '@/lib/guard';

export const dynamic = 'force-dynamic';

const fail = (message, status) => NextResponse.json({ error: message }, { status });

/** Comentarios de un correo: GET ?account=&id= · POST {account,id,body} · DELETE ?account=&comment= */
async function resolve(session, accountId) {
  if (!session) return { error: fail('No autorizado', 401) };
  try {
    return { account: await getAccount(accountId) };
  } catch {
    return { error: fail('Cuenta no encontrada', 404) };
  }
}

export async function GET(request) {
  const sp = new URL(request.url).searchParams;
  const { account, error } = await resolve(await sessionFromRequest(request), sp.get('account') ?? '');
  if (error) return error;
  return NextResponse.json({ comments: await listComments(account.id, sp.get('id') ?? '') });
}

export async function POST(request) {
  const session = await sessionFromRequest(request);
  const data = await request.json().catch(() => ({}));
  const { account, error } = await resolve(session, String(data.account ?? ''));
  if (error) return error;
  if (!data.id || typeof data.id !== 'string') return fail('Falta el id del correo', 400);
  try {
    return NextResponse.json({ comment: await addComment(account.id, data.id, session.user.email, data.body) });
  } catch (err) {
    return fail(err.message, 400);
  }
}

export async function DELETE(request) {
  const sp = new URL(request.url).searchParams;
  const { account, error } = await resolve(await sessionFromRequest(request), sp.get('account') ?? '');
  if (error) return error;
  const ok = await deleteComment(account.id, sp.get('comment') ?? '');
  return ok ? NextResponse.json({ ok: true }) : fail('Comentario no encontrado', 404);
}
