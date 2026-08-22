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

> **2026-08-21 — the system was re-skinned (plan items C1 and C2).** The
> architecture in this document is unchanged: semantic tokens only, OKLCH only,
> both themes at the token layer, no `dark:` in components, no
> `tailwind.config.js`. The _values_ were replaced wholesale. Inkcast is now a
> neo-brutalist system: paper with a 24px dot grid, near-black ink, one hot
> accent ("cast violet"), 1px ink borders, hard zero-blur offset shadows, a flat
> radius ladder, and Space Grotesk / Inter / JetBrains Mono in place of
> Instrument Serif / Geist / Geist Mono. **§11 is the migration list** — every
> token whose value, name or meaning moved, with the call sites that reference
> it. If you are restyling a component, read §11 first; it is the difference
> between a component that inherits the new look and one that silently keeps the
> old one.

---

## 0. Where things live

| What                                     | Where                                                    | Who owns it   |
| ---------------------------------------- | -------------------------------------------------------- | ------------- |
| Tokens, base layer, utilities            | `apps/web/app/globals.css`                               | design system |
| Typefaces                                | `apps/web/lib/fonts.ts`                                  | design system |
| `cn()` and helpers                       | `apps/web/lib/utils.ts`                                  | design system |
| Primitives                               | `apps/web/components/ui/**`                              | design system |
| Root layout, providers                   | `apps/web/app/layout.tsx`, `components/ui/providers.tsx` | design system |
| Pages, route layouts, feature components | `apps/web/app/**`, `apps/web/components/<feature>/**`    | UI agents     |

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
2. **One neutral, one accent.** A single violet primary at 277° — "cast violet",
   `oklch(0.51 0.23 277)` — used on the primary action, the focus ring, an
   active state, a badge, and the `shadow-pop` offset. Never a background wash,
   never a gradient hero. There is exactly one second accent, `highlighter`, and
   it is reserved for the hand-drawn marker underline in `ink.tsx`; it is not a
   UI colour and it carries no information.
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
8. **Depth is a 1px ink border plus a hard offset shadow.** Zero blur, three
   levels, no exceptions: `shadow-card`, `shadow-pop`, `shadow-overlay`. An
   offset shadow does not simulate light; it asserts that one flat plane sits in
   front of another, which is the whole idea. Never a soft ambient stack, never
   a bevel, never a glow. (This principle used to say the opposite. The soft
   five-step ladder was the previous system — see §11.)
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

| Token                                | Utilities                           | Use it for                                                                                                                                                                                                                        |
| ------------------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `background` / `foreground`          | `bg-background`, `text-foreground`  | The page and its primary text. Body already sets both — you rarely repeat them.                                                                                                                                                   |
| `card` / `card-foreground`           | `bg-card`, `text-card-foreground`   | Any surface raised off the page: cards, panels, table headers, sticky bars. In light mode pure white on paper; in dark mode one lightness step up. A card is now white paper + a 1px ink border + `shadow-card`.                  |
| `popover` / `popover-foreground`     | `bg-popover`                        | Overlays that float **above** cards: dialogs, menus, tooltips' host surfaces, toasts, the command palette. One step higher again in dark mode.                                                                                    |
| `muted` / `muted-foreground`         | `bg-muted`, `text-muted-foreground` | `bg-muted` = a recessed well (a tab strip, an input group, a code block). `text-muted-foreground` = **all** secondary text: descriptions, captions, timestamps, placeholder-ish copy, inactive tabs, icons inside quiet controls. |
| `secondary` / `secondary-foreground` | `bg-secondary`                      | The neutral button surface. Not a second accent.                                                                                                                                                                                  |

### Lines

`border` is **ink** now, not a hairline grey. The base layer applies it to every
element, so a bare `border`, `border-b` or `border-border` is a 1px solid black
rule — which is the design target, not an accident. Reach for `border-subtle`
deliberately when a full ink rule would read as a bar.

