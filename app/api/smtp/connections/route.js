import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sessionAccess } from '@/lib/api-auth';
import { createSmtpConnection, listSmtpConnections } from '@/lib/smtp';

export const dynamic = 'force-dynamic';
const schema = z.object({
  name: z.string().trim().max(80).optional(),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  secure: z.boolean().default(false),
  username: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(1000),
  fromEmail: z.string().trim().email().max(320),
  fromName: z.string().trim().max(160).optional(),
});

export async function GET(request) {
  const access = await sessionAccess(request);
  if (!access) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  return NextResponse.json({ connections: await listSmtpConnections(access.user.id) });
}

export async function POST(request) {
  const access = await sessionAccess(request);
  if (!access) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  try {
    return NextResponse.json({ connection: await createSmtpConnection(access.user.id, parsed.data) }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
