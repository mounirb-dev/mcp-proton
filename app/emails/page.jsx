import { Archive, ArrowLeft, FileText, Inbox, Mails, MessageSquare, Paperclip, Search, Send, ShieldAlert, Star, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import Brand from '@/components/Brand';
import Comments from '@/components/Comments';
import ComposeDialog from '@/components/ComposeDialog';
import { ReadNowButton, SyncButton } from '@/components/MailActions';
import ThemeToggle from '@/components/ThemeToggle';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { listAccounts } from '@/lib/accounts';
import { assertConfigured } from '@/lib/config';
import { commentCounts, dbEnabled, getEmail, listComments, queryEmails } from '@/lib/db';
import { sessionFromCookies } from '@/lib/guard';
import { listAttachments } from '@/lib/storage';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Correos · Proton MCP' };

const PAGE = 50;
const FOLDERS = [
  { id: '', label: 'Todos', icon: Mails },
  { id: 'inbox', label: 'Recibidos', icon: Inbox },
  { id: 'starred', label: 'Destacados', icon: Star },
  { id: 'sent', label: 'Enviados', icon: Send },
  { id: 'drafts', label: 'Borradores', icon: FileText },
  { id: 'archive', label: 'Archivo', icon: Archive },
  { id: 'spam', label: 'Spam', icon: ShieldAlert },
  { id: 'trash', label: 'Papelera', icon: Trash2 },
];

const first = (v) => (Array.isArray(v) ? v[0] : v) ?? '';
const initial = (s) => (s || '?').trim().charAt(0).toUpperCase() || '?';
const formatSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function shortTime(t) {
  if (!t) return '';
  const s = String(t);
  const d = new Date(s);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s) || Number.isNaN(+d)) return s.slice(0, 16);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

function longTime(t) {
  const d = new Date(String(t));
  return /^\d{4}-\d{2}-\d{2}/.test(String(t)) && !Number.isNaN(+d) ? d.toLocaleString('es', { dateStyle: 'long', timeStyle: 'short' }) : String(t ?? '');
}

