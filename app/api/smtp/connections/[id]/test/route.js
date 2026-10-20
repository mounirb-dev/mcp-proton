import { NextResponse } from 'next/server';
import { sessionAccess } from '@/lib/api-auth';
import { sendSmtpEmail } from '@/lib/smtp';

export async function POST(request, { params }) {
  const access = await sessionAccess(request);
  if (!access) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    return NextResponse.json(await sendSmtpEmail(access.user.id, (await params).id, null, { verifyOnly: true }));
  } catch (err) {
    return NextResponse.json({ verified: false, error: err.message }, { status: 502 });
  }
}
