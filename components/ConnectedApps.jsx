'use client';

import { Plug, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { authClient } from '@/lib/auth-client';

export default function ConnectedApps() {
  const [apps, setApps] = useState(null);

  const load = useCallback(async () => {
    const { data } = await authClient.oauth2.getConsents();
    const list = Array.isArray(data) ? data : [];
    const named = await Promise.all(
      list.map(async (consent) => {
        const res = await authClient.oauth2.publicClient({ query: { client_id: consent.clientId } }).catch(() => null);
        return { ...consent, name: res?.data?.client_name || consent.clientId };
      }),
    );
    setApps(named);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(app) {
    if (!confirm(`¿Revocar el acceso de «${app.name}»?`)) return;
    const { error } = await authClient.oauth2.deleteConsent({ id: app.id });
    if (error) toast.error(error.message || 'No se pudo revocar');
    else toast.success('Acceso revocado');
    load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Apps conectadas por OAuth</CardTitle>
        <CardDescription>Clientes MCP (como Claude) a los que has dado permiso desde la pantalla de autorización.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {apps === null ? (
          <Skeleton className="h-14 w-full" />
        ) : apps.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Ningún cliente se ha conectado todavía.</p>
        ) : (
          apps.map((app) => (
            <div key={app.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="flex min-w-0 items-center gap-3">
                <Plug className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{app.name}</div>
                  <div className="text-xs text-muted-foreground">Autorizada {new Date(app.createdAt).toLocaleDateString('es')}</div>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => revoke(app)} aria-label={`Revocar ${app.name}`}>
                <Trash2 />
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