| Token           | Utilities        | Use it for                                                                                                                                                                                                                     |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `border`        | `border-border`  | Every structural edge: cards, panels, table outlines, the outside of a segmented control. The default border colour on every element, so a bare `border` is already correct. Ink in light mode, near-white paper in dark mode. |
| `border-subtle` | `border-subtle`  | The escape hatch: separators _inside_ a card, table row dividers, the inside edges of a segmented control. A line rather than a rule (1.41:1 against a card).                                                                  |
| `input`         | `border-input`   | Control edges — inputs, selects, outline buttons, the dropzone's dashed rule. Same ink as `border`; the role is kept named so the two can diverge again without a rename.                                                      |
| `track`         | `bg-track`       | The **fill** of a control track: switch bed, scrollbar thumb, drawer grab handle. New. Use this, never `bg-input` — `input` is ink now, so a `bg-input` switch bed would be a solid black pill, which reads as ON.             |
| `grid-dot`      | (via `dot-grid`) | The paper's dot. You will not name this directly; `body` and the `dot-grid` utility paint it.                                                                                                                                  |

### Accent and status

There is one hot accent and it has three names for three jobs, plus two
derivatives. `primary` and `accent-strong` are literally the same colour:
`primary` is the slot every existing component already targets, `accent-strong`
is the name the brutalist rules read naturally in.

| Token                                    | Utilities                                  | Use it for                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `primary` / `primary-foreground`         | `bg-primary`, `text-primary`               | **One** primary action per view. Also links, active nav item, checked indicators, the progress bar.                                                                                                                                                                               |
| `accent-strong`                          | `bg-accent-strong`, `border-accent-strong` | Alias of `primary`. Use it when the thing you are painting is "an accent block", not "the primary action" — a hero frame, an accent-filled tag.                                                                                                                                   |
| `accent-soft`                            | `bg-accent-soft`                           | An 8% (light) / 12% (dark) translucent violet wash. The hover state for anything that must not become a solid block. Translucent on purpose, so it composes over card, popover and paper without three variants.                                                                  |
| `accent-border`                          | `border-accent-border`                     | A 28% (light) / 34% (dark) translucent violet line. The accent's own border — a dashed accent rule, the edge of a soft-washed chip.                                                                                                                                               |
| `ring`                                   | `ring-ring`, `outline-ring`                | Focus only. Same hue as primary. You will normally use the `focus-ring` utility rather than this directly.                                                                                                                                                                        |
| `accent` / `accent-foreground`           | `bg-accent`, `text-accent-foreground`      | Unchanged role: a tinted **interaction** surface — hover on a ghost button, the highlighted menu item, a selected row. Never a page or section background, and never a solid fill. It is the opaque twin of `accent-soft`.                                                        |
| `highlighter` / `highlighter-foreground` | `stroke-highlighter`, `fill-highlighter`   | Marker yellow, and it has exactly one job: the hand-drawn underline in `ink.tsx` and the wordmark's flourish. It is deliberately too low-contrast (1.33:1 on paper) to carry information — never a border, status or text colour. Text set _on_ it uses `highlighter-foreground`. |
| `destructive` / `destructive-foreground` | `bg-destructive`, `text-destructive`       | Only actions that lose work, and their confirmations.                                                                                                                                                                                                                             |
| `success` / `success-foreground`         | `bg-success`, `text-success`               | A finished render, a passed check. Not decoration.                                                                                                                                                                                                                                |
| `warning` / `warning-foreground`         | `bg-warning`, `text-warning`               | A degraded path — e.g. "no `ANTHROPIC_API_KEY`, using the local planner".                                                                                                                                                                                                         |

The three status colours were darkened so each clears 4.5:1 against its own
near-white foreground when used as a flat fill. In a system where the primary
action is a flat block, a status colour has to survive the same treatment.

### Ink — the whiteboard's own palette

Use these in chrome **only** when the UI is quoting the canvas: a legend chip
next to a stroke colour, a hand-drawn flourish, an empty-state board.

`bg-paper`, `text-ink`, `text-ink-blue`, `text-ink-red`, `text-ink-green`,
`text-ink-amber`, `text-ink-violet` (plus `bg-*`, `border-*`, `stroke-*`,
`fill-*` for each).

