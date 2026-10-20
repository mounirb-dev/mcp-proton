import { redirect } from 'next/navigation';
import Brand from '@/components/Brand';
import ConsentForm from '@/components/ConsentForm';
import { sessionFromCookies } from '@/lib/guard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Autorizar acceso · Proton MCP' };

export default async function ConsentPage() {
  if (!(await sessionFromCookies().catch(() => null))) redirect('/login');
  return (
    <main className="container flex min-h-screen max-w-md flex-col justify-center gap-6 py-10">
      <Brand />
      <ConsentForm />
    </main>
  );
}
