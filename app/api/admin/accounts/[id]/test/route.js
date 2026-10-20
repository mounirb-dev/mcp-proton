import { NextResponse } from 'next/server';
import { getAccount } from '@/lib/accounts';
import { testLogin } from '@/lib/proton/mail';
import { sessionFromRequest } from '@/lib/guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request, { params }) {
  if (!(await sessionFromRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { id } = await params;
  const { code } = await request.json().catch(() => ({}));
  try {
    const account = await getAccount(id);
    const result = await testLogin(account, { code: typeof code === 'string' ? code.replace(/\s+/g, '') : undefined });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, message: err.message }, { status: 500 });
  }
}
