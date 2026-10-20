import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAccount } from '@/lib/accounts';
import { sessionFromRequest } from '@/lib/guard';
import { sendEmail } from '@/lib/proton/mail';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const address = z.string().trim().email().max(254);
const schema = z.object({
  account: z.string().min(1),
  to: z.array(address).min(1).max(20),
  cc: z.array(address).max(20).default([]),
  bcc: z.array(address).max(20).default([]),
  subject: z.string().trim().min(1).max(300),
  body: z.string().min(1).max(50_000),
});

/** Envía un correo en texto plano desde una cuenta de Proton (automatiza el redactor web de Proton). Solo administrador. */
export async function POST(request) {
  if (!(await sessionFromRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: `Datos no válidos (${issue.path.join('.') || 'cuerpo'}): ${issue.message}` }, { status: 400 });
  }
  try {
    const { account: id, ...mail } = parsed.data;
    const account = await getAccount(id);
    await sendEmail(account, mail);
    return NextResponse.json({ sent: true, from: account.email, to: mail.to });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status === 'needs_2fa' ? 409 : 500 });
  }
}
