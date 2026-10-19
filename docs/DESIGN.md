# Inkcast design system: Ink, paper, highlighter

The October 2026 revamp. It replaces the evergreen "editorial studio" system. This document is the visual and interaction authority; product behaviour lives in `PRODUCT.md`.

## 1. The idea

Inkcast's output is blue-black ink drawn on a white board. The interface is the **page that ink lands on**: quiet, warm, typographic, so the drawings carry the colour and the personality.

There are three ingredients, and nothing else is decorative:

| Ingredient      | Role                                                        | Never                       |
| --------------- | ----------------------------------------------------------- | --------------------------- |
| **Ink**         | Text, icons, primary buttons, selected edges                | Large tinted backgrounds    |
| **Paper**       | Page, cards, recessed wells, borders                        | Pure white or pure grey     |
| **Highlighter** | Behind the words that matter; the fill of a selected choice | Body text, buttons, borders |

The highlighter is used the way a student uses one: rarely, on purpose. One marked phrase per screen at most. If everything is highlighted, nothing is.

**Not this:** gradients, glass panels, glowing blobs, emoji bullets, purple, icon-in-a-tinted-square feature grids, invented stats or testimonials, slogan triplets ("Your words. Your video. Your way."), filler microcopy ("Your creative workspace").

## 2. Principles for every screen

1. **One obvious next step.** One primary (ink) button per view. Everything else is secondary, ghost or a link.
2. **Say what it is in plain words.** Headlines describe the outcome ("Explain anything with a hand-drawn video"), not a mood.
3. **Defaults first, options on request.** A first-time creator sees the source box, format and length. Voice, style, title and providers are behind "More options" with a one-line summary of the current choices.
4. **Show the real output.** Real thumbnails, real films. Illustrations are labelled as illustrative.
5. **Every state has words.** Loading says what is happening, empty says what to do, errors say how to recover (use `Callout`).
6. **Nothing below 360px breaks.** No horizontal scroll, 44px touch targets.

## 3. Tokens

`apps/web/app/globals.css` is the source of truth, in three layers:

1. **Primitive scales:** `--ink-950…400`, `--paper-50…400`, `--hl-300…700`, `--blue-500/300`. Use these only inside token definitions.
2. **Semantic roles:** `--background`, `--foreground`, `--card`, `--muted`, `--muted-foreground`, `--border`, `--border-subtle`, `--input`, `--primary(-foreground)`, `--accent` (hover surface), `--accent-soft` + `--accent-border` (selected), `--highlighter`, `--ring`, `--link`, and the status colours `--success`, `--warning`, `--destructive`, `--info`. The dark theme swaps these roles, never component classes.
3. **Tailwind utilities** via `@theme inline`: `bg-card`, `text-muted-foreground`, `border-border-subtle`, `bg-highlighter`…

The whiteboard palette (`--paper`, `--ink`, `--ink-blue/red/green/amber/violet`) previews the exported video and stays light in both themes.

### Colour roles

| Token                         | Light                 | Dark                          | Use                        |
| ----------------------------- | --------------------- | ----------------------------- | -------------------------- |
| `background`                  | paper-100 `#faf9f5`   | ink-950 `#0c0f16`             | Page                       |
| `card`                        | paper-50              | ink 0.205                     | Working surfaces           |
| `muted`                       | paper-200             | ink 0.235                     | Wells, inactive segments   |
| `foreground`                  | ink-900               | paper                         | Text                       |
| `muted-foreground`            | ink-600 (≥ 4.5:1)     | 0.74 L                        | Secondary text             |
| `border` / `border-subtle`    | paper-400 / 300       | 0.32 / 0.27 L                 | Separation                 |
| `input`                       | 0.72 L (3:1 boundary) | 0.5 L                         | Control edges              |
| `primary`                     | ink-900               | paper                         | The one primary action     |
| `accent-soft`/`accent-border` | highlighter 32% / ink | highlighter 12% / highlighter | Selected tiles and choices |
| `ring`                        | blue-500              | blue-300                      | Focus only                 |

### Type

