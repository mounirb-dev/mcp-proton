'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import ThemeToggle from '@/components/ThemeToggle';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { authClient } from '@/lib/auth-client';

export default function UserMenu({ email }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <ThemeToggle />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-9 gap-2 px-1.5" aria-label="Menú de usuario">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">{email.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="hidden max-w-40 truncate text-sm font-normal sm:inline">{email}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={async () => {
              await authClient.signOut();
              router.replace('/login');
              router.refresh();
            }}
          >
            <LogOut className="mr-2 h-4 w-4" /> Salir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
