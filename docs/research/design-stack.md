# Inkcast design stack — research + binding decision

Status: **binding**. This document plays the same role for UI work that
`storyboard.ts` plays for the pipeline: downstream agents implement against it,
they do not re-litigate it. `docs/DESIGN.md` (tokens, exact hex/oklch values,
component inventory) is written by the design-system agent _on top of_ the
choices below — it must not contradict them.

Researched live (WebSearch/WebFetch + npm registry) on 2026-07-28. Versions
below are `npm view <pkg> version` at that date; treat them as floors (`^`),
not pins, except where noted.

---

## 1. Component foundation

**Decision: Next.js 16 + React 19 + Tailwind v4 + shadcn/ui on Base UI.**

- Next.js is at `16.2.12` (React 19.2 shipped alongside Next 16 in March 2026);
  React itself is at `19.2.x`. Next 15 is no longer the frontier — build on 16.
- Tailwind v4 removed `tailwind.config.js` entirely. Configuration is
  **CSS-first**: you `@import "tailwindcss";` in one global stylesheet and
  declare design tokens inside an `@theme` block. Every `@theme` variable
  becomes _both_ a CSS custom property on `:root` _and_ a generated Tailwind
  utility (e.g. `--color-brand: oklch(62% 0.19 265)` gives you `bg-brand`,
  `text-brand`, `border-brand` for free). Content scanning is automatic — no
  `content: []` array. The engine (Oxide, Rust) is ~5–10x faster to build.
- shadcn/ui is **not a component library you install** — it's a CLI
  (`shadcn`, currently `4.16.0`) that copies component source into your repo
  via `npx shadcn@latest init` / `add`. That's the point: you own the code,
  there is no version-lock risk, and it composes with our "no placeholders,
  everything must actually run" rule naturally.
- **As of July 2026, shadcn's default primitive layer changed from Radix UI
  to Base UI.** `npx shadcn init` now wires new projects to
  `@base-ui/react` (currently `1.6.0`) instead of Radix. Radix is not
  deprecated — pass `-b radix` to opt back in, and it stays fully supported —
  but Base UI is the forward default, built partly by ex-Radix engineers, and
  ships primitives Radix never had (Combobox, Autocomplete, Number Field,
  Checkbox Group). **Use the default: Base UI.** Do not hand-pick Radix
  unless a specific primitive Base UI genuinely lacks; if that happens, use
  the consolidated `radix-ui` package (`1.6.7`, one package instead of two
  dozen `@radix-ui/react-*` modules) for just that primitive, not the whole
  library.
- `components.json` on Tailwind v4 sets `tailwind.cssVariables: true` and
  `tailwind.baseColor` to one of shadcn's extended neutrals — we pick
  **`neutral`** (see §6). Do not use `stone`/`zinc`/etc. — one neutral, chosen
  once, is a design-principle, not a taste call per component.
- Base UI (and Radix) are unstyled; shadcn's copied components apply Tailwind
  classes with `class-variance-authority` for variants and `data-slot`
  attributes instead of `React.forwardRef` boilerplate — that's current shadcn
  codegen style, keep it when hand-writing new components so generated and
  hand-written code look identical.

## 2. Motion

**Decision: `motion` (the npm package, not `framer-motion`), imported from
`motion/react`.**

- Framer Motion went independent of Framer in 2025 and rebranded to **Motion**.
  The npm package is now literally named `motion` (currently `12.43.0`); the
  old `framer-motion` package still resolves but is legacy and must not be
  added to any new `package.json`. Import surface:
  `import { motion, AnimatePresence, useScroll, useSpring } from "motion/react"`.
- Usage patterns worth being deliberate about, in priority order:
  1. **Springs over duration/easing curves** for anything that responds to a
     user action (hover, open/close, drag) — `transition: { type: "spring",
stiffness: 300, damping: 30 }` reads as alive; hand-tuned cubic-beziers
     read as "animated," which is the wrong impression for a compiler-style
     product.
  2. **Layout animation** (`layout` / `layoutId` props) for anything that
     changes size or position as a _consequence_ of state (e.g. a storyboard
     scene card expanding into an editor) — avoids hand-computing FLIP.
  3. **Scroll-linked reveals** via `useScroll` + `useTransform`, used sparingly
     on the marketing surface only (hero, feature sections) — never in the
     studio/editor, where scroll must feel inert and predictable.
  4. Every motion component must respect `prefers-reduced-motion`; Motion's
     `useReducedMotion()` hook exists for exactly this — wire it once in a
     shared `MotionConfig` at the app root (`reducedMotion="user"`), not per
     component.
