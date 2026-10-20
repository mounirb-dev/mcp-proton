'use client';

import { KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import CopyField from '@/components/CopyField';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { authClient } from '@/lib/auth-client';

const DAY = 60 * 60 * 24;
const EXPIRATIONS = [
  { label: 'Nunca', value: 'never' },
  { label: '30 días', value: String(30 * DAY) },
  { label: '90 días', value: String(90 * DAY) },
  { label: '1 año', value: String(365 * DAY) },
];

export default function ApiKeysCard({ mcpUrl }) {
  const [keys, setKeys] = useState(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [expiresIn, setExpiresIn] = useState('never');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await authClient.apiKey.list();
    if (error) toast.error('No se pudieron cargar las API keys');
    setKeys(data?.apiKeys ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    const { data, error } = await authClient.apiKey.create({ name, expiresIn: expiresIn === 'never' ? undefined : Number(expiresIn) });
    setBusy(false);
    if (error || !data?.key) {
      toast.error(error?.message || 'No se pudo crear la API key');
      return;
    }
    setCreated(data.key);
    setName('');
    setExpiresIn('never');
    load();
  }

  async function remove(key) {
    if (!confirm(`¿Revocar la API key «${key.name}»? Los clientes que la usen dejarán de funcionar.`)) return;
    const { error } = await authClient.apiKey.delete({ keyId: key.id });
    if (error) toast.error(error.message || 'No se pudo revocar');
    else toast.success('API key revocada');
    load();
  }

  return (
    <Card>
      <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            Para clientes sin OAuth: envía la clave en <code className="rounded bg-muted px-1">x-api-key</code> o como{' '}
            <code className="rounded bg-muted px-1">Authorization: Bearer</code>.
          </CardDescription>
        </div>
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setCreated(null);
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus /> Nueva clave
            </Button>
          </DialogTrigger>
          <DialogContent>
            {created ? (
              <>
                <DialogHeader>
                  <DialogTitle>Clave creada</DialogTitle>
                  <DialogDescription>Cópiala ahora: no se vuelve a mostrar.</DialogDescription>
                </DialogHeader>
                <CopyField value={created} label="API key" />
                <Alert>
                  <AlertTitle>Ejemplo con Claude Code</AlertTitle>
                  <AlertDescription>
                    <code className="block break-all text-xs">
                      claude mcp add --transport http proton {mcpUrl} --header "x-api-key: {created}"
                    </code>
                  </AlertDescription>
                </Alert>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>Nueva API key</DialogTitle>
                  <DialogDescription>Da acceso completo a las herramientas MCP. Ponle un nombre que identifique al cliente.</DialogDescription>
                </DialogHeader>
                <form onSubmit={create} className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="key-name">Nombre</Label>
                    <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="claude-code-portátil" required maxLength={60} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="key-exp">Caduca</Label>
                    <Select value={expiresIn} onValueChange={setExpiresIn}>
                      <SelectTrigger id="key-exp">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPIRATIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" disabled={busy}>
                    {busy && <Loader2 className="animate-spin" />} Crear clave
                  </Button>
                </form>
              </>
            )}
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="grid gap-2">
        {keys === null ? (
          <Skeleton className="h-14 w-full" />
        ) : keys.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Aún no has creado ninguna API key.</p>
        ) : (
          keys.map((key) => (
            <div key={key.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="flex min-w-0 items-center gap-3">
                <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{key.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {key.start ? `${key.start}… · ` : ''}
                    creada {new Date(key.createdAt).toLocaleDateString('es')}
                    {key.expiresAt ? ` · caduca ${new Date(key.expiresAt).toLocaleDateString('es')}` : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {key.enabled === false && <Badge variant="secondary">Desactivada</Badge>}
                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => remove(key)} aria-label={`Revocar ${key.name}`}>
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
