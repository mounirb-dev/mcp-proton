import { NextResponse } from 'next/server';
import { getAccount } from '@/lib/accounts';
import { screenshot } from '@/lib/proton/mail';
import { sessionFromRequest } from '@/lib/guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request, { params }) {
  if (!(await sessionFromRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { id } = await params;
  try {
    const account = await getAccount(id);
    const base64 = await screenshot(account);
    return new Response(Buffer.from(base64, 'base64'), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