- **View Transitions API**: native browser support is now broad (Chrome/Edge
  since 111, Safari since 18, Firefox since 129), and React 19.2 added a
  first-class `<ViewTransition>` primitive; Next.js exposes it behind
  `experimental.viewTransition` in `next.config`. It is _real_ and _free_
  (zero JS cost, GPU-composited) but Next.js itself still labels it
  experimental. **Use it for same-document route transitions on the
  marketing site (progressive enhancement — no-op without support), do not
  depend on it for anything load-bearing in the studio.** Motion remains the
  primary animation engine; View Transitions is a free bonus layer on top for
  page-level navigation.

## 3. Typography

**Decision: Geist for UI, Instrument Serif for display/marketing headlines,
a per-`meta.style` handwriting font for on-canvas whiteboard text.**

- **Geist** (Vercel's typeface) is now distributed directly through Google
  Fonts, so it loads through the same `next/font/google` path as everything
  else — no self-hosting step:
  ```ts
  import { Geist, Geist_Mono } from 'next/font/google';
  const sans = Geist({ subsets: ['latin'], variable: '--font-sans' });
  const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });
  ```
  Geist is neutral, technical, and legible at small sizes — right for a
  developer-adjacent, compiler-flavored product. We picked it over
  `InterVariable`/Satoshi/General Sans because it is the one of this group
  that already looks native next to Vercel/Linear/Raycast-style surfaces
  we're benchmarking against, and it ships a matching mono for
  timestamps/durations/CLI-flavored UI without a second typeface search.
- **Instrument Serif** for oversized display headlines on the marketing
  surface only (hero claim, section dividers) — condensed, high-contrast,
  reads as confident/editorial at 64px+ and terrible at body sizes, so it is
  _only_ ever a display face, never body text. Pair with Geist for
  everything else on the same page; this sans+serif contrast is the single
  highest-leverage typographic move for "premium" without looking corporate.
  ```ts
  import { Instrument_Serif } from 'next/font/google';
  const display = Instrument_Serif({
    subsets: ['latin'],
    weight: '400',
    variable: '--font-display',
  });
  ```
- **Handwriting font for whiteboard rendering** (the actual hand-drawn text
  baked into rendered frames by `@inkcast/visuals`/`@inkcast/render` — this is
  content inside the video, not UI chrome, so it is loaded as a real `.ttf`
  asset, not through `next/font`). `Storyboard.meta.style` already has four
  values (`marker | pencil | chalk | ink`) with no font mapping yet — this
  research assigns one, decisively, so the visuals/render agents don't have
  to guess:

  | `meta.style`       | Font              | Why                                                                                                                                                                      |
  | ------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `marker` (default) | **Shantell Sans** | Made by Shantell Martin, an actual whiteboard/marker artist — variable font with real "wonky"/bounce axes for organic marker strokes. Best match for the _default_ look. |
  | `pencil`           | **Caveat**        | Light, thin, cursive — reads as pencil script, not marker.                                                                                                               |
  | `chalk`            | **Gaegu**         | Soft, rounded, slightly irregular forms suit a chalkboard texture.                                                                                                       |
  | `ink`              | **Patrick Hand**  | Uniform stroke width, clean and legible — closest to a felt-tip/ink pen among OFL handwriting fonts.                                                                     |

  All four are OFL-licensed (free for commercial use, redistributable, no
  attribution requirement beyond keeping the licence file). Exact, verified
  `.ttf` download URLs (confirmed 200 + `content-type: application/octet-stream`,
  i.e. real binaries, not HTML):
  - Shantell Sans (variable, weight+bounce+ink-flow axes): `https://raw.githubusercontent.com/google/fonts/main/ofl/shantellsans/ShantellSans%5BBNCE%2CINFM%2CSPAC%2Cwght%5D.ttf`
  - Caveat (variable weight): `https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/Caveat%5Bwght%5D.ttf`
  - Gaegu (static, use Regular): `https://raw.githubusercontent.com/google/fonts/main/ofl/gaegu/Gaegu-Regular.ttf`
  - Patrick Hand (static): `https://raw.githubusercontent.com/google/fonts/main/ofl/patrickhand/PatrickHand-Regular.ttf`

  These are the canonical files served by fonts.google.com (mirrored 1:1 from
  the `google/fonts` OFL directory) — pull them into `assets/fonts/` at build
  or setup time rather than vendoring a zip from the interactive
  `fonts.google.com/download` flow, which returns an HTML page, not a direct
  file, when fetched non-interactively.

## 4. Niche design-inspiration sites — what to mine from each

- **Godly (godly.website)** — tighter curation than Awwwards, organized so you
  can evaluate _motion_ without loading every site. Mine it for: hero-section
  motion choreography and scroll-linked reveal timing, not layout.
- **Curated.design** — broad, high-taste general gallery. Mine it for: overall
  page rhythm and section-to-section pacing on marketing pages.
- **Mobbin** — real production app screens, full flows (onboarding, empty
  states, settings). Mine it for: **the studio/editor**, not the marketing
  site — this is where our video-editor-adjacent screens (storyboard timeline,
  scene inspector, render progress) should be benchmarked, because Mobbin is
  the only source here with actual complex-app interaction patterns rather
  than landing pages.
- **Land-book** — SaaS landing pages filterable by section type. Mine it for:
  one specific stuck section at a time (pricing block, feature grid, footer),
  not whole-page direction.
- **SaaS Landing Page / Dark Mode Design** — mine for dark-mode-specific
  contrast and glow-accent patterns; cross-check every pattern against our own
  contrast rule (§6) before copying — a lot of dark-mode inspiration sites
  fail AA on secondary text.
- **Refactoring UI (Wathan/Schoger)** — not a site but the operating
  philosophy: don't build hierarchy with font-size alone (use weight, color
  opacity, tracking); saturated color only on small accent areas, never
  backgrounds; give designs room to breathe before adding detail; establish a
  spacing scale once and never invent an off-scale value.
