import { readCredentials, setStatus, STATUS } from '../accounts.js';
import { totp } from '../crypto.js';
import { dbEnabled, getCachedEmail, missingBodyIds, saveBody, saveList } from '../db.js';
import { listAttachments } from '../storage.js';
import { authHeaders, withPage } from './browser.js';
import { captureFrameHtml, downloadAttachments, dropEmailBlobs, loadRemoteContent, watchImages } from './content.js';
import { FOLDERS, SEL, URLS } from './selectors.js';

const ORIGIN = 'https://mail.proton.me';
const MAX_BODY = 20_000;
const BATCH_DEADLINE_MS = Number.parseInt(process.env.BATCH_DEADLINE_MS ?? '100000', 10) || 100_000;

export class ProtonError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const visible = (page, selector) =>
  page
    .locator(selector)
    .first()
    .isVisible()
    .catch(() => false);

async function poll(page, checks, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const [name, check] of Object.entries(checks)) {
      if (await check()) return name;
    }
    await page.waitForTimeout(500);
  }
  return 'timeout';
}

const onMailApp = async (page) => page.url().startsWith(ORIGIN) && (await visible(page, SEL.mailReady));

async function readLoginError(page) {
  const text = await page
    .locator(SEL.loginError)
    .first()
    .innerText()
    .catch(() => '');
  return text.trim().slice(0, 200);
}

async function submitLogin(page, creds) {
  await page.goto(URLS.login, { waitUntil: 'domcontentloaded' });
  await page.locator(SEL.loginUser).fill(creds.email);
  await page.locator(SEL.loginPass).fill(creds.password);
  const keep = page.locator(SEL.keepSignedIn);
  if ((await keep.count()) > 0 && !(await keep.isChecked().catch(() => true))) {
    await keep.check({ force: true }).catch(() => {});
  }
  await page.locator(SEL.loginSubmit).first().click();
  const clickedAt = Date.now();
  let seen = 0;
  return poll(
    page,
    {
      mail: () => onMailApp(page),
      twofa: () => visible(page, SEL.totp),
      captcha: () => visible(page, SEL.captcha),
      // el error debe persistir 3 sondeos seguidos y tras >=4 s (evita falsos positivos mientras Proton transiciona)
      error: async () => {
        const hit = (await visible(page, SEL.loginError)) && (await visible(page, SEL.loginUser));
        seen = hit ? seen + 1 : 0;
        return seen >= 3 && Date.now() - clickedAt > 4000;
      },
    },
    45_000,
  );
}

async function submitTwoFactor(page, creds, manualCode) {
  const code = manualCode || (creds.totpSecret ? totp(creds.totpSecret) : null);
  if (!code) return 'twofa_missing';
  await page.locator(SEL.totp).first().fill(code);
  await page.keyboard.press('Enter');
  return poll(
    page,
    {
      mail: () => onMailApp(page),
      captcha: () => visible(page, SEL.captcha),
      error: () => visible(page, SEL.loginError),
    },
    30_000,
  );
}

/** Garantiza una sesión abierta en Proton Mail; actualiza el estado de la cuenta. */
export async function ensureSession(page, account, { code } = {}) {
  if (await onMailApp(page)) return;

  await page.goto(`${URLS.mail}/inbox`, { waitUntil: 'domcontentloaded' });
  let state = await poll(
    page,
    {
      mail: () => onMailApp(page),
      login: () => visible(page, SEL.loginUser),
      twofa: () => visible(page, SEL.totp),
      captcha: () => visible(page, SEL.captcha),
    },
    40_000,
  );

  const creds = readCredentials(account);
  if (state === 'login') state = await submitLogin(page, creds);
  if (state === 'twofa') state = await submitTwoFactor(page, creds, code);

  switch (state) {
    case 'mail':
      await setStatus(account.id, STATUS.OK, 'Sesión activa');
      return;
    case 'twofa_missing':
    case 'twofa':
      await setStatus(account.id, STATUS.NEEDS_2FA, 'Proton pide un código 2FA: añade el secreto TOTP o introduce el código en el panel');
      throw new ProtonError(STATUS.NEEDS_2FA, 'La cuenta requiere código 2FA. Introdúcelo en el panel o configura el secreto TOTP.');
    case 'captcha': {
      const msg = 'Proton pide verificación humana (captcha). No se puede resolver automáticamente.';
      await setStatus(account.id, STATUS.NEEDS_ATTENTION, msg);
      throw new ProtonError(STATUS.NEEDS_ATTENTION, msg);
    }
    case 'error': {
      const detail = await readLoginError(page);
      const msg = `Proton rechazó el login${detail ? `: ${detail}` : ''}`;
      await setStatus(account.id, STATUS.ERROR, msg);
      throw new ProtonError(STATUS.ERROR, msg);
    }
    default: {
      const msg = 'No se pudo confirmar la sesión (tiempo agotado). Revisa con proton_screenshot o el panel.';
      await setStatus(account.id, STATUS.ERROR, msg);
      throw new ProtonError(STATUS.ERROR, msg);
    }
  }
}