`paper` and `ink` stay the same in both themes — the whiteboard is _content_,
not chrome, and it does not invert. They now hold the renderer's exact values,
converted from `packages/render/src/palette.ts` (`paper: '#fcfbf9'`,
`ink: '#1b232e'`), so `bg-paper`/`text-ink` on a preview is the colour a real
frame renders. The five ink hues brighten in dark mode so chips stay legible.

**Where this document used to overclaim.** "The renderer draws with these" was
true of `paper` and `ink` and false of the five hues. The renderer's `COLOR`
palette has exactly two marker colours — `accent: '#2f6fed'`
(`oklch(0.574 0.202 262)`, a blue) and `contrast: '#c2410c'`
(`oklch(0.553 0.174 38)`, a burnt orange) — and no violet at all. So
`docs/PLAN-LAUNCH.md` C1's claim that cast violet "keeps brand continuity with
the whiteboard's `--ink-violet` so chips still match strokes" does not hold:
`--ink-violet` is at hue 292, the new accent at 277, and the renderer draws
neither. The five hues stay a hue-separated ramp because that is what
`mini-board.tsx` needs — a legible five-stroke preview — and pulling two of them
onto 262/277 would collapse them into each other. Closing the real gap means
giving the renderer more hues, which is plan item A4.4 and lives in `packages/`.

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

Sizes are unchanged from the previous system. **Tracking moved**: every step
from `text-xl` up now sits in the −0.02 to −0.035em band, which is what makes a
Space Grotesk heading read as a set block rather than as default letterfit.

| Step        | Size | Tracking | Weight | Use                                                            |
| ----------- | ---- | -------- | ------ | -------------------------------------------------------------- |
| `text-2xs`  | 11px | +0.04em  | 500    | Uppercase eyebrows, group labels, table meta, `Kbd`, shortcuts |
| `text-xs`   | 12px | +0.02em  | 500    | Captions, helper text, badges, timestamps                      |
| `text-sm`   | 13px | +0.008em | —      | Secondary UI text, menu items, tab labels, descriptions        |
| `text-base` | 14px | 0        | —      | **Default UI body.** Inputs, buttons, table cells              |
| `text-md`   | 15px | −0.003em | —      | Long-form body, the script editor, command palette input       |
| `text-lg`   | 17px | −0.008em | —      | Lead paragraph, marketing body                                 |
| `text-xl`   | 20px | −0.02em  | 600    | Card titles, dialog titles, section subheads                   |
| `text-2xl`  | 24px | −0.022em | 600    | Page titles                                                    |
| `text-3xl`  | 30px | −0.025em | 600    | Section headings                                               |
| `text-4xl`  | 38px | −0.028em | 600    | Big section headings                                           |
| `text-5xl`  | 48px | −0.03em  | 700    | Display floor                                                  |
| `text-6xl`  | 60px | −0.032em | 700    | Display                                                        |
| `text-7xl`  | 76px | −0.035em | 700    | The hero claim. One per page, ever                             |

### Families

All three UI faces changed on 2026-08-21. Shantell Sans did not — it is the one
face in the stack that is ours rather than borrowed, and it is the same file the
renderer writes on the canvas with.

| Utility        | Face           | Rules                                                                                                                                                                                                                                                      |
| -------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `font-sans`    | Inter          | Everything. It is the body default; you rarely write it. Variable 100–900, `wght` axis only (not the `opsz` cut — this app sets its display type in Space Grotesk).                                                                                        |
| `font-mono`    | JetBrains Mono | Durations, timecodes, project ids, file sizes, CLI snippets. Pair with `tabular`. Variable 100–800.                                                                                                                                                        |
| `font-display` | Space Grotesk  | Headings **and** display, 20px up. The base layer already sets it on `h1`–`h6`, so you write `font-display` only for type that should read as a heading without being one. Variable 300–700 — note the ceiling, which is why the weight ramp stops at 700. |
| `font-hand`    | Shantell Sans  | Ink accents. A hand-drawn annotation, a `Badge variant="ink"`, a wordmark flourish. Small doses. Not a heading face.                                                                                                                                       |

