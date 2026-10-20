import './globals.css';
import Providers from '@/components/Providers';
import { Toaster } from '@/components/ui/sonner';

export const metadata = {
  title: 'Proton MCP',
  description: 'Servidor MCP para leer y enviar correos de cuentas gratuitas de Proton Mail',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="min-h-screen">
        <Providers>
          {children}
          <Toaster richColors position="top-right" />
        </Providers>
      </body>
    </html>
  );
}
