'use client';

import * as React from 'react';
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn, type WithClass } from '@/lib/utils';

/**
 * The button.
 *
 * Built on Base UI's `Button`, which gives correct `disabled` semantics for
 * non-native elements and a `render` prop for composition — so a link that
 * looks like a button is one prop, not a wrapper:
 *
 *   <Button render={<Link href="/studio" />}>Open studio</Button>
 *
 * Hierarchy, strongest to quietest: `default` (one per view) -> `secondary` ->
 * `outline` -> `ghost` -> `link`. `destructive` is orthogonal and only for
 * actions that lose work.
 */
const buttonVariants = cva(
  [
    'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap',
    'rounded-md font-medium',
    'transition-[background-color,border-color,color,box-shadow,opacity,scale] duration-fast ease-out',
    'focus-ring outline-none',
    'disabled:pointer-events-none disabled:opacity-50',
    // A 1.5% press. Enough to register as a physical acknowledgement, small
    // enough that you notice it without seeing it.
    'active:scale-[0.985]',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-primary hover:bg-primary/90 active:bg-primary/95',
        secondary:
          'bg-secondary text-secondary-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
        outline:
          'border border-input bg-card text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
      },
      size: {
        xs: 'h-7 gap-1.5 px-2.5 text-xs',
        sm: 'h-8 px-3 text-sm',
        default: 'h-9 px-4',
        lg: 'h-11 px-6 text-md',
        'icon-xs': 'size-7',
        'icon-sm': 'size-8',
        icon: 'size-9',
        'icon-lg': 'size-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonProps = WithClass<ButtonPrimitive.Props> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
