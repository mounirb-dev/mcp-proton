'use client';

import { Link2, Loader2, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const providers = [
  { id: 'google', label: 'Conectar Gmail' },
  { id: 'microsoft', label: 'Conectar Outlook / Microsoft 365' },
];

export default function OAuthConnectionsCard() {
  const [connections, setConnections] = useState(null);
  const [busy, setBusy] = useState('');

  async function load() {
    const response = await fetch('/api/email/connections', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    setConnections(data.connections || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(id) {
    if (!confirm('¿Desconectar esta cuenta?')) return;
    setBusy(id);
    const response = await fetch(`/api/email/connections/${id}`, { method: 'DELETE' });
    setBusy('');
    if (!response.ok) toast.error('No se pudo desconectar');
    else {
      toast.success('Cuenta desconectada');
      load();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conexiones OAuth</CardTitle>
        <CardDescription>Conecta Gmail o Outlook sin guardar contraseñas. Los tokens se cifran en el servidor.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          {providers.map((provider) => (
            <Button key={provider.id} variant="outline" asChild>
              <a href={`/api/oauth/${provider.id}/start`}><Link2 /> {provider.label}</a>
            </Button>
          ))}
        </div>
        {connections === null ? <Loader2 className="animate-spin" /> : connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay cuentas OAuth conectadas.</p>
        ) : connections.map((connection) => (
          <div key={connection.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <div className="font-medium">{connection.email}</div>
              <div className="flex gap-2 text-xs text-muted-foreground"><Badge variant="secondary">{connection.provider}</Badge>{connection.displayName}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => remove(connection.id)} disabled={busy === connection.id} aria-label="Desconectar">
              {busy === connection.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
            </Button>
          </div>
        ))}
        <Alert><AlertDescription>Para enviar con una conexión OAuth usa <code>/api/v1/email/send</code> con <code>connectionType: &quot;oauth&quot;</code>.</AlertDescription></Alert>
      </CardContent>
    </Card>
  );
}