- **Vercel / Linear / Raycast / Resend** — the actual reference class for "we
  know contemporary design." What to take, specifically, not vibes: tinted
  neutrals instead of pure black/white, colored (not just darker) shadows,
  typography carrying hierarchy before color does, restrained single-accent
  palettes, and hover/focus states treated as a first-class design surface
  rather than a browser-default afterthought. This is the bar the FINAL STACK
  below exists to hit.

## 5. Component/effect libraries — use vs. avoid

| Library                            | Verdict                                                          | Why                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **shadcn/ui**                      | Use — is the foundation                                          | Owned source, Base UI-backed, current.                                                                                                                                                                                                                                 |
| **Vaul** (`vaul`)                  | Use                                                              | Best-in-class drawer primitive, tiny, gesture-correct on mobile.                                                                                                                                                                                                       |
| **Sonner** (`sonner`)              | Use                                                              | The toast component every current "good taste" stack ships; don't hand-roll.                                                                                                                                                                                           |
| **cmdk** (`cmdk`)                  | Use                                                              | Command palette (⌘K) — cheap way to read as a serious product.                                                                                                                                                                                                         |
| **Embla** (`embla-carousel-react`) | Use, only if we actually need a carousel                         | Lightest correct carousel; don't add speculatively.                                                                                                                                                                                                                    |
| **react-dropzone**                 | Use                                                              | For the document/PDF upload entry point into `ingest()`.                                                                                                                                                                                                               |
| **class-variance-authority**       | Use                                                              | Variant typing for every shadcn-style component.                                                                                                                                                                                                                       |
| **tailwind-merge**                 | Use                                                              | Required alongside CVA to dedupe conflicting Tailwind classes from `className` overrides.                                                                                                                                                                              |
| **next-themes**                    | Use                                                              | See §6 — drives the `data-theme`/`class` attribute, not manual `dark:` sprinkling.                                                                                                                                                                                     |
| **lucide-react**                   | Use                                                              | Icon set; consistent stroke width with Geist's neutrality.                                                                                                                                                                                                             |
| **tw-animate-css**                 | Use, not `tailwindcss-animate`                                   | The old plugin is JS-config-based and doesn't exist in a Tailwind-v4-idiomatic form; this is its CSS-first, `@theme`-compatible replacement (accordion/caret keyframes etc.).                                                                                          |
| **Recharts**                       | Use, only where we chart something real                          | e.g. render-cost/minute or duration breakdowns if/when the studio shows them. Do not add speculatively — it's the heaviest dependency in this table.                                                                                                                   |
| **Motion Primitives / React Bits** | Use selectively, **copy-paste only, never as an npm dependency** | Same ownership model as shadcn. Pull one component's source at a time for hero-moment flourishes (animated beams, text reveals).                                                                                                                                       |
| **Magic UI**                       | Use selectively, same copy-paste rule                            | Polished, restrained micro-interactions (marquee, animated lists) fit our "upbeat, not theatrical" brief better than Aceternity's darker, more dramatic default aesthetic.                                                                                             |
| **Aceternity UI**                  | **Avoid as a default source**                                    | Its default visual language (dark, glowing, dramatic 3D) fights the "elegant, minimal, light-and-dark-both-first-class" brief. Only reach for it if a specific one-off effect is worth the mismatch — vet each pull individually, don't adopt its aesthetic wholesale. |

