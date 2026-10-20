'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function CopyField({ value, label = 'valor' }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copiado`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('No se pudo copiar: selecciona el texto manualmente');
    }
  }

  return (
    <div className="flex gap-2">
      <Input readOnly value={value} onFocus={(e) => e.target.select()} aria-label={label} className="font-mono text-xs" />
      <Button type="button" variant="outline" size="icon" onClick={copy} aria-label={`Copiar ${label}`}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}
