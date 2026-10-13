'use client';

import * as React from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';

import { Button, toast } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * A copyable shell command. The one place on this page where the visitor can
 * take something away with them, so it copies for real rather than asking them
 * to select 40 characters of monospace by hand.
 *
 * `navigator.clipboard` is unavailable on insecure origins and in some embedded
 * webviews, so the failure path is a toast that tells the truth instead of a
 * button that silently does nothing.
 */
export function CommandSnippet({ command, className }: { command: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(command);
      setCopied(true);
      toast.success('Command copied');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Could not reach the clipboard — select the command and copy it.');
    }
  }

  return (
    <div
      className={cn(
        // `rounded-lg` used to sit here and is gone rather than replaced with
        // `rounded-none`: the radius ladder is flat, so it produced no CSS
        // (docs/DESIGN.md §11) and would have silently become wrong again the day
        // somebody gave `--radius-lg` a value. A recessed well is the one place
        // this system still uses a soft shadow — `inset-shadow-well` survived the
        // brutalist rewrite because a hole in the paper is not a plane above it.
        'inset-shadow-well flex items-center gap-2 border border-border bg-muted py-1 pr-1 pl-3',
        className,
      )}
    >
      <code className="overflow-x-auto font-mono text-sm whitespace-nowrap text-foreground scrollbar-none">
        <span className="text-muted-foreground select-none">$ </span>
        {command}
      </code>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={copy}
        aria-label={`Copy the command "${command}"`}
        className="shrink-0"
      >
        {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      </Button>
    </div>
  );
}