None of the "selectively" libraries above appear as `package.json`
dependencies — by design, their components are copied into our own
`components/` tree, reviewed, and become ours (matching the "no
placeholders / everything must run" rule better than an opaque runtime dep
would).

## 6. Craft details — the difference between "fine" and "we clearly know

what we're doing"

1. **OKLCH, not HSL, for every color token.** HSL "lightness" is a display
   math construct, not a perceptual one — a linear sweep from light to dark
   in HSL passes through muddy, unevenly-bright intermediate values, which is
   exactly where gradients and 12-step tint/shade ramps go wrong. OKLCH is
   perceptually uniform: sweep `L` from 0.97 to 0.15 at fixed `C`/`H` and
   every step reads as an equal lightness step, for every hue, including our
   accent. Supported in every evergreen browser since mid-2023 — safe today.
2. **One neutral, one accent.** Pick a single OKLCH neutral ramp (`neutral`
   baseColor) and exactly one saturated accent hue. Accent only ever
   appears on small areas — a button, a focus ring, a badge — never as a
   background wash. This is Refactoring UI's single highest-leverage rule and
   the one "modern AI company" sites violate least.
3. **Semantic tokens, not raw utilities, in component code.** Components
   reference `bg-background`, `text-foreground`, `border-border`,
   `bg-primary` — never `bg-neutral-50` or a hex literal. The mapping from
   semantic token → concrete OKLCH value lives in exactly one place (the
   `@theme` block `docs/DESIGN.md` will pin), so retheming or adding a third
   theme is a one-file change.
4. **Dark mode via a `data-theme`/`class` attribute + `next-themes`, not
   `dark:` variants scattered through every component.** Define both `:root`
   and `.dark` (or `[data-theme="dark"]`) blocks once, at the token layer;
   components stay theme-agnostic because they only ever reference the
   semantic token. Sprinkling `dark:bg-zinc-800` through 40 components is the
   single most common way a codebase quietly drifts out of sync between
   themes.
