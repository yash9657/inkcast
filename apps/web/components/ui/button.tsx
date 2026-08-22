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
 *
 * A button in this system is a BLOCK: a 1px ink border, square corners, and a
 * hard zero-blur offset shadow that states "this plane is in front of the page".
 * Every variant therefore carries a border — `ghost` and `link` carry a
 * transparent one — so that hovering a ghost button grows an edge without
 * moving a single pixel of text. docs/DESIGN.md §5: a hard shadow on an element
 * with no border looks broken, because the shadow is the offset plane and the
 * border is its edge.
 *
 * The four rungs read as four different objects rather than four tints:
 *   default    accent fill  + ink border + accent shadow (`shadow-pop`)
 *   secondary  block fill   + ink border + black shadow  (`shadow-card`)
 *   outline    transparent  + ink border + black shadow  — the paper and its
 *              dot grid show through, so it reads as a cut-out next to
 *              secondary's solid block rather than as a 2.5% lighter twin
 *   ghost      nothing until hover, then border + tinted surface
 *   link       text only
 */

/**
 * The press. This is the single detail that makes the style feel built rather
 * than skinned: on `:active` the offset shadow collapses to nothing and the
 * button travels 2px down-right, so it visibly moves onto the page and lands
 * flush with it. docs/DESIGN.md §5 spells out this exact pair and calls it "not
 * a fourth shadow".
 *
 * The translate is gated behind `motion-safe:` and the shadow collapse is not,
 * which is deliberate and is NOT the forbidden re-implementation of
 * `prefers-reduced-motion` (docs/DESIGN.md §6: "do not duplicate the media
 * query"). The global block in `globals.css` clamps every transition to 1ms —
 * it can only make motion instant, it cannot remove it, and an instantaneous
 * 2px jump under the pointer is precisely the involuntary displacement a
 * reduced-motion user asked not to get. `motion-safe` is Tailwind's stock
 * variant, not a hand-rolled query, and it is the only place a state-triggered
 * transform can be turned off. The shadow collapse survives, so the press still
 * acknowledges itself for those users: the block goes flat.
 */
const press = [
  'motion-safe:active:translate-x-0.5 motion-safe:active:translate-y-0.5',
  'active:shadow-none',
];

const buttonVariants = cva(
  [
    'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap',
    'border font-medium',
    'transition-[background-color,border-color,color,box-shadow,translate] duration-fast ease-out',
    // Focus, and the reason there are two rings rather than one. `focus-ring`
    // paints a 2px `--ring` (violet) outline 2px outside the border box — which
    // is unmissable on paper, and invisible along the bottom-right of a
    // `shadow-pop` button, because `--elevation-pop` is `10px 10px 0
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
          'border-input bg-primary text-primary-foreground shadow-pop',
          'hover:bg-primary/90',
          press,
        ],
        secondary: [
          'border-input bg-secondary text-secondary-foreground shadow-card',
          'hover:bg-accent hover:text-accent-foreground',
          press,
        ],
        outline: [
          'border-input bg-transparent text-foreground shadow-card',
          'hover:bg-accent hover:text-accent-foreground',
          press,
        ],
        ghost: [
          'border-transparent text-muted-foreground',
          'hover:border-input hover:bg-accent hover:text-accent-foreground',
          press,
        ],
        // No border, no shadow, nothing to press: a link is text, and giving it
        // the block's press would animate a word.
        link: 'border-transparent text-primary underline-offset-4 hover:underline',
        destructive: [
          'border-input bg-destructive text-destructive-foreground shadow-card',
          'hover:bg-destructive/90',
          press,
        ],
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
      /**
       * The only two shapes the system has, and a variant rather than a
       * `className` on purpose.
       *
       * docs/DESIGN.md §4 draws the line as a rule about geometry, not taste:
       * "if it is a rectangle, it has square corners; if it is a lozenge or a
       * circle, use the pill. There is nothing in between." It then names the
       * nav CTA as one of the pill shapes, which means `rounded-pill` is a
       * recurring, specified state of this component and not a one-off override
       * — and the moment two call sites hand-write the same override (the
       * header's CTA and the same CTA repeated inside the mobile drawer, which
       * `site-header.tsx` already goes out of its way to build from
       * `buttonVariants` so the two cannot drift) it belongs in the cva.
       *
       * `rounded-none` lives here rather than in the base classes so that the
       * pill does not have to win a specificity argument with it: both shapes
       * come from the same slot, so exactly one radius is ever emitted.
       */
      shape: {
        block: 'rounded-none',
        pill: 'rounded-pill',
      },
    },
    defaultVariants: { variant: 'default', size: 'default', shape: 'block' },
  },
);

export type ButtonProps = WithClass<ButtonPrimitive.Props> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, shape, ...props }: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, shape }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