/** Cierra diálogos de bienvenida/promoción que bloquean los clics. */
async function dismissModals(page) {
  for (let i = 0; i < 3; i += 1) {
    const dialog = page.locator('[role="dialog"]').first();
    if (!(await dialog.isVisible().catch(() => false))) return;
    const close = dialog.getByRole('button', { name: /^(close|skip|got it|maybe later|later|no,? thanks|continue)/i }).first();
    if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}

async function open(page, account, opts) {
  await ensureSession(page, account, opts);
  await dismissModals(page);
}

const FOLDER_LABELS =
  /^(Bandeja de entrada|Inbox|Enviados|Sent|Borradores|Drafts|Archivo|Archive|Spam|Papelera|Trash|Todo el correo|All Mail|Destacados|Starred)(?=\S)/i;
const THREAD_PREFIX = /^\[\d+\]\d+ (mensajes? en la conversación|messages? in (the )?conversation)/i;

/** El selector de asunto a veces arrastra la etiqueta de carpeta o el contador de conversación. */
const cleanSubject = (s) => s.replace(THREAD_PREFIX, '').replace(FOLDER_LABELS, '').trim();

const listSignature = (page) =>
  page
    .locator(SEL.listItem)
    .evaluateAll((els) => els.slice(0, 5).map((e) => e.getAttribute('data-element-id')).join('|'))
    .catch(() => '');

// Carga completa (domcontentloaded). Se probó navegar por la SPA con pushState/popstate: Proton no refresca la
// lista de forma fiable (devolvía la carpeta anterior), así que se descartó.
const navigate = (page, url) => page.goto(url, { waitUntil: 'domcontentloaded' });

/** Espera a que la lista cambie (o se estabilice) en vez de dormir un tiempo fijo. */
async function waitListSettled(page, prevSig) {
  const start = Date.now();
  let last = null;
  let stable = 0;
  while (Date.now() - start < 15_000) {
    const sig = await listSignature(page);
    stable = sig && sig === last ? stable + 1 : 0;
    last = sig;
    if (sig && stable >= 2 && (sig !== prevSig || Date.now() - start > 1200)) return;
    if (!sig && Date.now() - start > 6000) return; // carpeta vacía
    await page.waitForTimeout(100);
  }
}

async function extractList(page, limit, prevSig = '') {
  await waitListSettled(page, prevSig);
  const rows = await page.locator(SEL.listItem).evaluateAll(
    (els, { limit: max, s }) =>
      els.slice(0, max).map((el) => {
        const q = (sel) => el.querySelector(sel)?.textContent?.trim() ?? '';
        const lines = el.innerText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        return {
          id: el.getAttribute('data-element-id'),
          from: q(s.sender) || lines[0] || '',
          subject: q(s.subject) || lines[1] || '',
          time: q(s.time),
          unread: /unread/i.test(el.className) || /unread/i.test(el.getAttribute('data-testid') ?? ''),
          summary: lines.join(' | ').slice(0, 300),
        };
      }),
    { limit, s: { sender: SEL.itemSender, subject: SEL.itemSubject, time: SEL.itemTime } },
  );
  return rows.map((r) => ({ ...r, subject: cleanSubject(r.subject) }));
}

export function testLogin(account, { code } = {}) {
  return withPage(account.id, async (page) => {
    try {
      await ensureSession(page, account, { code });
      return { ok: true, status: STATUS.OK, message: 'Sesión activa' };
    } catch (err) {
      if (err instanceof ProtonError) return { ok: false, status: err.status, message: err.message };
      await setStatus(account.id, STATUS.ERROR, err.message.slice(0, 200));
      return { ok: false, status: STATUS.ERROR, message: err.message };
    }
  });
}

// IDs de etiqueta de sistema de Proton (API web).
const LABEL_IDS = { inbox: '0', all: '5', drafts: '8', sent: '7', trash: '3', spam: '4', archive: '6', starred: '10' };
const API_PAGE = 150;

/**
 * Listado masivo: una petición a la API web de Proton desde la propia sesión (cookies + cabeceras de la app).
 * Los metadatos (asunto, remitente, hora, leído) no van cifrados; el cuerpo sí, por eso se lee aparte desde el DOM.
 * Devuelve null si algo falla, para que el llamador use el scraping del DOM.
 */
async function apiList(page, { folder, unreadOnly, limit }) {
  try {
    let auth = authHeaders.get(page.context());
    if (!auth) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await poll(page, { ready: async () => Boolean(authHeaders.get(page.context())) }, 15_000);
      auth = authHeaders.get(page.context());
    }
    if (!auth) {
      console.error('[api] sin cabeceras x-pm-uid capturadas');
      return null;
    }

    const out = [];
    const seen = new Set();
    for (let n = 0; out.length < limit && n < 25; n += 1) {
      const q = new URLSearchParams({
        Page: String(n),
        PageSize: String(Math.min(API_PAGE, limit)),
        LabelID: LABEL_IDS[folder] ?? '0',
        Sort: 'Time',
        Desc: '1',
      });
      if (unreadOnly) q.set('Unread', '1');
      const res = await page.evaluate(
        async ({ url, headers }) => {
          const r = await fetch(url, { headers: { ...headers, Accept: 'application/vnd.protonmail.v1+json' }, credentials: 'include' });
          return { status: r.status, body: await r.json().catch(() => null) };
        },
        { url: `/api/mail/v4/messages?${q}`, headers: auth },
      );
      if (res.status !== 200 || !Array.isArray(res.body?.Messages)) {
        console.error('[api] respuesta inesperada', res.status, JSON.stringify(res.body)?.slice(0, 300));
        return null;
      }
      for (const m of res.body.Messages) {
        const id = m.ConversationID || m.ID; // la lista de la UI usa el id de conversación
        if (seen.has(id)) continue;
        seen.add(id);
        const from = m.Sender?.Name || m.Sender?.Address || '';
        out.push({
          id,
          messageId: m.ID,
          from,
          address: m.Sender?.Address ?? '',
          subject: m.Subject ?? '',
          time: m.Time ? new Date(m.Time * 1000).toISOString() : '',
          unread: m.Unread === 1,
          attachments: m.NumAttachments ?? 0,
          summary: `${from} | ${m.Subject ?? ''}`.slice(0, 300),
        });
      }
      if (res.body.Messages.length < Math.min(API_PAGE, limit)) break;
    }
    return out.slice(0, limit);
  } catch (err) {
    console.error('[api] error', err.message);
    return null;
  }
}