5. **4px/8px spacing rhythm, no off-scale values.** Every margin, padding,
   gap is a multiple of 4px (Tailwind's default scale already encodes this).
   Never hand-write an arbitrary value like `mt-[13px]` — if the scale
   doesn't have the number you want, the design is wrong, not the scale.
6. **Optical type scale with real tracking control**, not just `font-size`
   steps. Large display type (Instrument Serif headlines, 48px+) gets
   slightly negative `letter-spacing` (tracking tight); small
   caps/labels/badges get slightly positive tracking and a bump in font
   weight or a step up in color-contrast rather than a bigger size — exactly
   Refactoring UI's "don't build hierarchy with font-size alone" rule made
   concrete.
7. **Layered, soft, slightly-tinted shadows, never a flat black
   drop-shadow.** Stack 2–3 shadows of increasing blur/spread at low
   opacity, each tinted a few degrees toward the neutral hue (not pure
   `rgba(0,0,0,…)`), to read as ambient depth instead of a pasted sticker.
8. **`focus-visible`, always, on every interactive element**, meeting at
   least 3:1 contrast against its background — never suppress the outline
   without replacing it. Keyboard users are not an edge case for a product
   whose primary artifact is generated from markdown/CLI input.
9. **`prefers-reduced-motion` respected globally**, wired once (Motion's
   `MotionConfig reducedMotion="user"` at the app root; a matching
   `@media (prefers-reduced-motion: reduce)` guard around any raw CSS
   keyframes/gradient-mesh animation), not re-implemented per component.
10. **Contrast targets checked in both themes, not just light.** Body text
    ≥ 4.5:1, large text/UI components ≥ 3:1, in both the light and dark token
    sets — check this at the token layer once rather than trusting that "it
    looked fine in light mode" transfers.
11. **Texture used sparingly and only where it earns its cost.** A very
    faint noise/grain overlay (SVG `feTurbulence`, <3% opacity) on large flat
    surfaces avoids banding on OKLCH gradient meshes and reads as
    "considered," but only on hero/marketing surfaces — never in the
    studio's working canvas, where it would compete with the actual
    hand-drawn video content.

---

## FINAL STACK (binding — exact packages, exact ranges)

Add these to `apps/web/package.json` when it is scaffolded (this repo's
`apps/web` is currently empty; no root/workspace files were touched by this
research). All ranges are `^` off the versions live on npm as of 2026-07-28.

```jsonc
{
  "dependencies": {
    "next": "^16.2.12",
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "@base-ui/react": "^1.6.0",
    "motion": "^12.43.0",
    "class-variance-authority": "^0.7.1",
    "tailwind-merge": "^3.6.0",
    "clsx": "^2.1.1",
    "next-themes": "^0.4.6",
    "lucide-react": "^1.27.0",
    "vaul": "^1.1.2",
    "sonner": "^2.0.7",
    "cmdk": "^1.1.1",
    "embla-carousel-react": "^8.6.0",
    "react-dropzone": "^19.1.1",
    "zod": "^3.24.1",
  },
  "devDependencies": {
    "tailwindcss": "^4.3.3",
    "@tailwindcss/postcss": "^4.3.3",
    "tw-animate-css": "^1.4.0",
    "shadcn": "^4.16.0",
  },
}
```

Notes on this list:

- **`zod` is pinned to `^3.24.1`, matching `@inkcast/core`'s dependency
  exactly** — npm's current `zod` latest is `4.x`, but the web app parses and
  patches the same `Storyboard` Zod schema `@inkcast/core` exports, so it
  **must** stay on the v3 line the workspace already committed to. Do not
  let the web app drift to zod v4; it would produce a second, incompatible
  `ZodSchema` type across the workspace. This is the one place this research
  overrides "use the newest version" in favor of workspace consistency.
- `recharts` is deliberately **not** in the default dependency list — add it
  only when a screen actually needs a chart (see §5); don't install
  speculatively.
- Radix (`radix-ui`) is deliberately **not** in the default list either —
  only add it if a specific Base UI primitive gap is hit; log that gap in
  `docs/DESIGN.md` if/when it happens so it isn't silently reintroduced
  everywhere.
- `shadcn` (the CLI) is a dev-time/codegen tool; initialize with
  `npx shadcn@latest init` (defaults to Base UI, OKLCH tokens, `neutral`
  base color — accept all three defaults) and add components with
  `npx shadcn@latest add <component>` as needed, rather than writing
  primitive-wrapping components by hand.
- Font loading (`next/font/google` for Geist + Geist Mono + Instrument
  Serif) needs no separate package — it's built into Next.js.

## DESIGN PRINCIPLES — the ten rules our UI must follow

1. Every color is a semantic token defined once in OKLCH, in one `@theme`
   block; components reference tokens, never raw hex/HSL/utility color
   classes.
2. One neutral ramp, one accent hue. Accent is for small, load-bearing
   elements only (primary action, focus ring, active state) — never a
   background.
3. Dark mode is `next-themes` + a `.dark`/`[data-theme]` token block, defined
   once. No component ever contains a `dark:` variant of its own.
4. Spacing is always a multiple of 4px. No arbitrary `[Npx]` values.
5. Hierarchy is built with weight, color-contrast, and tracking before it is
   built with font-size. Large display type gets tighter tracking; small
   label/caption type gets looser tracking and a weight bump.
6. Motion is spring-physics-driven (`motion/react`) for anything responding
   to user action, and always wrapped so `prefers-reduced-motion` disables it
   — set once at the app root, never per component.
7. Every interactive element has a visible `focus-visible` state at ≥3:1
   contrast. Never remove an outline without replacing it.
8. Depth comes from layered, neutral-tinted soft shadows and 1px borders —
   never a flat black drop-shadow, never skeuomorphic bevels.
9. Contrast is checked in both light and dark themes independently: ≥4.5:1
   body text, ≥3:1 large text and UI chrome.
10. Every UI dependency is either owned source (shadcn-style copy-paste) or a
    small, single-purpose library (Vaul, Sonner, cmdk, Embla) — never a
    heavyweight all-in-one component runtime. If it can't be justified by a
    screen that exists today, it doesn't go in `package.json` yet.

## Sources

- [shadcn/ui — Next.js 15 + React 19](https://ui.shadcn.com/docs/react-19), [Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4), [components.json](https://ui.shadcn.com/docs/components-json), [January 2026 changelog — Base UI docs](https://ui.shadcn.com/docs/changelog/2026-01-base-ui), [July 2026 changelog — Base UI as the default](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)
- [Tailwind CSS v4.0 announcement](https://tailwindcss.com/blog/tailwindcss-v4)
- [Motion for React — upgrade guide](https://motion.dev/docs/react-upgrade-guide), [Motion for React — install](https://motion.dev/docs/react-installation), [motion on npm](https://www.npmjs.com/package/motion)
- [Next.js `viewTransition` config](https://nextjs.org/docs/app/api-reference/config/next-config-js/viewTransition), [Next.js view transitions guide](https://nextjs.org/docs/app/guides/view-transitions)
- [Geist — Google Fonts](https://fonts.google.com/specimen/Geist), [Instrument Serif × Instrument Sans pairing](https://www.fontpair.co/pairings/instrument-serif-instrument-sans)
- [Caveat — google/fonts (OFL)](https://github.com/google/fonts/tree/main/ofl/caveat), [Patrick Hand — google/fonts (OFL)](https://github.com/google/fonts/tree/main/ofl/patrickhand), [Shantell Sans — google/fonts (OFL)](https://github.com/google/fonts/tree/main/ofl/shantellsans), [Gaegu — google/fonts (OFL)](https://github.com/google/fonts/tree/main/ofl/gaegu)
- [tw-animate-css (tailwindcss-animate replacement)](https://github.com/Wombosvideo/tw-animate-css)
- [react-bits vs Aceternity vs Magic UI, 2026](https://www.pkgpulse.com/guides/react-bits-vs-aceternity-magic-ui-2026)
- [OKLCH in CSS: why we moved from RGB and HSL](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)
- [Refactoring UI — key points summary](https://medium.com/design-bootcamp/top-20-key-points-from-refactoring-ui-by-adam-wathan-steve-schoger-d81042ac9802)
- npm registry (`registry.npmjs.org`) queried directly for exact current
  versions of: `next`, `react`, `react-dom`, `@base-ui-components/react`,
  `@base-ui/react`, `radix-ui`, `motion`, `tailwindcss`,
  `@tailwindcss/postcss`, `tw-animate-css`, `class-variance-authority`,
  `tailwind-variants`, `next-themes`, `lucide-react`, `vaul`, `sonner`,
  `cmdk`, `embla-carousel-react`, `react-dropzone`, `recharts`, `clsx`,
  `tailwind-merge`, `zod`, `shadcn`.
