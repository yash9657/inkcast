'use client';

import * as React from 'react';
import { CheckIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * A radio group rendered as tiles.
 *
 * Deliberately native `<input type="radio">` inside a `<label>`: arrow-key
 * navigation, roving tab stop, form participation and screen-reader semantics
 * all come from the browser rather than from a hand-rolled `role="radiogroup"`.
 * The input is visually hidden, so the checked and focused states are expressed
 * on the label with `has-[input:checked]` / `has-[input:focus-visible]` — the
 * same ring the `focus-ring` utility applies, moved to the element that is
 * actually visible.
 *
 * State is never colour alone: a checked tile also shows a check mark.
 */

export type TileOption<T extends string> = {
  value: T;
  label: string;
  hint?: string;
  /** A small proportional or illustrative glyph above the label. */
  visual?: React.ReactNode;
  disabled?: boolean;
};

export type TileGroupProps<T extends string> = {
  name: string;
  legend: string;
  hint?: string;
  value: T;
  onValueChange: (value: T) => void;
  options: TileOption<T>[];
  /** Grid template classes; defaults to three equal columns. */
  className?: string;
};

export function TileGroup<T extends string>({
  name,
  legend,
  hint,
  value,
  onValueChange,
  options,
  className,
}: TileGroupProps<T>) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm leading-none font-medium text-foreground">{legend}</legend>
      {hint ? <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}

      <div className={cn('mt-3 grid grid-cols-3 gap-2', className)}>
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'group relative flex min-w-0 cursor-pointer flex-col items-start gap-1.5',
              'rounded-lg border border-input bg-card p-3 shadow-xs',
              'transition-[background-color,border-color] duration-fast ease-out',
              'hover:bg-accent/40',
              'has-[input:checked]:border-primary has-[input:checked]:bg-primary/8',
              'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-ring has-[input:focus-visible]:outline-offset-2',
              'has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onValueChange(option.value)}
              className="sr-only"
            />

            <CheckIcon
              aria-hidden
              className={cn(
                'absolute top-2 right-2 hidden size-3.5 text-primary',
                'group-has-[input:checked]:block',
              )}
            />

            {option.visual ? (
              <span className="flex h-10 items-center justify-start">{option.visual}</span>
            ) : null}

            <span className="text-sm font-medium text-foreground">{option.label}</span>
            {option.hint ? (
              <span className="text-xs leading-snug text-muted-foreground">{option.hint}</span>
            ) : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The proportional rectangle used by the aspect picker. */
export function AspectGlyph({ glyph }: { glyph: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'block rounded-xs border-2 border-current text-input',
        'transition-colors duration-fast ease-out',
        'group-has-[input:checked]:text-primary',
        glyph,
      )}
    />
  );
}