export function listEmails(account, { folder = 'inbox', unreadOnly = false, limit = 20 }) {
  return withPage(account.id, async (page) => {
    await open(page, account);
    const viaApi = await apiList(page, { folder, unreadOnly, limit });
    if (viaApi) {
      await saveList(account.id, folder, viaApi);
      return viaApi;
    }
    const slug = FOLDERS[folder] ?? FOLDERS.inbox;
    const prev = await listSignature(page);
    await navigate(page, `${URLS.mail}/${slug}${unreadOnly ? '#filter=unread' : ''}`);
    const items = await extractList(page, limit, prev);
    await saveList(account.id, folder, items);
    return items;
  });
}

export function searchEmails(account, { query, limit = 20 }) {
  return withPage(account.id, async (page) => {
    await open(page, account);
    const prev = await listSignature(page);
    await navigate(page, `${URLS.mail}/${FOLDERS.all}#keyword=${encodeURIComponent(query)}`);
    const items = await extractList(page, limit, prev);
    await saveList(account.id, 'all', items);
    return items;
  });
}

/** Busca la fila del correo en la lista (haciendo scroll para cargar más páginas) y la abre con un clic. */
async function clickRow(page, id) {
  if (!/^[\w\-=+/.~]+$/.test(id) || !page.url().startsWith(`${ORIGIN}/`)) return false;
  const row = page.locator(`${SEL.listItem.split('[data-element-id]')[0]}[data-element-id="${id}"]`).first();
  for (let i = 0; i < 12; i += 1) {
    if ((await row.count()) > 0) break;
    const last = page.locator(SEL.listItem).last();
    if ((await last.count()) === 0) return false;
    await last.scrollIntoViewIfNeeded().catch(() => {});
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(250);
  }
  if ((await row.count()) === 0) return false;
  await row.scrollIntoViewIfNeeded().catch(() => {});
  const target = row.locator(SEL.itemSubject).first();
  const subject = cleanSubject((await target.textContent({ timeout: 1500 }).catch(() => '')) ?? '');
  await ((await target.count()) ? target : row).click({ timeout: 5000 }).catch(() => {});
  return { subject };
}