The old "`font-display` only ≥48px, marketing only, never prose" rule is
**retired**, and it was never a taste rule: Instrument Serif is a high-contrast
condensed serif that is illegible at heading size, so the floor was a property of
the face. Space Grotesk has no such floor. It is correct in the studio.

### Weights

Only four exist — `font-normal` (400), `font-medium` (500), `font-semibold`
(600), `font-bold` (700). `font-light`, `font-extrabold` and `font-black` were
removed from the theme.

These used to be 400/500/**560**/**650** — off-integer values chosen because
Geist is variable and 560 reads as more composed than 600 at UI sizes. That was
right for a soft system and wrong for this one, for two reasons: brutalism wants
weight to be unambiguous, and Space Grotesk's `wght` axis stops at 700, so 650
left the top of the ramp with no headroom above it.

All four faces are variable, so all four weights are real interpolations rather
than synthesised — and the base layer's `font-synthesis-weight: none` guarantees
the browser never fakes one.

Default to `font-medium` for anything that is a control or a label, and
`font-semibold` for titles. `font-bold` is for display type.

### Numbers

Anything that ticks — a percentage, a duration, a cost, a frame count — gets the
`tabular` utility, or the digits jitter as it updates.

---

## 4. Spacing, radius, layout

**Spacing.** 4px base. Prefer this subset and you will never look off-rhythm:
`1 2 3 4 6 8 10 12 16 20 24 32`. Inside a component, steps of 1–3; between
components, 4–8; between sections, 16–32.

**Radius.** The ladder is **flat**. There is no concentric-corner problem any
more, because there are no corners.

| Utility                         | Value | Use                                                                                                                                  |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `rounded-none`                  | 0     | Everything rectangular. Cards, dialogs, buttons, inputs, menus, tiles, panels, drawers.                                              |
| `rounded-xs` … `rounded-4xl`    | 0     | Also 0. Kept so the ~90 existing call sites resolve rather than silently no-op.                                                      |
| `rounded-pill` / `rounded-full` | 999px | Shapes that are geometrically round: badges, tags, the nav CTA, switch knobs, slider thumbs, avatars, status dots, scrollbar thumbs. |

Every step from `xs` to `4xl` resolves to `0px`, which means the existing
`rounded-*` classes across the app went square without a single component edit —
and, more usefully, means a component author cannot reintroduce a soft corner by
reaching for `rounded-xl`. The namespace is kept rather than deleted precisely so
those call sites keep resolving; deleting it would give the same pixels with none
of the intent recorded.

**If it is a rectangle, it has square corners; if it is a lozenge or a circle,
use the pill. There is nothing in between.**

**Page rhythm.** Studio content sits in a `max-w-6xl` container with `px-6`
(`px-4` below `sm`). Marketing sections use `py-24` between them and `max-w-5xl`
for prose. Section headings get `mb-3`; the paragraph under them `mb-10`.

---

## 5. Elevation

Three levels, all hard, all zero-blur, all offset down-right. There is no fourth
and there is no soft option.

