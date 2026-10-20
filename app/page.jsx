import { Database, KeyRound, Mail } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import AccountCard from '@/components/AccountCard';
import AddAccountDialog from '@/components/AddAccountDialog';
import ApiKeysCard from '@/components/ApiKeysCard';
import OAuthConnectionsCard from '@/components/OAuthConnectionsCard';
import Brand from '@/components/Brand';
import ComposeDialog from '@/components/ComposeDialog';
import ConnectedApps from '@/components/ConnectedApps';
import CopyField from '@/components/CopyField';
import UserMenu from '@/components/UserMenu';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { listAccounts } from '@/lib/accounts';
import { mcpResource } from '@/lib/auth';
import { assertConfigured } from '@/lib/config';
import { dbEnabled, emailStats } from '@/lib/db';
import { sessionFromCookies } from '@/lib/guard';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function Home() {
  try {
    assertConfigured();
  } catch (err) {
    return (
      <main className="container max-w-md py-16">
        <Alert variant="destructive">
          <AlertTitle>Falta configuración</AlertTitle>
          <AlertDescription>{err.message}</AlertDescription>
        </Alert>
      </main>
    );
  }

  const session = await sessionFromCookies();
  if (!session) redirect('/login');

  const [accounts, stats] = await Promise.all([listAccounts(), emailStats()]);
  const storage = dbEnabled();
  const mcpUrl = mcpResource();

  return (
    <main className="container max-w-4xl space-y-6 py-8">
      <header className="flex items-center justify-between gap-4">
        <Brand />
        <UserMenu email={session.user.email} />
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Conectar con Claude</CardTitle>
          <CardDescription>
            En Claude: Ajustes → Conectores → <strong>Añadir conector personalizado</strong> → pega esta URL. Se te pedirá iniciar sesión y
            autorizar el acceso.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CopyField value={mcpUrl} label="URL del servidor MCP" />
        </CardContent>
      </Card>

      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">
            <Mail className="mr-2 h-4 w-4" /> Cuentas
          </TabsTrigger>
          <TabsTrigger value="access">
            <KeyRound className="mr-2 h-4 w-4" /> Acceso
          </TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="space-y-4">
          <Card>
            <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1.5">
                <CardTitle>Cuentas de Proton</CardTitle>
                <CardDescription>Cada cuenta usa su propio perfil de navegador, que se abre bajo demanda.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {storage && <ComposeDialog accounts={accounts.map((a) => ({ id: a.id, email: a.email }))} />}
                {storage && (
                  <Link href="/emails" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
                    <Database /> Abrir correo
                  </Link>
                )}
                <AddAccountDialog />
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              {accounts.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Aún no hay cuentas. Añade la primera con el botón de arriba.</p>
              ) : (
                accounts.map((account) => (
                  <AccountCard key={account.id} account={account} storage={storage} stored={stats?.[account.id]?.total ?? 0} />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="access" className="space-y-4">
          <OAuthConnectionsCard />
          <ApiKeysCard mcpUrl={mcpUrl} />
          <ConnectedApps />
        </TabsContent>
      </Tabs>
    </main>
  );
}
