import { Mail } from 'lucide-react';

export default function Brand() {
  return (
    <div className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-violet-500 text-primary-foreground shadow-sm">
        <Mail className="h-4 w-4" />
      </span>
      Proton MCP
    </div>
  );
}
