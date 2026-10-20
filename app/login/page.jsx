import { redirect } from 'next/navigation';
import Brand from '@/components/Brand';
import LoginForm from '@/components/LoginForm';
import ThemeToggle from '@/components/ThemeToggle';
import { sessionFromCookies } from '@/lib/guard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Iniciar sesión · Proton MCP' };

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  // Con un flujo OAuth en curso (oauth_query firmado) no se redirige: el login debe continuar la autorización
  if (!params.sig && !params.oauth_query && (await sessionFromCookies().catch(() => null))) redirect('/');

  return (
    <main className="container flex min-h-screen max-w-md flex-col justify-center gap-6 py-10">
      <div className="flex items-center justify-between">
        <Brand />
        <ThemeToggle />
      </div>
      <LoginForm />
    </main>
  );
}
