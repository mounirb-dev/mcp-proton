'use client';

import { Camera, CloudDownload, Loader2, LogIn, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const STATUS = {
  new: { label: 'Sin verificar', variant: 'secondary' },
  ok: { label: 'Sesión activa', variant: 'success' },
  needs_2fa: { label: 'Requiere 2FA', variant: 'warning' },
  needs_attention: { label: 'Requiere atención', variant: 'warning' },
  error: { label: 'Error', variant: 'destructive' },
};

export default function AccountCard({ account, storage = false, stored = 0 }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [code, setCode] = useState('');
  const [shot, setShot] = useState(0);
  const [checked, setChecked] = useState('');
  const [synced, setSynced] = useState('');

  useEffect(() => {
    setChecked(account.lastCheckedAt ? new Date(account.lastCheckedAt).toLocaleString('es') : '');
    setSynced(account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString('es') : '');
  }, [account.lastCheckedAt, account.lastSyncAt]);

  const status = STATUS[account.status] ?? STATUS.new;
  const id = encodeURIComponent(account.id);

  async function call(kind, path, init, onOk) {
    setBusy(kind);
    try {
      const res = await fetch(`/api/admin/accounts/${id}${path}`, init);
      const data = await res.json().catch(() => ({}));
      onOk(res, data);
    } catch {
      toast.error('Error de red');
    }
    setBusy('');
    router.refresh();
  }

  const test = () =>
    call(
      'test',
      '/test',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code || undefined }) },
      (_res, data) => {
        if (data.ok) {
          setCode('');
          toast.success('Sesión de Proton activa');
        } else toast.error(data.message || 'No se pudo iniciar sesión');
      },
    );

  const sync = () =>
    call('sync', '/sync', { method: 'POST' }, (res, data) => {
      if (!res.ok) return toast.error(data.error || 'No se pudo sincronizar');
      const detail = Object.entries(data.folders ?? {})
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ');
      toast.success(`${data.synced} correos sincronizados`, { description: detail });
    });

  const toggleAuto = (checked) =>
    call(
      'auto',
      '',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoSync: checked }) },
      (res) => {
        if (res.ok) toast.success(checked ? 'Sincronización automática activada' : 'Sincronización automática desactivada');
        else toast.error('No se pudo cambiar');
      },
    );

  async function remove() {
    if (!confirm(`¿Eliminar ${account.email}? Se borran sus credenciales y los correos guardados.`)) return;
    await call('remove', '', { method: 'DELETE' }, () => toast.success('Cuenta eliminada'));
  }

  return (
    <div className="grid gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{account.email}</div>
          <div className="text-sm text-muted-foreground">
            {account.label}
            {account.hasTotp ? ' · TOTP configurado' : ''}
          </div>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      <p className="text-sm text-muted-foreground">
        {account.statusMessage}
        {checked ? ` · ${checked}` : ''}
      </p>

      {storage && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2">
          <div className="min-w-0 text-xs text-muted-foreground">
            {account.lastSyncAt ? (
              <>
                Última sincronización {synced}
                {account.lastSyncNote ? <span className="block truncate">{account.lastSyncNote}</span> : null}
              </>
            ) : (
              'Aún sin sincronizar'
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Label htmlFor={`auto-${account.id}`} className="text-xs">
              Automática
            </Label>
            <Switch id={`auto-${account.id}`} checked={account.autoSync} onCheckedChange={toggleAuto} disabled={Boolean(busy)} />
          </div>
        </div>
      )}

      {account.status === 'needs_2fa' && (
        <div className="grid gap-2">
          <Label htmlFor={`code-${account.id}`}>Código 2FA actual</Label>
          <Input id={`code-${account.id}`} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="123456" autoComplete="one-time-code" />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={test} disabled={Boolean(busy)}>
          {busy === 'test' ? <Loader2 className="animate-spin" /> : <LogIn />} Probar login
        </Button>
        {storage && (
          <Button size="sm" variant="outline" onClick={sync} disabled={Boolean(busy)}>
            {busy === 'sync' ? <Loader2 className="animate-spin" /> : <CloudDownload />} Sincronizar ({stored})
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setShot(Date.now())} disabled={Boolean(busy)}>
          <Camera /> Captura
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={remove} disabled={Boolean(busy)}>
          {busy === 'remove' ? <Loader2 className="animate-spin" /> : <Trash2 />} Eliminar
        </Button>
      </div>

      <Dialog open={shot > 0} onOpenChange={(open) => !open && setShot(0)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Captura del navegador</DialogTitle>
            <DialogDescription>Estado actual de la sesión de {account.email} (útil para captcha o 2FA).</DialogDescription>
          </DialogHeader>
          {shot > 0 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="w-full rounded-md border" src={`/api/admin/accounts/${id}/screenshot?t=${Number(shot)}`} alt="Captura del navegador" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