| Utility             | Value (light)                  | Use                                                                                                                                                                                                                                |
| ------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shadow-none`       | `none`                         | The pressed state, and anything flush with the page.                                                                                                                                                                               |
| `shadow-card`       | `6px 6px 0 oklch(0 0 0/.12)`   | Resting surfaces: cards, inputs, tiles, secondary and outline buttons, a tab indicator.                                                                                                                                            |
| `shadow-pop`        | `10px 10px 0 var(--primary)`   | The primary action, and the one hero frame per page. Accent-coloured, so the shadow is brand rather than dirt. **At most twice on a screen.**                                                                                      |
| `shadow-overlay`    | `10px 10px 0 oklch(0 0 0/.16)` | Things that float over the page: dropdowns, selects, dialogs, drawers, toasts, tooltips. Black, not accent — an accent shadow on a menu is a distraction, not a signal.                                                            |
| `inset-shadow-well` | `inset 0 1px 2px …`            | A recessed track: tab strips, slider and progress tracks, a switch track, the theme toggle. Survives the rewrite unchanged — a well is a hole in the paper, not a plane above it, so a soft inset is still the honest description. |

**The press affordance is not a fourth shadow.** A button collapses to
`shadow-none` and translates 2px down-right on `:active`, so it visibly moves
onto the page:

```tsx
'shadow-pop transition-[box-shadow,transform] duration-fast ease-out',
'active:translate-x-0.5 active:translate-y-0.5 active:shadow-none',
```

In dark mode the geometry is identical and only the alpha deepens (0.5 / 0.6). A
hard offset shadow reads perfectly well on ink paper, which is why the old
dark-mode trick — a 1px inner top highlight, because a soft shadow on a dark
surface is invisible — is gone. Every surface has a real border instead.

**A hard shadow with no border looks broken.** `shadow-card` and `shadow-pop`
always go on an element that also has `border border-border` (or
`border-input`); the shadow is the offset plane and the border is its edge.

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

| Utility            | Value | For                                      |
| ------------------ | ----- | ---------------------------------------- |
| `duration-instant` | 80ms  | Colour and opacity only. A tooltip.      |
| `duration-fast`    | 140ms | Hover, focus, press. The default.        |
| `duration-brisk`   | 200ms | Popovers, menus, tooltips, tab indicator |
| `duration-slow`    | 320ms | Dialogs, drawers, layout changes         |
| `duration-slower`  | 480ms | Page-level transitions, ink drawing on   |

### Easings

| Utility          | Curve                          | For                                                                                              |
| ---------------- | ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `ease-out`       | `cubic-bezier(.16,1,.3,1)`     | **The default.** Anything entering. Decelerates hard, so things feel placed rather than floated. |
| `ease-in`        | `cubic-bezier(.4,0,1,1)`       | Anything leaving                                                                                 |
| `ease-in-out`    | `cubic-bezier(.65,0,.35,1)`    | Something moving between two on-screen positions                                                 |
| `ease-out-quart` | `cubic-bezier(.165,.84,.44,1)` | Longer travel; slightly gentler than `ease-out`                                                  |
| `ease-overshoot` | `cubic-bezier(.34,1.4,.64,1)`  | A single celebratory beat — a render completing. Once per flow, at most.                         |

### Springs

`defaultSpring` is exported from `@/components/ui` and is already the
`MotionConfig` default, so a bare `<motion.div layout>` moves correctly with no
`transition` prop:

```ts
{ type: 'spring', stiffness: 320, damping: 30, mass: 0.9 }
```

Override it only for these:

| Situation                                        | Spring                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| Default: hover, press, open/close                | `{ stiffness: 320, damping: 30, mass: 0.9 }`                         |
| Large surface travelling far (a drawer, a panel) | `{ stiffness: 210, damping: 26 }`                                    |
| Tiny snap (a toggle, a chip)                     | `{ stiffness: 520, damping: 34 }`                                    |
| Anything the user is dragging                    | `{ stiffness: 700, damping: 42 }` — must feel attached to the finger |

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

`highlighter` is the second hand accent and belongs here and nowhere else: an
`InkUnderline` or `InkHighlight` drawn in marker yellow under a hero phrase, and
the wordmark's stroke under the `k`. Adding it as a `tone` on these components is
part of the component sweep; the token is already defined.

### Utilities in `globals.css`

| Utility                       | Use                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `focus-ring`                  | The house focus ring. Put it on every interactive element you build.                                                                                      |
| `tabular`                     | Tabular figures for anything that ticks                                                                                                                   |
| `dot-grid`                    | Repaints the paper's dot grid on an element that has its own background — a full-bleed band, a bordered frame that should read as part of the same sheet. |
| `scrollbar-none`              | Short horizontal rails only, never a vertical region a user must page                                                                                     |
| `mask-fade-r` / `mask-fade-b` | Fade a rail's trailing edge so it reads as continuing                                                                                                     |

`body` already paints the grid, so a transparent section inherits it for free;
`dot-grid` is only for a section that paints over it. Start such a section's box
on a multiple of 24px or its grid will be out of phase with the body's.

**`surface-grain` was deleted.** It painted a 2.8% turbulence wash on an
`::after` at `z-index: -1`, which put it between the element and the body
background — so on any transparently-backed section it sat directly on top of the
dot grid and softened the 1px dots into smudges. The two do not compose, and of
the two the grid is the one the system is built on. The taste argument points the
same way: film grain exists to make a flat surface look less flat, and a flat
surface is the point here. Its one call site was
`components/marketing/hero.tsx:26`; the class is now inert and should be removed
there.

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

From `docs/research/golpo-ux.md` §6.10: the competitor's copy says _convert_,
_generate_, _translate_. Ours says **draw, sketch, ink, write, hand, board**,
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
- **Do not** use `font-hand` for headings or body — accents only.
- **Do not** use `highlighter` for anything except the `ink.tsx` marker
  underline and the wordmark flourish. It is a marker colour, not a UI colour.
- **Do not** add a gradient background, a glow, a glass-morphism panel, or an
  animated mesh. The palette is restrained on purpose.
- **Do not** stack shadows by hand, add a blur radius, or reintroduce a soft
  ambient shadow. Use `shadow-card`, `shadow-pop`, `shadow-overlay`.
- **Do not** put a hard shadow on an element with no border. The shadow is the
  offset plane; the border is its edge.
- **Do not** use `rounded-*` expecting a corner. Everything rectangular is
  square; only `rounded-pill`/`rounded-full` is round.
- **Do not** use `bg-input` for a fill. `input` is ink now — use `bg-track`.
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
  Primitives are fine to pull _source_ from, one component at a time, restyled
  onto these tokens.
- **Do not** gate anything client-side. Per `golpo-ux.md` §5.4, any gate must be
  enforced by the endpoint that serves the artefact, never by hiding a button.

---

## 11. Migration list — the C1/C2 token swap

Read this before restyling anything. It exists because
`docs/HANDOFF.md` names **silent degradation as the dominant failure mode in
this repo**, and a deleted token is the purest form of it: the class stays in the
markup, produces no CSS, and the component looks almost right.

### Tokens added

| Token                                      | Light                          | Dark                          |
| ------------------------------------------ | ------------------------------ | ----------------------------- |
| `--border-subtle` / `border-subtle`        | `oklch(0.885 0.004 285)`       | `oklch(0.32 0.014 285)`       |
| `--track` / `bg-track`                     | `oklch(0.885 0.005 285)`       | `oklch(0.33 0.015 285)`       |
| `--accent-strong` / `bg-accent-strong`     | `oklch(0.51 0.23 277)`         | `oklch(0.68 0.19 277)`        |
| `--accent-soft` / `bg-accent-soft`         | `oklch(0.51 0.23 277 / .08)`   | `oklch(0.68 0.19 277 / .12)`  |
| `--accent-border` / `border-accent-border` | `oklch(0.51 0.23 277 / .28)`   | `oklch(0.68 0.19 277 / .34)`  |
| `--highlighter` / `bg-highlighter`         | `oklch(0.9 0.16 95)`           | `oklch(0.86 0.17 95)`         |
| `--highlighter-foreground`                 | `oklch(0.26 0.06 95)`          | `oklch(0.22 0.06 95)`         |
| `--grid-dot` / `--grid-size`               | `oklch(0.88 0.005 95)` / 24px  | `oklch(1 0 0 / .06)` / 24px   |
| `--elevation-card` / `shadow-card`         | `6px 6px 0 oklch(0 0 0/.12)`   | `6px 6px 0 oklch(0 0 0/.5)`   |
| `--elevation-pop` / `shadow-pop`           | `10px 10px 0 var(--primary)`   | same                          |
| `--elevation-overlay` / `shadow-overlay`   | `10px 10px 0 oklch(0 0 0/.16)` | `10px 10px 0 oklch(0 0 0/.6)` |
| `--radius-pill`                            | `999px`                        | same                          |
| `dot-grid` utility                         | —                              | —                             |

### Tokens removed

| Removed                             | Replaced by                             | Call sites outside `globals.css`                                   |
| ----------------------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| `--elevation-1` … `--elevation-5`   | `--elevation-card` / `-overlay`         | **none** (they were only ever referenced through `--shadow-*`)     |
| `--elevation-primary`               | `--elevation-pop`                       | **none**                                                           |
| `surface-grain` utility             | `dot-grid`, or nothing                  | `components/marketing/hero.tsx:26` — class is now inert, remove it |
| `--font-instrument-serif`           | `--font-space-grotesk`                  | **none** in components (`globals.css` and `lib/fonts.ts` only)     |
| `--font-geist`, `--font-geist-mono` | `--font-inter`, `--font-jetbrains-mono` | **none** in components                                             |

### Tokens whose VALUE moved far enough to change behaviour

These kept their names, so nothing breaks — but a component that looked right
before may not now. Every one of them is intentional.

| Token                               | Was                     | Is                         | What that does to existing markup                                                                                       |
| ----------------------------------- | ----------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `--border`                          | `oklch(0.916 .0055 75)` | `oklch(0.17 .01 285)`      | Every `border`, `border-b`, `border-border` (39 sites) is now a 1px **black** rule. The base layer applies it globally. |
| `--input`                           | `oklch(0.885 .0065 75)` | `oklch(0.17 .01 285)`      | Same, for `border-input` (14 sites). And `bg-input` is now a black fill — see the breakages below.                      |
| `--radius-xs` … `-4xl`              | 4px … 32px              | `0px`                      | ~90 `rounded-*` classes go square with no edit. Intended.                                                               |
| `--font-weight-semibold`            | 560                     | 600                        | `font-semibold` (7 sites) gets heavier.                                                                                 |
| `--font-weight-bold`                | 650                     | 700                        | `font-bold` gets heavier. No current call sites.                                                                        |
| `--tracking-tight`                  | −0.015em                | −0.02em                    | 6 sites, all headings/titles. Intended.                                                                                 |
| `--tracking-tighter`                | −0.03em                 | −0.035em                   | No current call sites.                                                                                                  |
| `--primary`                         | `oklch(0.545 .205 275)` | `oklch(0.51 .23 277)`      | Slightly darker, noticeably more saturated. `#4F46E5`.                                                                  |
| `--muted`, `--secondary`            | hue 75 (warm)           | hue 285 (cold)             | Greys read blue-black instead of sepia.                                                                                 |
| `--destructive`/`success`/`warning` | L .575/.535/.63         | L .53/.50/.53              | Darker, so each survives being a flat fill under its own near-white foreground.                                         |
| `--paper`, `--ink`                  | idealised               | the renderer's exact hexes | `bg-paper`/`text-ink` now match a rendered frame.                                                                       |

