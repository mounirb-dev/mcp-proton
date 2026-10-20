'use client';

import { Download, Loader2, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

async function post(url, payload) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => null);
  const data = await res?.json().catch(() => ({}));
  if (!res?.ok) throw new Error(data?.error ?? 'Error de red');
  return data;
}

/** Trae de Proton los correos recientes de la carpeta (metadatos). Con "Todas las cuentas" sincroniza cada una. */
export function SyncButton({ accountIds, folder }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function sync() {
    setBusy(true);
    let listed = 0;
    for (const account of accountIds) {
      try {
        listed += (await post('/api/emails/sync', { account, folder: folder || 'inbox' })).listed ?? 0;
      } catch (err) {
        toast.error(err.message);
      }
    }
    setBusy(false);
    toast.success(`Sincronizado: ${listed} correos`);
    router.refresh();
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon" onClick={sync} disabled={busy || accountIds.length === 0} aria-label="Sincronizar con Proton">
          <RefreshCw className={busy ? 'animate-spin' : ''} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Sincronizar con Proton</TooltipContent>
    </Tooltip>
  );
}

/** Lee el correo en vivo desde Proton y guarda cuerpo, HTML, imágenes y adjuntos. */
export function ReadNowButton({ accountId, emailId, variant = 'default', label = 'Leer desde Proton' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function read() {
    setBusy(true);
    try {
      await post('/api/emails/read', { account: accountId, id: emailId });
      router.refresh();
    } catch (err) {
      toast.error(err.message);
    }
    setBusy(false);
  }

  return (
    <Button variant={variant} size="sm" onClick={read} disabled={busy}>
      {busy ? <Loader2 className="animate-spin" /> : variant === 'default' ? <Download /> : <RefreshCw />} {busy ? 'Leyendo…' : label}
    </Button>
  );
}
