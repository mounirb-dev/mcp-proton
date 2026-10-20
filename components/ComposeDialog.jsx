'use client';

import { Loader2, PenSquare, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const split = (s) => s.split(/[,;\s]+/).filter(Boolean);

/** Redactor de correo: envía desde la cuenta elegida automatizando el redactor web de Proton (texto plano). */
export default function ComposeDialog({ accounts, defaultAccount = '' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState(defaultAccount || accounts[0]?.id || '');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [extra, setExtra] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/emails/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, to: split(to), cc: split(cc), bcc: split(bcc), subject, body }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) return setError(data?.error ?? 'Error de red');
    toast.success('Correo enviado', { description: `Para ${data.to.join(', ')}` });
    setTo('');
    setCc('');
    setBcc('');
    setSubject('');
    setBody('');
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={accounts.length === 0}>
          <PenSquare /> Redactar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nuevo correo</DialogTitle>
          <DialogDescription>Se envía desde Proton en texto plano. Una vez enviado no se puede deshacer.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          {accounts.length > 1 && (
            <div className="grid gap-1.5">
              <Label htmlFor="mail-from">De</Label>
              <Select value={account} onValueChange={setAccount}>
                <SelectTrigger id="mail-from">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="mail-to">Para</Label>
              {!extra && (
                <button type="button" onClick={() => setExtra(true)} className="text-xs text-muted-foreground hover:text-foreground">
                  Cc / Cco
                </button>
              )}
            </div>
            <Input id="mail-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="ana@ejemplo.com, luis@ejemplo.com" required autoComplete="off" />
          </div>
          {extra && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="mail-cc">Cc</Label>
                <Input id="mail-cc" value={cc} onChange={(e) => setCc(e.target.value)} autoComplete="off" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="mail-bcc">Cco</Label>
                <Input id="mail-bcc" value={bcc} onChange={(e) => setBcc(e.target.value)} autoComplete="off" />
              </div>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="mail-subject">Asunto</Label>
            <Input id="mail-subject" value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={300} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mail-body">Mensaje</Label>
            <Textarea id="mail-body" value={body} onChange={(e) => setBody(e.target.value)} rows={10} required maxLength={50000} />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={busy || !account}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />} {busy ? 'Enviando… (puede tardar unos segundos)' : 'Enviar'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
