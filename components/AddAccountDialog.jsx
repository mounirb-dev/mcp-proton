'use client';

import { Loader2, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const EMPTY = { label: '', email: '', password: '', totpSecret: '' };

export default function AddAccountDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/admin/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'No se pudo añadir la cuenta');
      return;
    }
    setForm(EMPTY);
    setOpen(false);
    toast.success('Cuenta añadida', { description: 'Pulsa «Probar login» para verificarla.' });
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Añadir cuenta
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Añadir cuenta de Proton</DialogTitle>
          <DialogDescription>Las credenciales se guardan cifradas (AES-256-GCM) en el volumen del servidor.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="acc-email">Email de Proton</Label>
            <Input id="acc-email" type="email" value={form.email} onChange={set('email')} placeholder="tu@proton.me" required autoComplete="off" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="acc-pass">Contraseña</Label>
            <Input id="acc-pass" type="password" value={form.password} onChange={set('password')} required autoComplete="new-password" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="acc-label">Etiqueta (opcional)</Label>
              <Input id="acc-label" value={form.label} onChange={set('label')} placeholder="personal" autoComplete="off" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="acc-totp">Secreto TOTP (si tiene 2FA)</Label>
              <Input id="acc-totp" value={form.totpSecret} onChange={set('totpSecret')} placeholder="JBSWY3DP…" autoComplete="off" />
            </div>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Guardar cuenta
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
