'use client';

import * as React from 'react';
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn, type WithClass } from '@/lib/utils';

const press = ['motion-safe:active:scale-[0.98]', 'active:shadow-none'];

const buttonVariants = cva(
  [
    'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap',
    'border font-medium',
    'transition-[background-color,border-color,color,box-shadow,translate] duration-fast ease-out',
    // Focus, and the reason there are two rings rather than one. `focus-ring`
    // paints a 2px `--ring` (violet) outline 2px outside the border box — which
    // is unmissable on paper, and invisible along the bottom-right of a
    // `shadow-none` button, because `--elevation-pop` is `10px 10px 0
    // var(--primary)`: an accent outline laid over an accent shadow. The extra
    // `ring-background` sits in the 0–2px band and separates the two, so the
    // composite indicator always contains a paper-coloured edge against the
    // violet plane (6.2:1 light, 6.3:1 dark). Without it the focus ring on the
    // primary action is half-swallowed by the button's own shadow — an
    // accessibility regression that only appears in one variant, in one state,
    // which is exactly the kind that ships.
    'focus-ring outline-none focus-visible:ring-2 focus-visible:ring-background',
    'disabled:pointer-events-none disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default: [
          'border-transparent bg-primary text-primary-foreground shadow-none',
          'hover:bg-primary/90',
          press,
        ],
        secondary: [
          'border-input bg-secondary text-secondary-foreground shadow-none',
          'hover:bg-accent hover:text-accent-foreground',
          press,
        ],
        outline: [
          'border-input bg-transparent text-foreground shadow-none',
          'hover:bg-accent hover:text-accent-foreground',
          press,
        ],
        ghost: [
          'border-transparent text-muted-foreground',
          'hover:bg-accent hover:text-accent-foreground',
          press,
        ],
        // No border, no shadow, nothing to press: a link is text, and giving it
        // the block's press would animate a word.
        link: 'border-transparent text-primary underline-offset-4 hover:underline',
        destructive: [
          'border-transparent bg-destructive text-destructive-foreground shadow-none',
          'hover:bg-destructive/90',
          press,
        ],
      },
      size: {
        xs: 'h-7 gap-1.5 px-2.5 text-xs',
        sm: 'h-9 px-3 text-sm',
        default: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-md',
        'icon-xs': 'size-7',
        'icon-sm': 'size-8',
        icon: 'size-9',
        'icon-lg': 'size-11',
      },

      shape: {
        block: 'rounded-md',
        pill: 'rounded-pill',
      },
    },
    defaultVariants: { variant: 'default', size: 'default', shape: 'block' },
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
