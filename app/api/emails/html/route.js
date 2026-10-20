import { NextResponse } from 'next/server';
import { getEmailHtml } from '@/lib/db';
import { sessionFromRequest } from '@/lib/guard';
import { getBlob } from '@/lib/storage';

export const dynamic = 'force-dynamic';

const MAX_INLINE_BYTES = 15 * 1024 * 1024;
// El HTML ya viene saneado al guardarlo; esta CSP es la segunda barrera: sin scripts, sin red (solo data:), en sandbox.
const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; sandbox allow-popups allow-popups-to-escape-sandbox";
const LIGHT = '<meta name="color-scheme" content="light"><style>html{background:#fff;color:#111}body{margin:8px;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style>';

/** HTML de un correo para mostrarlo en <iframe>: ?account=<id>&id=<correo>&n=<mensaje>. Las imágenes se incrustan como data:. */
export async function GET(request) {
  if (!(await sessionFromRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const sp = new URL(request.url).searchParams;
  const account = sp.get('account') ?? '';
  const id = sp.get('id') ?? '';
  const n = Math.max(0, Number.parseInt(sp.get('n') ?? '0', 10) || 0);
  const htmls = account && id ? await getEmailHtml(account, id) : null;
  if (!htmls?.[n]) return NextResponse.json({ error: 'Sin HTML guardado para este correo' }, { status: 404 });

  let html = htmls[n];
  const ids = [...new Set([...html.matchAll(/pmblob:([0-9a-f-]{36})/g)].map((m) => m[1]))];
  const urls = new Map();
  let total = 0;
  for (const blobId of ids) {
    const blob = await getBlob(account, blobId).catch(() => null);
    if (!blob || total + blob.bytes.length > MAX_INLINE_BYTES) continue;
    total += blob.bytes.length;
    urls.set(blobId, `data:${blob.mime};base64,${blob.bytes.toString('base64')}`);
  }
  html = html.replace(/pmblob:([0-9a-f-]{36})/g, (_, blobId) => urls.get(blobId) ?? '');
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + LIGHT) : LIGHT + html;

  return new Response(`<!doctype html>${html}`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'private, no-store',
    },
  });
}
