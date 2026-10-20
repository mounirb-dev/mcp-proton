import crypto from 'node:crypto';
import { dropEmailBlobs, maxBlobBytes, putBlob } from '../storage.js';
import { SEL } from './selectors.js';

// Captura el HTML saneado, las imágenes (incrustadas y remotas) y los adjuntos de un correo abierto en Proton.
// Un fallo aquí nunca debe impedir devolver el texto del correo.

const IMG_MAX = 2 * 1024 * 1024;
const IMG_MIN = 100; // descarta píxeles de seguimiento
const IMG_COUNT = 30;
const FILE_COUNT = 10;
const LOAD_REMOTE = (process.env.LOAD_REMOTE_CONTENT ?? 'true') !== 'false';

/** Escucha las respuestas de imagen de la página para poder guardar las remotas (que el iframe no deja leer). */
export function watchImages(page) {
  const net = new Map();
  const onResponse = async (resp) => {
    try {
      if (net.size >= 100 || resp.request().resourceType() !== 'image' || !resp.ok()) return;
      const mime = (resp.headers()['content-type'] ?? '').split(';')[0].trim();
      if (!mime.startsWith('image/') || Number(resp.headers()['content-length'] ?? 0) > IMG_MAX) return;
      const buf = await resp.body();
      if (buf.length >= IMG_MIN && buf.length <= IMG_MAX) net.set(resp.url(), { mime, buf });
    } catch {
      /* respuesta ya descartada */
    }
  };
  page.on('response', onResponse);
  return { net, stop: () => page.off('response', onResponse) };
}

/** Pulsa "Cargar contenido remoto/incrustado" si Proton lo muestra (las imágenes pasan por el proxy de Proton). */
export async function loadRemoteContent(page) {
  if (!LOAD_REMOTE) return false;
  let clicked = false;
  const candidates = [page.locator(SEL.loadContent), page.getByRole('button', { name: SEL.loadContentText })];
  for (const loc of candidates) {
    for (let i = 0; i < 3; i += 1) {
      const btn = loc.first();
      if (!(await btn.isVisible().catch(() => false))) break;
      await btn.click({ timeout: 2000 }).catch(() => {});
      clicked = true;
      await page.waitForTimeout(400);
    }
  }
  if (clicked) await page.waitForTimeout(1200); // deja que lleguen las imágenes
  return clicked;
}

const parseDataUri = (uri) => {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri);
  if (!m) return null;
  const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
  return { mime: m[1] || 'application/octet-stream', buf };
};

/**
 * Devuelve el HTML saneado del iframe de un mensaje con las imágenes guardadas como blobs cifrados
 * (src="pmblob:<id>"), o null si no se pudo. Las imágenes se resuelven por data:/blob: (dentro del iframe) o por red.
 */