const readState = new WeakMap(); // por página: último correo leído, para no confundir el panel anterior con el nuevo

async function readOne(page, account, id, folder, opts) {
  const watch = watchImages(page); // imágenes remotas que cargue el correo (se guardan cifradas junto a él)
  try {
    return await readOneInner(page, account, id, folder, opts, watch.net);
  } finally {
    watch.stop();
  }
}

/** Espera a que aparezca la vista de lectura ('mail') o el redactor de un borrador ('draft'); null si no aparece. */
async function waitForView(page, frames, timeoutMs = 20_000) {
  const start = Date.now();
  let triedDraft = false;
  while (Date.now() - start < timeoutMs) {
    if ((await frames.count()) > 0) return 'mail';
    if ((await page.locator(SEL.composerBodyIframe).count()) > 0) return 'draft';
    // en una conversación cuyo último mensaje es un borrador, este aparece plegado con la etiqueta «Borrador»: hay que pulsarlo
    if (!triedDraft && Date.now() - start > 3000) {
      triedDraft = true;
      const row = page.locator(SEL.messageRow).filter({ hasText: SEL.draftWord }).last();
      const target = (await row.count()) ? row : page.getByText(SEL.draftBadge).last();
      await target.click({ timeout: 3000 }).catch(() => {});
    }
    await page.waitForTimeout(200);
  }
  return null;
}

