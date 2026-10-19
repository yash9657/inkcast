'use client';

import * as React from 'react';
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn, type WithClass } from '@/lib/utils';

const press = 'motion-safe:active:scale-[0.98]';

/**
 * Buttons are pills. One primary (ink) per view; everything else is secondary
 * (outlined), ghost (toolbar) or link. Heights: xs 28, sm 36, default 40, lg 48.
 */
const buttonVariants = cva(
  [
    'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap',
    'border font-medium',
    'transition-[background-color,border-color,color,box-shadow,scale] duration-fast ease-out',
    // A paper band between the ring and an ink fill keeps focus legible on the primary.
    'focus-ring outline-none focus-visible:ring-2 focus-visible:ring-background',
    'disabled:pointer-events-none disabled:opacity-45',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default: [
          'border-transparent bg-primary text-primary-foreground',
          'hover:bg-primary/88',
          press,
        ],
        secondary: [
          'border-border bg-card text-foreground',
          'hover:border-input hover:bg-accent/60',
          press,
        ],
        outline: [
          'border-border bg-transparent text-foreground',
          'hover:border-input hover:bg-accent/60',
          press,
        ],
        ghost: [
          'border-transparent text-muted-foreground',
          'hover:bg-accent/70 hover:text-foreground',
          press,
        ],
        // A link is text: no border, no press.
        link: 'border-transparent px-0 text-link underline decoration-border underline-offset-4 hover:decoration-current',
        destructive: [
          'border-transparent bg-destructive text-destructive-foreground',
          'hover:bg-destructive/90',
          press,
        ],
      },
      size: {
        xs: 'h-7 gap-1.5 px-3 text-xs',
        sm: 'h-9 px-3.5 text-sm',
        default: 'h-10 px-4.5 text-sm',
        lg: 'h-12 px-6 text-base',
        'icon-xs': 'size-7',
        'icon-sm': 'size-8',
        icon: 'size-9',
        'icon-lg': 'size-11',
      },
      shape: {
        pill: 'rounded-pill',
        block: 'rounded-md',
      },
    },
    defaultVariants: { variant: 'default', size: 'default', shape: 'pill' },
  },
);

export type ButtonProps = WithClass<ButtonPrimitive.Props> & VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  shape,
  nativeButton,
  render,
  ...props
}: ButtonProps) {
  // A Link or anchor keeps link semantics; ordinary controls remain native buttons.
  const isLink =
    React.isValidElement<{ href?: string }>(render) &&
    (render.type === 'a' || Boolean(render.props.href));
  return (
    <ButtonPrimitive
      data-slot="button"
      render={render}
      nativeButton={nativeButton ?? !isLink}
      role={isLink ? 'link' : undefined}
      className={cn(buttonVariants({ variant, size, shape }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
