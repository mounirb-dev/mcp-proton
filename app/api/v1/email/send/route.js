import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiAccess } from '@/lib/api-auth';
import { sendSmtpEmail } from '@/lib/smtp';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const address = z.string().trim().email().max(254);
const schema = z.object({
  connection: z.string().min(1),
  to: z.union([address, z.array(address).min(1).max(50)]),
  cc: z.array(address).max(50).default([]),
  bcc: z.array(address).max(50).default([]),
  replyTo: address.optional(),
  subject: z.string().trim().min(1).max(300),
  text: z.string().max(100_000).optional(),
  html: z.string().max(500_000).optional(),
}).refine((value) => value.text || value.html, { message: 'Debes indicar text o html' });

export async function POST(request) {
  const access = await apiAccess(request);
  if (!access?.user?.id) return NextResponse.json({ error: 'API key o sesión no válida' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  try {
    const mail = { ...parsed.data, to: Array.isArray(parsed.data.to) ? parsed.data.to : [parsed.data.to] };
    return NextResponse.json(await sendSmtpEmail(access.user.id, mail.connection, mail));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
