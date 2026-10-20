import { NextResponse } from 'next/server';
import { sessionFromRequest } from '@/lib/guard';
import { getBlob } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/** Descarga un adjunto guardado (se descifra al vuelo): ?account=<id>&id=<blob>. Siempre como descarga, nunca se renderiza. */
export async function GET(request) {
  if (!(await sessionFromRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const sp = new URL(request.url).searchParams;
  const blob = await getBlob(sp.get('account') ?? '', sp.get('id') ?? '').catch(() => null);
  if (!blob) return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 });
  const name = (blob.name || 'adjunto').replace(/[\r\n"]/g, '_');
  return new Response(blob.bytes, {
    headers: {
      'Content-Type': blob.mime,
      'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