export async function captureFrameHtml(frame, net, accountId, elementId) {
  try {
    // 1) etiqueta cada <img> y recoge su origen
    const found = await frame.evaluate(async (imgMax) => {
      const toDataUri = (blob) =>
        new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
      const out = [];
      let i = 0;
      for (const img of document.images) {
        img.setAttribute('data-pm-i', String(i));
        const src = img.currentSrc || img.src || '';
        const item = { i, src: src.startsWith('data:') ? '' : src };
        if (src.startsWith('data:')) item.data = src.length < imgMax * 1.4 ? src : null;
        else if (src.startsWith('blob:')) {
          try {
            const blob = await (await fetch(src)).blob();
            if (blob.size <= imgMax) item.data = await toDataUri(blob);
          } catch {
            /* blob revocado */
          }
        }
        out.push(item);
        i += 1;
      }
      return out;
    }, IMG_MAX);

    // 2) guarda en el almacén cifrado las que se pudieron obtener
    const map = {};
    const seen = new Map(); // hash -> blobId (misma imagen repetida)
    let stored = 0;
    for (const f of found) {
      if (stored >= IMG_COUNT) break;
      const img = f.data ? parseDataUri(f.data) : net.get(f.src);
      if (!img || img.buf.length < IMG_MIN || !img.mime.startsWith('image/')) continue;
      const hash = crypto.createHash('sha256').update(img.buf).digest('hex');
      let id = seen.get(hash);
      if (!id) {
        id = await putBlob(accountId, elementId, { name: `inline-${f.i}`, mime: img.mime, bytes: img.buf, kind: 'inline' });
        if (!id) continue;
        seen.set(hash, id);
        stored += 1;
      }
      map[f.i] = `pmblob:${id}`;
    }

    // 3) HTML saneado (sin scripts, formularios, manejadores ni URLs javascript:) con las imágenes ya locales
    return await frame.evaluate((srcMap) => {
      const clone = document.documentElement.cloneNode(true);
      clone
        .querySelectorAll('script,iframe,frame,frameset,object,embed,applet,link,meta,base,form,input,button,textarea,select,audio,video,source,track,noscript,template')
        .forEach((n) => n.remove());
      for (const el of clone.querySelectorAll('*')) {
        for (const a of [...el.attributes]) {
          const n = a.name.toLowerCase();
          const v = a.value.trim().toLowerCase();
          if (n.startsWith('on') || n === 'srcset' || n === 'ping' || n === 'formaction' || n === 'background') el.removeAttribute(a.name);
          else if (['href', 'src', 'xlink:href', 'action', 'poster'].includes(n) && /^(javascript|vbscript|data:text\/html)/.test(v)) el.removeAttribute(a.name);
        }
        if (el.tagName === 'IMG') {
          const m = srcMap[el.getAttribute('data-pm-i')];
          if (m) el.setAttribute('src', m);
          else el.removeAttribute('src');
          el.removeAttribute('data-pm-i');
          el.removeAttribute('loading');
        }
      }
      for (const a of clone.querySelectorAll('a[href]')) {
        a.setAttribute('rel', 'noopener noreferrer nofollow');
        a.setAttribute('target', '_blank');
      }
      return clone.outerHTML;
    }, map);
  } catch (err) {
    console.error('[content] html', err.message);
    return null;
  }
}

/** Descarga los adjuntos visibles del mensaje abierto y los guarda cifrados. Devuelve sus metadatos. */
export async function downloadAttachments(page, accountId, elementId) {
  const out = [];
  try {
    const items = page.locator(SEL.attachmentItem);
    const count = Math.min(await items.count(), FILE_COUNT);
    for (let i = 0; i < count; i += 1) {
      const item = items.nth(i);
      const label = ((await item.innerText({ timeout: 1500 }).catch(() => '')) || '').split('\n')[0].trim();
      const btn = item.locator(SEL.attachmentDownload).first();
      if (!(await btn.count())) {
        out.push({ name: label || `adjunto-${i + 1}`, stored: false });
        continue;
      }
      try {
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 12_000 }), btn.click({ timeout: 3000 })]);
        const max = maxBlobBytes();
        const chunks = [];
        let size = 0;
        for await (const chunk of await download.createReadStream()) {
          size += chunk.length;
          if (size > max) throw new Error('supera MAX_ATTACHMENT_MB');
          chunks.push(chunk);
        }
        const name = download.suggestedFilename() || label || `adjunto-${i + 1}`;
        const bytes = Buffer.concat(chunks);
        const mime = guessMime(name);
        const blobId = await putBlob(accountId, elementId, { name, mime, bytes, kind: 'file' });
        await download.delete().catch(() => {});
        out.push({ name, mime, size: bytes.length, blob_id: blobId, stored: Boolean(blobId) });
      } catch (err) {
        out.push({ name: label || `adjunto-${i + 1}`, stored: false, error: err.message.slice(0, 100) });
      }
    }
  } catch (err) {
    console.error('[content] adjuntos', err.message);
  }
  return out;
}

const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  txt: 'text/plain', csv: 'text/csv', zip: 'application/zip', json: 'application/json', ics: 'text/calendar',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const guessMime = (name) => MIME[name.split('.').pop()?.toLowerCase()] ?? 'application/octet-stream';

export { dropEmailBlobs };
