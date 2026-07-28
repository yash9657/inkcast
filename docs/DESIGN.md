# Inkcast design law

**Binding.** This file is to UI work what `packages/core/src/storyboard.ts` is to
the pipeline. If you are building a page, a panel, or a marketing section, you
implement against this document; you do not re-litigate it and you do not invent
alternatives to it. It sits on top of `docs/research/design-stack.md` (the stack
decision) and must not contradict it.

Everything described here **exists and compiles today**. The token set was
contrast-checked in both themes, the stylesheet was compiled with
`tailwindcss@4.3.3`, and every component in the inventory typechecks under the
repo's strict settings. Nothing below is aspirational.

---

## 0. Where things live

| What | Where | Who owns it |
| --- | --- | --- |
| Tokens, base layer, utilities | `apps/web/app/globals.css` | design system |
| Typefaces | `apps/web/lib/fonts.ts` | design system |
| `cn()` and helpers | `apps/web/lib/utils.ts` | design system |
| Primitives | `apps/web/components/ui/**` | design system |
| Root layout, providers | `apps/web/app/layout.tsx`, `components/ui/providers.tsx` | design system |
| Pages, route layouts, feature components | `apps/web/app/**`, `apps/web/components/<feature>/**` | UI agents |

There is **no `tailwind.config.js`** and there must never be one. Tailwind v4 is
configured CSS-first; a JS config would create a second source of truth for the
tokens.

Import primitives from the barrel:

```tsx
import { Button, Card, CardHeader, CardTitle, toast } from '@/components/ui';
```

---

## 1. The ten principles

1. **Every colour is a semantic token.** Components say `bg-card`,
   `text-muted-foreground`, `border-input`. Never a hex, never `bg-zinc-800`.
   Tailwind's stock palette has been **deleted** from the theme, so a stray
   `text-red-500` produces no CSS at all — it will silently do nothing. That is
   the guardrail working, not a bug.
2. **One neutral, one accent.** A single indigo-violet primary at ~275°, used
   only on small load-bearing areas: the primary action, the focus ring, an
   active state, a badge. Never a background wash, never a gradient hero.
3. **Dark mode lives at the token layer.** Both themes are defined once, in
   `globals.css`. **No component you write may contain a `dark:` variant.** If
   you find yourself needing one, the token is wrong — say so rather than
   patching around it.
4. **Spacing is always a multiple of 4px.** `--spacing` is `0.25rem`, so `p-3`
   is 12px and `gap-6` is 24px. No `mt-[13px]`. If the scale lacks your number,
   the layout is wrong, not the scale.
5. **Hierarchy comes from weight, contrast and tracking before size.** Bumping
   font-size is the last resort, not the first.
6. **Motion is spring-physics for anything the user caused**, CSS curves for
   anything the system caused, and `prefers-reduced-motion` is honoured globally
   — already wired, never re-implemented per component.
7. **Every interactive element has a visible `focus-visible` ring** at ≥3:1
   contrast. Apply the `focus-ring` utility. Never remove an outline without
   replacing it.
8. **Depth is layered soft shadows plus a 1px border.** Never a flat black
   drop-shadow, never a bevel, never a glow.
9. **Contrast is checked in both themes independently.** ≥4.5:1 body text,
   ≥3:1 large text and UI chrome. The shipped tokens all pass; if you compose a
   new pair (a tinted surface with text on it), check it.
10. **Restraint.** Generous whitespace, few colours, precise type, motion that
    clarifies. If a screen has three things competing to be looked at first, it
    has no hierarchy. The reference class is Linear, Vercel, Raycast, Resend —
    not a template.

---

## 2. Colour tokens

Defined in OKLCH, once, for both themes. Use the token name; the theme
substitutes the value.

### Surfaces and text

| Token | Utilities | Use it for |
| --- | --- | --- |
| `background` / `foreground` | `bg-background`, `text-foreground` | The page and its primary text. Body already sets both — you rarely repeat them. |
| `card` / `card-foreground` | `bg-card`, `text-card-foreground` | Any surface raised off the page: cards, panels, table headers, sticky bars. In light mode pure white on warm off-white; in dark mode one lightness step up. |
| `popover` / `popover-foreground` | `bg-popover` | Overlays that float **above** cards: dialogs, menus, tooltips' host surfaces, toasts, the command palette. One step higher again in dark mode. |
| `muted` / `muted-foreground` | `bg-muted`, `text-muted-foreground` | `bg-muted` = a recessed well (a tab strip, an input group, a code block). `text-muted-foreground` = **all** secondary text: descriptions, captions, timestamps, placeholder-ish copy, inactive tabs, icons inside quiet controls. |
| `secondary` / `secondary-foreground` | `bg-secondary` | The neutral button surface. Not a second accent. |