### Deprecated shadow aliases — the clean-up list

`shadow-xs`/`sm`/`md`/`lg`/`xl`/`primary` still resolve, mapped by intent, so
nothing lost its shadow. **They should all be rewritten to `shadow-card`,
`shadow-pop` or `shadow-overlay` during the component sweep**, after which the
alias block at the bottom of `globals.css` §2 can be deleted. Every call site:

- `shadow-xs` → `shadow-card`: `components/ui/button.tsx:40,42,45`,
  `card.tsx:40`, `input.tsx:25`, `textarea.tsx:21`, `select.tsx:42`,
  `slider.tsx:73`, `switch.tsx:39`, `tabs.tsx:42`, `theme-toggle.tsx:58`,
  `components/studio/tile-group.tsx:62`, `components/studio/file-drop.tsx:73`,
  `app/share/[id]/page.tsx:164`
- `shadow-md` → decide per site: `components/ui/card.tsx:41`
  (`hover:shadow-md`, which now equals the resting `shadow-card` — the hover
  lift has lost its shadow change and needs re-expressing, e.g. resting
  `shadow-card` → hover `shadow-pop`), `slider.tsx:76`
  (`data-dragging:shadow-md`, same problem), `tooltip.tsx:48` → `shadow-overlay`
- `shadow-lg` → `shadow-overlay`: `components/ui/dropdown-menu.tsx:34`,
  `select.tsx:91`, `sonner.tsx:39`, `components/studio/video-player.tsx:317`,
  `components/marketing/ink-demo.tsx:437`