/** Lee un borrador abierto en el redactor (solo lectura: no se escribe nada) y lo cierra sin modificarlo. */
async function readDraft(page, account, id, listSubject) {
  const editor = page.locator(SEL.composerBodyIframe).last();
  const frame = await (await editor.elementHandle())?.contentFrame();
  let text = '';
  const start = Date.now();
  while (frame && Date.now() - start < 3000) {
    text = (await frame.locator(SEL.composerBody).innerText().catch(() => '')).trim();
    if (text) break;
    await page.waitForTimeout(200);
  }
  const subject = (await page.locator(SEL.composerSubject).last().inputValue().catch(() => '')) || listSubject;
  const to = ((await page.locator(SEL.composerTo.split(' input')[0]).last().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  await page.locator(SEL.composerClose).last().click({ timeout: 3000 }).catch(() => page.keyboard.press('Escape'));
  const messages = [text.slice(0, MAX_BODY) || '(borrador vacío)'];
  await saveBody(account.id, id, subject.trim(), messages);
  return { id, subject: subject.trim(), header: `Borrador${to ? ` · para ${to}` : ''}`.slice(0, 500), messages, has_html: false, attachments: [], cached: false };
}

async function readOneInner(page, account, id, folder, { allowGoto = true } = {}, net) {
  const slug = FOLDERS[folder] ?? FOLDERS.all;
  const prev = readState.get(page);
  // los borradores solo existen en la lista de Borradores: la fila no está en otras carpetas
  if (folder === 'drafts') {
    await navigate(page, `${URLS.mail}/${FOLDERS.drafts}`);
    await waitListSettled(page, '');
  }
  // Rápido: clic en la fila (la app ya está cargada). Respaldo: carga completa de la URL del correo.
  const clicked = await clickRow(page, id); // false | { subject }
  if (!clicked && !allowGoto) return null;
  if (!clicked) await navigate(page, `${URLS.mail}/${slug}/${encodeURIComponent(id)}`);

  const frames = page.locator(SEL.contentIframe);
  // un borrador se abre en el redactor (iframe del editor), un correo normal en la vista de lectura (content-iframe)
  const view = await waitForView(page, frames);
  if (view === 'draft') return readDraft(page, account, id, clicked?.subject ?? '');
  if (view !== 'mail') throw new ProtonError(STATUS.ERROR, 'Proton no mostró el correo (tiempo agotado). Revisa con proton_screenshot.');

  const readBodies = async () => {
    const out = [];
    for (const handle of await frames.elementHandles()) {
      const frame = await handle.contentFrame();
      if (!frame) continue;
      const text = await frame.locator('body').innerText().catch(() => '');
      if (text.trim()) out.push(text.trim().slice(0, MAX_BODY));
    }
    return out;
  };

  // el contenido llega de forma asíncrona; con navegación SPA el panel anterior sigue ahí hasta que se reemplaza
  let bodies = [];
  const start = Date.now();
  while (Date.now() - start < 8000) {
    bodies = await readBodies();
    const changed = !prev || prev.id === id || bodies.join('\n') !== prev.text;
    if (bodies.length && changed) break;
    await page.waitForTimeout(100);
  }
  readState.set(page, { id, text: bodies.join('\n') });

  // el panel de lectura no expone el asunto de forma estable: se toma de la fila de la lista (visible a la izquierda)
  let subject = clicked?.subject ?? '';
  if (!subject && /^[\w\-=+/.~]+$/.test(id)) {
    subject = await page
      .locator(`[data-element-id="${id}"]`)
      .first()
      .locator(SEL.itemSubject)
      .first()
      .textContent({ timeout: 1500 })
      .then((t) => cleanSubject(t ?? ''))
      .catch(() => '');
  }
  const header = await page.locator(SEL.messageHeader).first().innerText().catch(() => '');

  // Contenido rico (HTML, imágenes, adjuntos): solo si hay almacén. Un fallo aquí nunca rompe la lectura del texto.
  let htmls = [];
  let attachments = [];
  if (bodies.length && dbEnabled()) {
    try {
      await loadRemoteContent(page);
      await dropEmailBlobs(account.id, id);
      for (const handle of await frames.elementHandles()) {
        const frame = await handle.contentFrame();
        const text = frame ? await frame.locator('body').innerText().catch(() => '') : '';
        if (frame && text.trim()) htmls.push(await captureFrameHtml(frame, net, account.id, id));
      }
      attachments = await downloadAttachments(page, account.id, id);
    } catch (err) {
      console.error('[content]', err.message);
      htmls = [];
    }
  }
  await saveBody(account.id, id, subject.trim(), bodies, htmls);
  // Vista de correo a pantalla completa: volver a la lista con el historial de la app (sin recargar) para el siguiente.
  if (clicked) {
    await page.goBack({ waitUntil: 'commit' }).catch(() => {});
    await page.locator(SEL.listItem).first().waitFor({ timeout: 8000 }).catch(() => {});
  }
  return {
    id,
    subject: subject.trim(),
    header: header.trim().slice(0, 500),
    messages: bodies,
    has_html: htmls.some(Boolean),
    attachments: attachments.map(({ name, mime, size, stored }) => ({ name, mime, size, stored })),
    cached: false,
  };
}

const PAGE_SIZE = 50; // la lista de Proton está paginada (50 por página, URL #page=N)

/**
 * Lectura en lote por páginas: con el orden de la API se calcula en qué página de la lista cae cada correo, se abre
 * esa página y se leen (clic + volver) solo los que están en ella. La lista no hace scroll infinito, por eso no se
 * puede buscar una fila "más abajo": hay que ir a su página.
 */
async function pagedRead(page, account, wanted, hints, results, startedAt) {
  const order = await apiList(page, { folder: 'all', unreadOnly: false, limit: 3000 });
  if (!order) return;
  const position = new Map(order.map((m, i) => [m.id, i]));
  const byPage = new Map();
  for (const id of wanted) {
    if (!position.has(id)) continue;
    const p = Math.floor(position.get(id) / PAGE_SIZE) + 1;
    byPage.set(p, [...(byPage.get(p) ?? []), id]);
  }

  for (const p of [...byPage.keys()].sort((a, b) => a - b)) {
    if (Date.now() - startedAt > BATCH_DEADLINE_MS) break;
    await navigate(page, `${URLS.mail}/${FOLDERS.all}#page=${p}`);
    await waitListSettled(page, '');
    const present = new Set(
      await page.locator(SEL.listItem).evaluateAll((els) => els.map((e) => e.getAttribute('data-element-id'))),
    );
    for (const id of byPage.get(p)) {
      if (Date.now() - startedAt > BATCH_DEADLINE_MS) break;
      if (!present.has(id)) continue; // el orden de la UI puede diferir ligeramente: queda pendiente
      const r = await readOne(page, account, id, 'all', { allowGoto: false }).catch(() => null);
      if (r?.messages?.length) {
        r.subject = r.subject || hints.get(id) || '';
        results.set(id, r);
        wanted.delete(id);
      }
    }
  }
  console.error('[paged] paginas=' + byPage.size + ' pendientes=' + wanted.size + ' ms=' + (Date.now() - startedAt));
}

/** Lee uno o varios correos con una sola sesión de navegador; sirve desde PostgreSQL si ya están guardados. */
export async function readEmails(account, { ids, folder = 'all', refresh = false, hints = new Map() }) {
  const results = new Map();
  const startedAt = Date.now();
  const missing = [];
  for (const id of ids) {
    const hit = refresh ? null : await getCachedEmail(account.id, id);
    if (hit) {
      const files = await listAttachments(account.id, id);
      results.set(id, { ...hit, attachments: files.map(({ name, mime, size }) => ({ name, mime, size, stored: true })) });
    }
    else missing.push(id);
  }
  if (missing.length) {
    await withPage(account.id, async (page) => {
      await open(page, account);
      if (missing.length === 1) {
        results.set(missing[0], await readOne(page, account, missing[0], folder));
        return;
      }
      await pagedRead(page, account, new Set(missing), hints, results, startedAt);
    });
  }
  return ids.map((id) => results.get(id) ?? { id, pending: true });
}

export const readEmail = async (account, { id, folder, refresh }) => (await readEmails(account, { ids: [id], folder, refresh }))[0];

async function typeRecipients(page, addresses) {
  for (const address of addresses) {
    await page.keyboard.type(`${address},`);
  }
}

export function sendEmail(account, { to, cc = [], bcc = [], subject, body }) {
  return withPage(account.id, async (page) => {
    await open(page, account);
    if (!page.url().startsWith(`${ORIGIN}/`)) await page.goto(`${URLS.mail}/inbox`, { waitUntil: 'domcontentloaded' });

    await page.locator(SEL.compose).first().click();
    const toField = page.locator(SEL.composerTo).last();
    await toField.waitFor({ timeout: 15_000 });
    await toField.click();
    await typeRecipients(page, to);

    if (cc.length) {
      await page.locator(SEL.composerCc).first().click();
      await typeRecipients(page, cc);
    }
    if (bcc.length) {
      await page.locator(SEL.composerBcc).first().click();
      await typeRecipients(page, bcc);
    }

    await page.locator(SEL.composerSubject).last().fill(subject);

    const editor = page.frameLocator(SEL.composerBodyIframe).last().locator(SEL.composerBody);
    await editor.click();
    await page.keyboard.press('Control+Home');
    const lines = body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i]) await page.keyboard.insertText(lines[i]);
      if (i < lines.length - 1) await page.keyboard.press('Enter');
    }

    await page.locator(SEL.composerSend).last().click();
    const confirmed = await Promise.any([
      page.getByText(/message sent/i).first().waitFor({ timeout: 20_000 }),
      toField.waitFor({ state: 'detached', timeout: 20_000 }),
    ]).then(
      () => true,
      () => false,
    );
    if (!confirmed) throw new ProtonError(STATUS.ERROR, 'No se pudo confirmar el envío. Revisa la carpeta Enviados antes de reintentar.');
    return { sent: true };
  });
}

export function screenshot(account) {
  return withPage(account.id, async (page) => {
    if (page.url() === 'about:blank') {
      await page.goto(`${URLS.mail}/inbox`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    }
    return (await page.screenshot({ type: 'png' })).toString('base64');
  });
}

/** Sincroniza una carpeta: metadatos masivos por API y, opcionalmente, los cuerpos que aún no estén guardados. */
export async function syncFolder(account, { folder = 'inbox', limit = 100, withBodies = false, maxBodies = 30 }) {
  const t0 = Date.now();
  const items = await listEmails(account, { folder, limit });
  let bodies = 0;
  if (withBodies) {
    const ids = items.map((i) => i.id).filter(Boolean);
    const missing = (await missingBodyIds(account.id, ids)).slice(0, maxBodies);
    if (missing.length) {
      const hints = new Map(items.map((i) => [i.id, i.subject]));
      const read = await readEmails(account, { ids: missing, folder, refresh: true, hints });
      bodies = read.filter((r) => r?.messages?.length).length;
    }
  }
  return { folder, listed: items.length, bodies_fetched: bodies, seconds: Number(((Date.now() - t0) / 1000).toFixed(1)) };
}