### Lines

| Token | Utilities | Use it for |
| --- | --- | --- |
| `border` | `border-border` | Every structural hairline: card edges, dividers, table rules. This is the default border colour on every element, so a bare `border` is already correct. |
| `input` | `border-input`, `bg-input` | Control edges (inputs, selects, outline buttons) — deliberately a stronger line than `border`, because a control must read as interactive. Also the fill for a switch track or slider thumb rail. |

### Accent and status

| Token | Utilities | Use it for |
| --- | --- | --- |
| `primary` / `primary-foreground` | `bg-primary`, `text-primary` | **One** primary action per view. Also links, active nav item, checked indicators, the progress bar. |
| `ring` | `ring-ring`, `outline-ring` | Focus only. Same hue as primary. You will normally use the `focus-ring` utility rather than this directly. |
| `accent` / `accent-foreground` | `bg-accent`, `text-accent-foreground` | A tinted **interaction** surface: hover on a ghost button, the highlighted menu item, a selected row. Never a page or section background. |
| `destructive` / `destructive-foreground` | `bg-destructive`, `text-destructive` | Only actions that lose work, and their confirmations. |
| `success` / `success-foreground` | `bg-success`, `text-success` | A finished render, a passed check. Not decoration. |
| `warning` / `warning-foreground` | `bg-warning`, `text-warning` | A degraded path — e.g. "no `ANTHROPIC_API_KEY`, using the local planner". |

### Ink — the whiteboard's own palette

The renderer draws with these. Use them in chrome **only** when the UI is
quoting the canvas: a legend chip next to a stroke colour, a hand-drawn
flourish, an empty-state board.

`bg-paper`, `text-ink`, `text-ink-blue`, `text-ink-red`, `text-ink-green`,
`text-ink-amber`, `text-ink-violet` (plus `bg-*`, `border-*`, `stroke-*`,
`fill-*` for each).

`paper` and `ink` stay the same in both themes — the whiteboard is *content*,
not chrome, and it does not invert. The five ink hues brighten in dark mode so
chips stay legible.

### Charts

`bg-chart-1` … `bg-chart-5`, perceptually even and hue-spaced. Use them in
order. Do not pick chart colours by eye. `recharts` is deliberately not a
dependency yet — if a screen genuinely needs a chart, flag it rather than
inlining an SVG chart by hand.

### Also available

`text-white`, `text-black`, `bg-transparent`, `border-current`, `text-inherit`.
That is the entire set of non-semantic colours that exists.

Opacity modifiers are fine and encouraged for tints: `bg-primary/12`,
`bg-destructive/10`, `text-foreground/80`.

---

## 3. Type scale

`--text-base` is **14px**, not 16px. This is a dense product UI. Marketing prose
steps up to `text-lg`.

Tracking tightens as size grows and line-height loosens as size shrinks — both
are baked into the scale, so you get them by using the step and should not add
`tracking-*` on top unless you have a specific reason.

| Step | Size | Tracking | Weight | Use |
| --- | --- | --- | --- | --- |
| `text-2xs` | 11px | +0.04em | 500 | Uppercase eyebrows, group labels, table meta, `Kbd`, shortcuts |
| `text-xs` | 12px | +0.02em | 500 | Captions, helper text, badges, timestamps |
| `text-sm` | 13px | +0.008em | — | Secondary UI text, menu items, tab labels, descriptions |
| `text-base` | 14px | 0 | — | **Default UI body.** Inputs, buttons, table cells |
| `text-md` | 15px | −0.003em | — | Long-form body, the script editor, command palette input |
| `text-lg` | 17px | −0.006em | — | Lead paragraph, marketing body |
| `text-xl` | 20px | −0.011em | 560 | Card titles, dialog titles, section subheads |
| `text-2xl` | 24px | −0.014em | 560 | Page titles |
| `text-3xl` | 30px | −0.018em | 560 | Section headings |
| `text-4xl` | 38px | −0.022em | 560 | Big section headings |
| `text-5xl` | 48px | −0.026em | — | Display floor — use `font-display` from here up |
| `text-6xl` | 60px | −0.03em | — | Display |
| `text-7xl` | 76px | −0.034em | — | The hero claim. One per page, ever |