- `shadow-xl` → `shadow-overlay`: `components/ui/dialog.tsx:66`,
  `drawer.tsx:36`
- `shadow-primary` → `shadow-pop`: `components/ui/button.tsx:38`
- `shadow-sm` → no call sites.

### Real breakages to fix in the component sweep

Four things are now wrong in a way the token layer cannot fix, and all four are
consequences the swap accepted deliberately:

1. **`bg-input` is a black fill.** `--input` is ink, so these three read as
   filled-in when they should read as empty tracks. Change each to `bg-track`:
   `components/ui/switch.tsx:28` (an "off" switch is currently a solid black
   pill, which reads as ON — the worst of the four),
   `components/ui/scroll-area.tsx:73`, `components/ui/drawer.tsx:96`.
2. **`hover:border-input` / `focus-within:border-input` are no-ops.**
   `--border` and `--input` are the same ink now, so these no longer change
   anything: `components/ui/card.tsx:41,42`,
   `components/studio/video-player.tsx:247`. Express the hover/focus state with
   `border-accent-strong` or `shadow-pop` instead.
3. **A bare `bg-secondary` has no edge.** `--secondary` sits a hair below
   `--card` so it is still visible, but the brutalist secondary button is paper
   fill + ink border + `shadow-card`, and `components/ui/button.tsx:40` has no
   border. Add one.