export default async function Emails({ searchParams }) {
  try {
    assertConfigured();
  } catch (err) {
    return (
      <main className="container max-w-md py-16">
        <Alert variant="destructive">
          <AlertDescription>{err.message}</AlertDescription>
        </Alert>
      </main>
    );
  }
  if (!(await sessionFromCookies())) redirect('/login');

  const sp = await searchParams;
  const q = first(sp.q).slice(0, 200);
  const folder = FOLDERS.some((f) => f.id === first(sp.folder)) ? first(sp.folder) : '';
  const unreadOnly = first(sp.unread) === '1';
  const limit = Math.min(Math.max(Number.parseInt(first(sp.limit), 10) || PAGE, PAGE), 500);
  const accounts = await listAccounts();
  const names = Object.fromEntries(accounts.map((a) => [a.id, a.email]));
  const accountId = names[first(sp.account)] ? first(sp.account) : '';
  const selAccount = names[first(sp.sa)] ? first(sp.sa) : '';
  const selId = first(sp.id);

  const base = { account: accountId, folder, q, unread: unreadOnly ? '1' : '', limit: limit > PAGE ? String(limit) : '' };
  const href = (over = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/emails?${s}` : '/emails';
  };

  let rows = [];
  let error = '';
  const enabled = dbEnabled();
  if (enabled) {
    try {
      rows = await queryEmails({ accountId: accountId || undefined, query: q || undefined, folder: folder || undefined, unreadOnly, limit });
    } catch (err) {
      error = err.message;
    }
  }

  const [counts, selected] = await Promise.all([
    enabled ? commentCounts() : {},
    enabled && selAccount && selId ? getEmail(selAccount, selId) : null,
  ]);
  const [files, comments] = selected
    ? await Promise.all([listAttachments(selAccount, selId), listComments(selAccount, selId)])
    : [[], []];
  const messages = selected ? (selected.body ?? '').split('\n\n---\n\n') : [];

  const rail = (
    <nav aria-label="Carpetas" className="flex gap-1 md:flex-col">
      {FOLDERS.map(({ id, label, icon: Icon }) => (
        <Link
          key={id || 'all'}
          href={href({ folder: id, id: '', sa: '' })}
          className={cn(
            'flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted',
            folder === id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
          )}
        >
          <Icon className="h-4 w-4" /> {label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b bg-background/80 px-4 py-2.5 backdrop-blur">
        <Brand />
        <form method="GET" action="/emails" className="relative order-last w-full md:order-none md:w-auto md:flex-1 md:max-w-xl md:mx-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} placeholder="Buscar en remitente, asunto y cuerpo…" className="pl-9" />
          {accountId && <input type="hidden" name="account" value={accountId} />}
          {folder && <input type="hidden" name="folder" value={folder} />}
          {unreadOnly && <input type="hidden" name="unread" value="1" />}
        </form>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <ComposeDialog accounts={accounts.map((a) => ({ id: a.id, email: a.email }))} defaultAccount={accountId} />
          <SyncButton accountIds={accountId ? [accountId] : accounts.map((a) => a.id)} folder={folder} />
          <ThemeToggle />
          <Link href="/" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
            <ArrowLeft /> Panel
          </Link>
        </div>
      </header>

      {!enabled || error ? (
        <div className="p-6">
          <Alert variant={error ? 'destructive' : 'default'} className="mx-auto max-w-lg">
            <AlertDescription>{error || 'Almacén desactivado: define DATABASE_URL para guardar y consultar correos.'}</AlertDescription>
          </Alert>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[13.5rem_minmax(0,22rem)_minmax(0,1fr)] md:grid-rows-1">
          {/* columna 1: cuentas y carpetas */}
          <aside className="space-y-4 overflow-x-auto border-b p-2 md:overflow-y-auto md:border-b-0 md:border-r md:p-3">
            <div className="md:hidden">{rail}</div>
            <div className="hidden space-y-4 md:block">
              {rail}
              <Separator />
              <div className="space-y-1">
                <p className="px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Cuentas</p>
                <Link
                  href={href({ account: '', id: '', sa: '' })}
                  className={cn('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-muted', !accountId ? 'bg-accent text-accent-foreground' : 'text-muted-foreground')}
                >
                  Todas
                </Link>
                {accounts.map((a) => (
                  <Link
                    key={a.id}
                    href={href({ account: a.id, id: '', sa: '' })}
                    className={cn('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-muted', accountId === a.id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground')}
                  >
                    <Avatar className="h-5 w-5">
                      <AvatarFallback className="text-[10px]">{initial(a.email)}</AvatarFallback>
                    </Avatar>
                    <span className="truncate">{a.email}</span>
                  </Link>
                ))}
              </div>
              <Separator />
              <Link
                href={href({ unread: unreadOnly ? '' : '1', id: '', sa: '' })}
                className={cn('flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-muted', unreadOnly ? 'bg-accent text-accent-foreground' : 'text-muted-foreground')}
              >
                Solo no leídos {unreadOnly && <Badge variant="secondary">activo</Badge>}
              </Link>
            </div>
          </aside>

          {/* columna 2: lista */}
          <section className={cn('min-h-0 border-r', selected && 'hidden md:block')} aria-label="Lista de correos">
            <ScrollArea className="h-full">
              {rows.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  {q ? `Sin resultados para «${q}».` : 'Sin correos. Pulsa el botón de sincronizar de la cabecera para traerlos de Proton.'}
                </p>
              ) : (
                <ul>
                  {rows.map((r) => {
                    const active = selAccount === r.account_id && selId === r.id;
                    const n = counts[`${r.account_id}:${r.id}`];
                    return (
                      <li key={`${r.account_id}:${r.id}`}>
                        <Link
                          href={href({ sa: r.account_id, id: r.id })}
                          className={cn('flex gap-3 border-b px-3 py-3 transition-colors hover:bg-muted/60', active && 'bg-accent/70')}
                        >
                          <Avatar className="mt-0.5 h-9 w-9 shrink-0">
                            <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">{initial(r.from)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className={cn('truncate text-sm', r.unread ? 'font-semibold' : 'font-medium')}>{r.from || '(sin remitente)'}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">{shortTime(r.time)}</span>
                            </div>
                            <div className={cn('truncate text-sm', r.unread ? 'text-foreground' : 'text-muted-foreground')}>
                              {r.unread && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-primary align-middle" />}
                              {r.subject || '(sin asunto)'}
                            </div>
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
                                {r.folder}
                              </Badge>
                              {!accountId && accounts.length > 1 && (
                                <span className="truncate text-[11px] text-muted-foreground">{names[r.account_id]}</span>
                              )}
                              {n > 0 && (
                                <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                                  <MessageSquare className="h-3 w-3" /> {n}
                                </span>
                              )}
                            </div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              {rows.length >= limit && (
                <div className="p-3 text-center">
                  <Link href={href({ limit: String(limit + PAGE) })} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
                    Cargar más
                  </Link>
                </div>
              )}
              {rows.length > 0 && <p className="pb-3 text-center text-xs text-muted-foreground">{rows.length} correo{rows.length === 1 ? '' : 's'}</p>}
            </ScrollArea>
          </section>

          {/* columna 3: lector */}
          <article className={cn('min-h-0 overflow-y-auto', !selected && 'hidden md:block')} aria-label="Correo">
            {!selected ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                  <Mails className="h-6 w-6" />
                </span>
                <p className="text-sm">{selId ? 'No se encontró este correo en el almacén. Sincroniza la carpeta e inténtalo de nuevo.' : 'Elige un correo para leerlo.'}</p>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
                <Link href={href({ id: '', sa: '' })} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'md:hidden')}>
                  <ArrowLeft /> Volver
                </Link>

                <header className="space-y-4">
                  <h1 className="text-xl font-semibold leading-tight tracking-tight md:text-2xl">{selected.subject || '(sin asunto)'}</h1>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-primary/10 font-semibold text-primary">{initial(selected.from)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{selected.from || '(sin remitente)'}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        para {names[selAccount]} · {longTime(selected.time)}
                      </div>
                    </div>
                    <Badge variant="outline">{selected.folder}</Badge>
                    {selected.body && <ReadNowButton accountId={selAccount} emailId={selId} variant="outline" label="Actualizar" />}
                  </div>
                </header>

                <Separator />

                <div className="space-y-3">
                  {!selected.body ? (
                    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
                      <p className="text-sm text-muted-foreground">El cuerpo de este correo aún no está guardado. Se lee desde Proton y se guarda cifrado.</p>
                      <ReadNowButton accountId={selAccount} emailId={selId} />
                    </div>
                  ) : selected.has_html ? (
                    messages.map((_, n) => (
                      <iframe
                        // biome-ignore lint/suspicious/noArrayIndexKey: los mensajes de una conversación no tienen otro id
                        key={n}
                        title={`Mensaje ${n + 1}`}
                        // sin allow-scripts nada se ejecuta; la CSP `sandbox` de la ruta mantiene el documento en origen opaco
                        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                        referrerPolicy="no-referrer"
                        src={`/api/emails/html?${new URLSearchParams({ account: selAccount, id: selId, n: String(n) })}`}
                        className="h-[60vh] min-h-80 w-full rounded-lg border bg-white shadow-sm"
                      />
                    ))
                  ) : (
                    <pre className="whitespace-pre-wrap break-words rounded-lg border bg-card p-4 font-sans text-sm leading-relaxed">{selected.body || selected.summary}</pre>
                  )}
                </div>

                {files.length > 0 && (
                  <div className="space-y-2">
                    <h2 className="flex items-center gap-2 text-sm font-semibold">
                      <Paperclip className="h-4 w-4 text-muted-foreground" /> Adjuntos ({files.length})
                    </h2>
                    <ul className="flex flex-wrap gap-2">
                      {files.map((f) => (
                        <li key={f.blob_id}>
                          <a
                            href={`/api/emails/file?${new URLSearchParams({ account: selAccount, id: f.blob_id })}`}
                            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                          >
                            {f.name} <span className="text-xs text-muted-foreground">{formatSize(f.size)}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Separator />
                <Comments key={`${selAccount}:${selId}`} accountId={selAccount} emailId={selId} initial={comments.map((c) => ({ ...c, created_at: new Date(c.created_at).toISOString() }))} />
              </div>
            )}
          </article>
        </div>
      )}
    </div>
  );
}
