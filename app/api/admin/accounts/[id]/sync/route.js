import { NextResponse } from 'next/server';
import { getAccount, setSyncInfo } from '@/lib/accounts';
import { dbEnabled } from '@/lib/db';
import { listEmails } from '@/lib/proton/mail';
import { sessionFromRequest } from '@/lib/guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Sincroniza las carpetas principales al almacén PostgreSQL.
export async function POST(request, { params }) {
  if (!(await sessionFromRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!dbEnabled()) return NextResponse.json({ error: 'Define DATABASE_URL para activar el almacén' }, { status: 400 });
  const { id } = await params;
  try {
    const account = await getAccount(id);
    // Metadatos de todas las carpetas útiles por API (150 por petición, ~1 s). Tope por carpeta: 3750.
    const folders = {};
    for (const folder of ['inbox', 'sent', 'archive', 'drafts']) {
      const items = await listEmails(account, { folder, limit: 3000 });
      folders[folder] = items.filter((i) => i.id).length;
    }
    await setSyncInfo(account.id, `manual · ${Object.entries(folders).map(([k, v]) => `${k}: ${v}`).join(' · ')}`);
    return NextResponse.json({ synced: Object.values(folders).reduce((a, b) => a + b, 0), folders });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