4. **`surface-grain` on `components/marketing/hero.tsx:26` is inert.** Remove
   the class.

Additionally, `font-display` no longer implies "48px and up": the base layer
sets it on every `h1`–`h6`, so the four explicit uses
(`components/marketing/hero.tsx:38`, `closing-cta.tsx:27`,
`cost-comparison.tsx:120`, and the stale comment at `hero.tsx:36`) are now
redundant on heading elements — harmless, but the comment at `hero.tsx:36`
states a rule that no longer exists and should go.

### Not changed, deliberately

- The five chromatic `--ink-*` hues. See §2 "Ink" for why, and for the
  correction to the plan's claim about `--ink-violet`.
- `--elevation-inset` / `inset-shadow-well`, and its six call sites.
- The type **sizes**, the spacing base, every easing and duration token, the
  focus-ring contract, and the two keyframes.
- `--accent` / `--accent-foreground` keep their meaning as a tinted interaction
  surface. `PLAN-LAUNCH.md` C1 asks for `--accent` to become the solid hot
  violet; that was not done, and the reason is concrete rather than aesthetic.
  Five call sites paint it at partial alpha with `--foreground` text on top
  (`components/ui/select.tsx:44`, `dropdown-menu.tsx:160`,
  `components/studio/tile-group.tsx:64`, `file-drop.tsx:127`,
  `components/studio/generation-view.tsx:167`), and a saturated `--accent` drops
  all five below 4.5:1 — while the last of them belongs to another workstream and
  could not be fixed in the same change. The hot accent therefore lives at
  `--primary`, with `--accent-strong` as its brutalist-reading alias and
  `--accent-soft`/`--accent-border` as the derivatives the plan describes.

---

## Appendix: deviations from `docs/research/design-stack.md`

Recorded so they are not silently reversed. The design decisions are unchanged;
these are mechanism choices with reasons.

1. **Fonts load via `next/font/local` from `assets/fonts/`, not
   `next/font/google`.** Same latin-subset woff2 bytes Google serves.
   `next/font/google` fetches at build time, and `CONTRACT.md` requirement 1 is
   zero network. See `assets/fonts/README.md`.
   **Three of the four faces are also no longer the ones the research doc
   picked** (plan item C2, 2026-08-21): Geist → Inter, Geist Mono → JetBrains
   Mono, Instrument Serif → Space Grotesk. Shantell Sans is unchanged. The
   reasons are in `assets/fonts/README.md` §"Retired 2026-08-21" and in §3 of
   this document; the short version is that the reference system this re-skin
   derives from uses exactly this trio, and that Instrument Serif's 48px floor
   left the system with no real heading voice between 20px and 38px.
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