### Families

| Utility | Face | Rules |
| --- | --- | --- |
| `font-sans` | Geist | Everything. It is the body default; you rarely write it. |
| `font-mono` | Geist Mono | Durations, timecodes, project ids, file sizes, CLI snippets. Pair with `tabular`. |
| `font-display` | Instrument Serif | **Only ≥48px, marketing surfaces only.** It is high-contrast and condensed: editorial at hero size, illegible at body size. Never set prose in it. Never use it in the studio. |
| `font-hand` | Shantell Sans | Ink accents. A hand-drawn annotation, a `Badge variant="ink"`, a wordmark flourish. Small doses. Not a heading face. |

### Weights

Only four exist — `font-normal` (400), `font-medium` (500), `font-semibold`
(560), `font-bold` (650). `font-light`, `font-extrabold` and `font-black` were
removed from the theme. 560 and 650 are optical values chosen because Geist is
variable and 600/700 shout at UI sizes.

Default to `font-medium` for anything that is a control or a label, and
`font-semibold` for titles. `font-bold` is rare.

### Numbers

Anything that ticks — a percentage, a duration, a cost, a frame count — gets the
`tabular` utility, or the digits jitter as it updates.

---

## 4. Spacing, radius, layout

**Spacing.** 4px base. Prefer this subset and you will never look off-rhythm:
`1 2 3 4 6 8 10 12 16 20 24 32`. Inside a component, steps of 1–3; between
components, 4–8; between sections, 16–32.

**Radius.** Nested corners must be concentric — a child's radius is the parent's
minus the padding between them.

| Utility | Value | Use |
| --- | --- | --- |
| `rounded-xs` | 4px | Tiny chips, a close button |
| `rounded-sm` | 6px | Menu items, list rows, table cells |
| `rounded-md` | 8px | **Buttons**, segmented controls, tab pills |
| `rounded-lg` | 10px | **Inputs, selects, popovers, menus** |
| `rounded-xl` | 14px | **Cards, dialogs** |
| `rounded-2xl` | 18px | Drawers, large hero panels |
| `rounded-3xl` / `4xl` | 24 / 32px | Marketing feature blocks only |
| `rounded-full` | — | Badges, avatars, status dots, progress tracks |

**Page rhythm.** Studio content sits in a `max-w-6xl` container with `px-6`
(`px-4` below `sm`). Marketing sections use `py-24` between them and `max-w-5xl`
for prose. Section headings get `mb-3`; the paragraph under them `mb-10`.

---

## 5. Elevation

Five levels, each a stack of 2–5 tinted layers. In light mode they read as
ambient depth; in dark mode they deepen and add a 1px inner top highlight,
because a shadow on a dark surface is invisible and the edge has to do the work.

| Utility | Use |
| --- | --- |
| *(no shadow)* | A card at rest. In light mode `bg-card` + `border-border` already reads as raised — reach for a shadow only when something genuinely floats. |
| `shadow-xs` | Buttons, inputs, a switch thumb, a tab indicator |
| `shadow-sm` | A card that is interactive at rest |
| `shadow-md` | Hover lift, a tooltip |
| `shadow-lg` | Menus, selects, popovers, toasts |
| `shadow-xl` | Dialogs, drawers |
| `shadow-primary` | The primary button only. Coloured elevation; do not put it on anything else. |
| `inset-shadow-well` | A recessed track: tab strips, slider and progress tracks, a switch track, the theme toggle |

---

## 6. Motion vocabulary

Two systems, and the choice between them is not stylistic:

- **Springs, via `motion/react`** — for anything that responds to a user action:
  hover, press, open/close, drag, reorder, a card expanding into an editor.
  Springs read as alive; a hand-tuned bezier reads as "animated".
- **CSS curves, via the `duration-*` / `ease-*` utilities** — for anything the
  system caused: an enter/exit transition, a progress bar advancing, a skeleton
  resolving.

### Durations

Five, and there is no sixth. Never write `duration-[250ms]`.

