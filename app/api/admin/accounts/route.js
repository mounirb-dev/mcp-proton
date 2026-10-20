import { NextResponse } from 'next/server';
import { addAccount } from '@/lib/accounts';
import { sessionFromRequest } from '@/lib/guard';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!(await sessionFromRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  try {
    const account = await addAccount({
      label: body.label,
      email: body.email,
      password: body.password,
      totpSecret: body.totpSecret,
    });
    return NextResponse.json(account, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
