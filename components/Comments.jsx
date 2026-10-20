'use client';

import { Loader2, MessageSquare, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const when = (iso) => new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Notas internas sobre un correo. Se guardan cifradas en la BD y nunca se envían a Proton. */
export default function Comments({ accountId, emailId, initial }) {
  const [items, setItems] = useState(initial);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    const res = await fetch('/api/emails/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: accountId, id: emailId, body: text }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) return toast.error(data?.error ?? 'No se pudo guardar el comentario');
    setItems((list) => [...list, data.comment]);
    setText('');
  }

  async function remove(id) {
    const res = await fetch(`/api/emails/comments?${new URLSearchParams({ account: accountId, comment: id })}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) return toast.error('No se pudo borrar el comentario');
    setItems((list) => list.filter((c) => c.id !== id));
  }

  return (
    <section aria-label="Comentarios" className="space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquare className="h-4 w-4 text-muted-foreground" /> Comentarios
        {items.length > 0 && <span className="text-xs font-normal text-muted-foreground">({items.length})</span>}
      </h2>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin comentarios. Las notas son privadas y se guardan cifradas.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((c) => (
            <li key={c.id} className="group flex gap-3">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">{c.author.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 rounded-lg bg-muted/60 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium">{c.author}</span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    {when(c.created_at)}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100" onClick={() => remove(c.id)} aria-label="Borrar comentario">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Borrar</TooltipContent>
                    </Tooltip>
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="grid gap-2">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe una nota sobre este correo…" maxLength={4000} rows={3} />
        <Button type="submit" size="sm" className="justify-self-end" disabled={busy || !text.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Send />} Comentar
        </Button>
      </form>
    </section>
  );
}