| Role            | Face                   | Size                     | Where                          |
| --------------- | ---------------------- | ------------------------ | ------------------------------ |
| `display-xl`    | Newsreader 420         | clamp 42 → 80px, lh 1.02 | Landing hero only              |
| `display-lg`    | Newsreader 430         | clamp 32 → 52px          | Landing section headings       |
| `display-md`    | Newsreader 450         | clamp 28 → 38px          | App page titles (h1)           |
| h3 / card title | Inter 600              | 16–18px                  | Cards, steps, groups           |
| body            | Inter 400              | 16px / 1.625             | Prose                          |
| UI label        | Inter 500              | 14px                     | Buttons, labels, tabs          |
| meta            | Inter 400–500          | 12px                     | Timestamps, hints              |
| `eyebrow`       | Inter 600 caps +0.06em | 12px                     | Rare group labels              |
| mono            | JetBrains Mono         | 12px, `tabular`          | Timecodes, aspect ratios, keys |
| hand            | Shantell Sans          | any                      | Only when quoting the board    |

`h1` and `h2` default to the serif; `h3`–`h6` default to the sans. Never set UI controls in the serif.

### Space, radius, elevation, motion

- **Spacing:** 4px base. Inside a control 8–12px; between related controls 16–24px; between groups 32–48px; between page sections 80–112px.
- **Layout:** `container-page` (72rem) for pages, `container-content` (60rem) for app forms, `--reading-width` 40rem for prose. Gutter `clamp(16px, 4vw, 40px)`.
- **Radius:** controls 10px (`rounded-md`), boards 12px (`rounded-lg`/`xl`), cards 16px (`rounded-xl`), feature panels 24px (`rounded-3xl`), buttons, chips and segmented controls are pills.
- **Elevation:** flat by default, hairline borders. `shadow-card` for resting cards that need lift, `shadow-pop` for the composer and menus, `shadow-overlay` for dialogs and the hero film.
- **Motion:** 140ms for state, 200ms for layout, `ease-out` (expo). Hover lifts are ≤ 2px. All non-essential motion stops under `prefers-reduced-motion`.

## 4. Components

Everything comes from `components/ui`. If a screen needs something new, add a primitive there.

- **Button.** Pill. `default` (ink), `secondary` (card + border), `outline`, `ghost`, `link`, `destructive`. Sizes xs 28 / sm 36 / default 40 / lg 48.
- **Input / Textarea / Select.** 44px, 10px radius, `border-input`. Focus darkens the border to ink and adds a soft highlighter halo.
- **Tabs.** Segmented pill: `muted` track, the active segment is a raised `card` pill.
- **TileGroup.** Native radios. Selected = `accent-soft` fill, ink edge, and an ink check disc (state is never colour alone).
- **Callout.** `info | warning | destructive | success`, with icon, title, body, optional action. Use for every caveat and error that belongs to content.
- **Badge.** `default` is a highlighter tag; `neutral`, `success`, `warning`, `destructive` are tinted without borders.
- **`marker` utility.** The highlighter swash behind inline text. Wraps line by line.

## 5. Surfaces

- **Marketing.** Centered hero: headline with one marked phrase, one-line lead, a pill composer that is a plain GET form to `/studio?topic=`, three starter questions, one line of fine print. Then the real GPS film, three steps, three formats, questions, a closing composer on the pale highlighter band.
- **Studio shell.** One sticky top bar: logo, Create / Library / Settings, theme, account. No sidebar, no taglines, no footer.
- **Create.** A single centred column: "What do you want to explain?", the source (write / upload / link), starter chips, format and length, a "More options" disclosure (voice, style, title, providers) with its summary, and the Create button.
- **Library.** Title + count + New video. Search and filters. Cards show the real `thumbnail.png`, title, duration, age; status only when not ready.
- **Project.** Back link, serif title, meta, caveats as one Callout, one primary action (Download) beside Share and an overflow menu. Player first, storyboard beside it, refine box beneath.
- **Settings.** "Inkcast works without any keys." Providers as cards with connected state, key field and validation.

## 6. Brand

`assets/brand/geometry.json` is the single geometry: a rounded tile, a pen stroke with a cut nib, and a play shape. Colours come from `--mark-tile`, `--mark-stroke`, `--mark-play`: an ink tile with a paper stroke and a highlighter play in light; a highlighter tile with ink marks in dark. `assets/brand/make-brand-assets.mjs` regenerates the SVG marks, favicon, Apple icon, social card and the renderer's signature from those tokens. The wordmark is lowercase "inkcast" in Inter 600 at -0.03em.

## 7. Accessibility

Visible focus on everything (2px `ring` with a paper gap on filled controls). Labels stay visible; placeholders are examples. Text contrast ≥ 4.5:1 and control boundaries ≥ 3:1 in both themes. Highlighter is never the only signal of state. Reduced motion is respected. Skip link targets `#main` on every layout.