| Utility | Value | For |
| --- | --- | --- |
| `duration-instant` | 80ms | Colour and opacity only. A tooltip. |
| `duration-fast` | 140ms | Hover, focus, press. The default. |
| `duration-brisk` | 200ms | Popovers, menus, tooltips, tab indicator |
| `duration-slow` | 320ms | Dialogs, drawers, layout changes |
| `duration-slower` | 480ms | Page-level transitions, ink drawing on |

### Easings

| Utility | Curve | For |
| --- | --- | --- |
| `ease-out` | `cubic-bezier(.16,1,.3,1)` | **The default.** Anything entering. Decelerates hard, so things feel placed rather than floated. |
| `ease-in` | `cubic-bezier(.4,0,1,1)` | Anything leaving |
| `ease-in-out` | `cubic-bezier(.65,0,.35,1)` | Something moving between two on-screen positions |
| `ease-out-quart` | `cubic-bezier(.165,.84,.44,1)` | Longer travel; slightly gentler than `ease-out` |
| `ease-overshoot` | `cubic-bezier(.34,1.4,.64,1)` | A single celebratory beat — a render completing. Once per flow, at most. |

### Springs

`defaultSpring` is exported from `@/components/ui` and is already the
`MotionConfig` default, so a bare `<motion.div layout>` moves correctly with no
`transition` prop:

```ts
{ type: 'spring', stiffness: 320, damping: 30, mass: 0.9 }
```

Override it only for these:

| Situation | Spring |
| --- | --- |
| Default: hover, press, open/close | `{ stiffness: 320, damping: 30, mass: 0.9 }` |
| Large surface travelling far (a drawer, a panel) | `{ stiffness: 210, damping: 26 }` |
| Tiny snap (a toggle, a chip) | `{ stiffness: 520, damping: 34 }` |
| Anything the user is dragging | `{ stiffness: 700, damping: 42 }` — must feel attached to the finger |

### Rules

- **Reduced motion is already handled**, twice: `MotionConfig reducedMotion="user"`
  for JS animation, and a global `@media (prefers-reduced-motion: reduce)` block
  for CSS. Do not call `useReducedMotion()` to gate a component, and do not
  duplicate the media query.
