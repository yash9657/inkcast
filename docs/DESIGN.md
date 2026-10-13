# Inkcast design system

The October 2026 redesign replaces the former violet, square-cornered, hard-shadow system. This is the current visual authority. Product behavior is recorded in PRODUCT.md.

## Direction
A contemporary educational journal brought into a working video studio: warm paper, evergreen ink, spacious composition, and the actual whiteboard as the visual focus. Clear diagrams and useful artifacts carry the personality. No decorative gradients, glass panels, hard shadows, generic feature-card grids, or fabricated social proof.

## Source of truth
`apps/web/app/globals.css` owns color, typography, spacing, radius, elevation and motion tokens. Tailwind v4 consumes them through `@theme`. Components use semantic utilities, never their own light/dark palette. The two themes are defined together. Brand assets derive their colors from this file.

## Type and rhythm
Self-hosted Space Grotesk for headings and the wordmark, Inter for UI and prose, JetBrains Mono for timecodes/code, Shantell Sans only inside the whiteboard. Body 16px; UI labels 14px; supplementary metadata 12px. Display sizes respond to available width. Tracking never below -0.04em. Spacing uses a 4px base; content groups use 8–16px, form sections 24–32px, page sections 64–112px.

## Colors and surfaces
`background` is warm paper / deep evergreen charcoal; `card` is the working surface; `muted` is a recessed area. `foreground` and `muted-foreground` establish hierarchy. `primary` is evergreen / pale sage; `primary-foreground` is its paired text. `accent` is the selected/hover surface. `border` separates regions; `input` gives controls a stronger edge. Status colors remain semantic. `brand-canvas` and `brand-apricot` are supporting presentation surfaces, with their own paired ink colors.

The whiteboard retains its light `paper`/`ink` palette in both themes because it previews the exported artifact.

## Components
Use `components/ui` primitives. Buttons have 8px corners, 40px standard height and 48px prominent height; compact variants are 36px. Primary fill has no shadow. Cards are 16px-radius bordered surfaces without another layer of elevation. Inputs use a visible border, 44px height and a clear focus outline. Tiles are accessible radio groups. Tabs, selects, dialogs and menus retain Base UI keyboard behavior. Icons come from Lucide at consistent stroke weight.

## Layout
Marketing: broad editorial opening with a working topic field; a large source-to-whiteboard demonstration; distinct sections for workflow, formats and questions. Studio: persistent sidebar on desktop, compact navigation on mobile; source before configuration; advanced controls disclosed on demand. Library: searchable projects with status filters and clear empty/retry states. Settings: provider groups with connected state and useful key handling copy. Project: preview first, editing and scene navigation adjacent.

## Interaction and accessibility
Every interactive element has visible focus. Labels stay visible; placeholders are examples. Errors explain recovery. Loading and empty states identify what happens next. Reduced motion stops nonessential animation. Text selection, caret and scrollbar colors use tokens. Mobile controls remain comfortably tappable; the layout must work at 360px without horizontal overflow.

## Brand
`assets/brand/geometry.json` is the single geometry definition. `components/marketing/logo.tsx` reads it; `assets/brand/make-brand-assets.mjs` generates standalone SVG, favicon, Apple icon and social card. The mark is a rounded evergreen tile containing an ink stroke and forward play shape. No separate legacy wordmark.
