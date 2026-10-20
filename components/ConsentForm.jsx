'use client';

import { Loader2, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { authClient } from '@/lib/auth-client';

export default function ConsentForm() {
  const [clientName, setClientName] = useState('');
  const [scopes, setScopes] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setScopes((params.get('scope') ?? '').split(' ').filter(Boolean));
    const clientId = params.get('client_id');
    if (clientId) {
      authClient.oauth2
        .publicClient({ query: { client_id: clientId } })
        .then((res) => setClientName(res?.data?.client_name || clientId))
        .catch(() => setClientName(clientId));
    }
  }, []);

  async function decide(accept) {
    setBusy(accept ? 'allow' : 'deny');
    setError('');
    const { data, error: err } = await authClient.oauth2.consent({ accept });
    if (err || !data?.url) {
      setBusy('');
      setError(err?.message || 'No se pudo completar la autorización. Vuelve a iniciar la conexión desde el cliente.');
      return;
    }
    window.location.href = data.url;
  }

  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <CardTitle>{clientName ? `«${clientName}» solicita acceso` : 'Solicitud de acceso'}</CardTitle>
        <CardDescription>
          Podrá listar, buscar, leer y <strong>enviar</strong> correos de tus cuentas de Proton configuradas. Solo autoriza clientes que reconozcas.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {scopes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {scopes.map((scope) => (
              <Badge key={scope} variant="secondary">
                {scope}
              </Badge>
            ))}
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button onClick={() => decide(true)} disabled={Boolean(busy)} className="flex-1">
          {busy === 'allow' && <Loader2 className="animate-spin" />} Permitir
        </Button>
        <Button variant="outline" onClick={() => decide(false)} disabled={Boolean(busy)} className="flex-1">
          {busy === 'deny' && <Loader2 className="animate-spin" />} Denegar
        </Button>
      </CardFooter>
    </Card>
  );
}