- **Animate `transform` and `opacity`.** Not `width`, `height`, `top`, `left`.
  The exceptions already shipped (the progress indicator's width, the tab
  indicator's translate+width) are exceptions.
- **Movement is small.** 4–8px of travel, 2–3% of scale. If you can see the
  animation as an animation, it is too big.
- **Never animate an entrance on data the user is waiting for.** A list that
  staggers in delays the thing they asked for. Stagger belongs on marketing
  surfaces (`delay: i * 0.04`, capped at ~6 items), never in the studio.
- **Scroll-linked reveals** (`useScroll` + `useTransform`) are for marketing
  only. In the studio, scroll must feel inert and predictable.
- **View Transitions** are enabled (`experimental.viewTransition`) for
  same-document marketing navigation. Progressive enhancement only — nothing
  load-bearing may depend on them.

---

## 7. Component inventory

Everything here is real, typechecked, and exported from `@/components/ui`. All
components accept `className` (merged last, so your override wins) and forward
the rest of their props to the underlying element.

Components built on Base UI take a **`render`** prop instead of `asChild`:

```tsx
<Button render={<Link href="/studio" />}>Open studio</Button>
<DialogTrigger render={<Button variant="outline" />}>Rename</DialogTrigger>
```

### Button

`variant`: `default` · `secondary` · `outline` · `ghost` · `link` · `destructive`
`size`: `xs` · `sm` · `default` · `lg` · `icon-xs` · `icon-sm` · `icon` · `icon-lg`

One `default` per view. Hierarchy descends `default → secondary → outline →
ghost → link`. Icon-only buttons **must** have `aria-label`. SVG children are
auto-sized to `size-4`.

### Card

`Card`, `CardInteractive` (adds shadow + hover lift; for cards that are links),
`CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`,
`CardFooter`. `CardHeader` is a grid — put a button or menu in `CardAction` and
it lands top-right without absolute positioning.

### Form controls

- `Input` — Base UI input; picks up `data-invalid` from a surrounding `Field`.
- `Textarea` — `field-sizing-content`, so it grows with a paste. Set `rows`.
- `Label`, `LabelHint` (helper text), `LabelError` (`role="alert"`).
- `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`,
  `SelectGroup`, `SelectGroupLabel`, `SelectSeparator`. Positions below the
  trigger, chevron rotates on open.
- `Switch` — immediate-effect settings only. If it needs a Save button it is a
  checkbox, and there is no checkbox yet; ask for one.
- `Slider` — `label`, `showValue`, `format` (an `Intl.NumberFormatOptions`).
  Pass an array to `value` for a range and thumbs are generated to match.

### Overlays

- `Dialog`, `DialogTrigger`, `DialogContent` (`showClose`), `DialogHeader`,
  `DialogTitle` (**required** — use `className="sr-only"` if it should not be
  seen), `DialogDescription`, `DialogFooter`, `DialogClose`.
- `Drawer`, `DrawerTrigger`, `DrawerContent` (`side`: `bottom` · `top` · `left`
  · `right`), `DrawerHandle`, `DrawerHeader`, `DrawerTitle`,
  `DrawerDescription`, `DrawerBody` (scrollable), `DrawerFooter`, `DrawerClose`.
  Put `swipeDirection` on `Drawer` and match it to `side`.
- `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent` (`align`,
  `sideOffset`), `DropdownMenuItem` (`variant="destructive"`, `inset`),
  `DropdownMenuCheckboxItem`, `DropdownMenuRadioGroup`/`RadioItem`,
  `DropdownMenuSub`/`SubTrigger`/`SubContent`, `DropdownMenuLabel`,
  `DropdownMenuSeparator`, `DropdownMenuShortcut`. Items use `onClick`.
- `Tooltip`, `TooltipTrigger`, `TooltipContent` (`side`, `sideOffset`,
  `showArrow`). Shared delay is global. A tooltip is never the only place
  information exists — it does not appear on touch.
- `Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandEmpty`,
  `CommandGroup`, `CommandItem`, `CommandSeparator`, `CommandShortcut`. cmdk owns
  the filtering — pass every item and let it score.

### Feedback

- `Progress` — `value` (`null` = indeterminate), `label`, `note`, `showValue`.
  Map the pipeline's `onProgress({stage, pct, note})` straight onto these three.
  **Never fabricate a percentage**; `null` is honest and looks it.
- `Skeleton`, `SkeletonText` (`lines`) — a shimmer sweep, not a pulse. Size it to
  the content it replaces or you trade a skeleton for a reflow.
- `Badge` — `variant`: `default` · `neutral` · `outline` · `success` ·
  `warning` · `destructive` · `ink`. Never interactive.
- `StatusDot` — `tone`, `pulse`. `pulse` only for genuinely in-flight work.
- `toast` from sonner (`toast.success`, `.error`, `.promise`, …). Mounted once by
  `Providers`; just call it. A toast confirms something that already happened —
  if the user must act, that is a dialog.

### Structure

- `Tabs`, `TabsList`, `TabsTab`, `TabsPanel` — sliding indicator, painted before
  hydration so it does not jump.
- `Separator` (`orientation`), `SeparatorLabelled` (a rule with "or" in the gap).
- `ScrollArea` — `orientation`, `fadeEdges`. Needs a bounded height. **Not for
  the page**: the document scrollbar is an affordance users rely on.
- `Kbd` — one key per element, so `⌘K` is two elements.
- `ThemeToggle` — three-way light/dark/system.

### Ink flourishes

`InkUnderline`, `InkCircle`, `InkHighlight`, `InkArrow` (`direction`, 8
headings), `InkBoard` (dot-grid texture). All take `tone`
(`primary|ink|blue|red|green|amber|violet`), `seed` and `draw`.

Paths are generated from a seeded PRNG, so they are deterministic, SSR-safe, and
carry no runtime drawing library. `inkStrokePath` / `inkCirclePath` are exported
if you need the raw geometry.

**One flourish per view, on the single most important phrase.** A page where four
things are hand-circled has circled nothing.

### Utilities in `globals.css`

| Utility | Use |
| --- | --- |
| `focus-ring` | The house focus ring. Put it on every interactive element you build. |
| `tabular` | Tabular figures for anything that ticks |
| `surface-grain` | ≤3% noise wash. **Marketing only** — never behind the canvas, where it competes with the actual drawing |
| `scrollbar-none` | Short horizontal rails only, never a vertical region a user must page |
| `mask-fade-r` / `mask-fade-b` | Fade a rail's trailing edge so it reads as continuing |

---

## 8. Accessibility floor

Not optional, and cheaper to do first.

- Every interactive element gets `focus-ring`. Tab through your page before you
  call it done.
- Icon-only controls get `aria-label`. Decorative SVG gets `aria-hidden`.
- One `<h1>` per page, and heading levels do not skip.
- Never convey state by colour alone — pair it with an icon, a label, or a shape.
- A `role="alert"` for validation errors (`LabelError` already does this).
- Copy is sentence case. Never ALL CAPS in markup — `text-2xs uppercase` does it
  visually while screen readers still read words.
- The skip link in `layout.tsx` targets `#main`: your page shell must put
  `id="main"` on its main content element.

---

## 9. Voice

From `docs/research/golpo-ux.md` §6.10: the competitor's copy says *convert*,
*generate*, *translate*. Ours says **draw, sketch, ink, write, hand, board**,
because that is what actually happens. Verbs over nouns. State the mechanism, not
the magic: "one canvas the camera moves across", not "AI-powered visual
intelligence".

No superlatives, no "#1", no exclamation marks. Numbers instead of adjectives —
"$0.00 with local models" beats "incredibly affordable".

---

## 10. Do not

- **Do not** create `tailwind.config.js`.
- **Do not** write a `dark:` variant in a component.
- **Do not** use a hex, `rgb()`, `hsl()`, or a Tailwind palette colour
  (`bg-zinc-800`, `text-red-500`). They no longer exist and will silently
  produce nothing.
- **Do not** invent an off-scale spacing, radius, duration or type value.
  No `p-[13px]`, no `duration-[250ms]`, no `text-[15.5px]`.
- **Do not** use `font-display` below 48px, or anywhere in the studio.
- **Do not** use `font-hand` for headings or body — accents only.
- **Do not** add a gradient background, a glow, a glass-morphism panel, or an
  animated mesh. The palette is restrained on purpose.
- **Do not** stack shadows by hand. Use `shadow-*`.
- **Do not** remove an outline without replacing it, and do not set
  `outline: none` without a `focus-visible` replacement.
- **Do not** re-implement `prefers-reduced-motion`. It is wired twice already.
- **Do not** animate layout properties (`width`, `top`, `left`) or run entrance
  animations on data the user is waiting for.
- **Do not** wrap the whole page in `ScrollArea`.
- **Do not** add a dependency to `apps/web/package.json`. You do not own that
  file. If you need a package, say so in your report — `recharts`, `embla`,
  `vaul` and `radix-ui` were all deliberately left out.
- **Do not** run `npx shadcn add`. It rewrites `components.json`, `globals.css`
  and `lib/utils.ts`, all of which are owned here, and it generates Radix-based
  code that will not match the Base UI primitives already shipped. Write the
  component by hand in the same idiom, or ask for it.
- **Do not** copy a component out of Aceternity UI. Magic UI and Motion
  Primitives are fine to pull *source* from, one component at a time, restyled
  onto these tokens.
- **Do not** gate anything client-side. Per `golpo-ux.md` §5.4, any gate must be
  enforced by the endpoint that serves the artefact, never by hiding a button.

---

## Appendix: deviations from `docs/research/design-stack.md`

Recorded so they are not silently reversed. The design decisions are unchanged;
these are mechanism choices with reasons.

1. **Fonts load via `next/font/local` from `assets/fonts/`, not
   `next/font/google`.** Same four typefaces, same latin-subset woff2 bytes
   Google serves. `next/font/google` fetches at build time, and
   `CONTRACT.md` requirement 1 is zero network. See `assets/fonts/README.md`.
2. **`vaul` is not a dependency.** Base UI 1.6.0 ships its own `Drawer` with the
   gestures, snap points and inertial dismissal vaul was chosen for, and it
   shares `Dialog`'s focus trap and scroll lock. Using it means one popup
   implementation in the app rather than two.
3. **`embla-carousel-react`, `recharts`, `radix-ui` and the `shadcn` CLI are not
   dependencies.** Principle 10 of the research doc: nothing goes in
   `package.json` until a screen needs it. Ask and they get added.
4. **Duration tokens are named `--transition-duration-*`.** Tailwind resolves
   `duration-*` from that namespace, not `--duration-*`. The utilities are
   `duration-fast` and friends as documented.
5. **Tailwind's stock colour palette is removed from the theme.** The research
   said "semantic tokens, not raw utilities, in component code"; deleting the
   raw utilities turns that from a convention into a guarantee.
