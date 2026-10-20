'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

/**
 * URL con la que Better Auth continúa un flujo OAuth en curso. Solo se sigue si es http(s) y, fuera del propio
 * origen (callback del cliente MCP), únicamente cuando la página se abrió desde una autorización OAuth firmada.
 */
function continueUrl(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw, window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.origin === window.location.origin) return url.href;
    const inOAuthFlow = new URLSearchParams(window.location.search).has('sig');
    return inOAuthFlow ? url.href : null;
  } catch {
    return null;
  }
}

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const { data, error: err } = await authClient.signIn.email({ email, password });
    if (err) {
      setBusy(false);
      setError(err.status === 429 ? 'Demasiados intentos. Espera un momento.' : 'Email o contraseña incorrectos');
      return;
    }
    // dentro de un flujo OAuth de un cliente MCP, Better Auth devuelve la URL con la que continúa la autorización
    const next = continueUrl(data?.url);
    if (next) {
      window.location.assign(next);
      return;
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Iniciar sesión</CardTitle>
        <CardDescription>Acceso de administrador al panel y a la autorización de clientes MCP.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {busy ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
