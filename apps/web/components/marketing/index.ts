/**
 * The marketing surface's public API. `app/(marketing)/page.tsx` composes the
 * page out of these; nothing outside this directory should reach past the barrel.
 *
 * Two things are deliberately NOT here, and the omission is the rule rather than
 * an oversight: `board-sketch.tsx` and `format-preview.tsx`. Both exist to serve
 * `format-row.tsx`'s three-stage fallback chain (gif → still → drawn sketch), and
 * a sketch of a board is meaningless outside a card that says which format it is
 * standing in for. Exporting them would invite a second, unsupervised call site
 * for a component whose whole contract is "the thing the format card falls back
 * to". `logo.tsx` is re-exported because the footer and the app shell genuinely
 * need the mark.
 */

export { ClosingCta } from './closing-cta';
export { CommandSnippet } from './command-snippet';
export { CostComparison } from './cost-comparison';
export { Faq } from './faq';
export { Features } from './features';
export { FormatRow } from './format-row';
export { Hero } from './hero';
export { HowItWorks } from './how-it-works';
export { InkDemo } from './ink-demo';
export { Logo, LogoMark } from './logo';
export { MarketingHeader } from './marketing-header';
export { Reveal, type RevealProps } from './reveal';
export { CodeChip, Section, SectionHeading } from './section';
export { TryStrip } from './try-strip';
export {
  COST_CLOUD,
  COST_CLOUD_TILE,
  COST_LOCAL,
  HOSTED_CHEAPEST_LENGTH,
  HOSTED_COLOUR_FROM,
  HOSTED_FRAME_EDIT_FROM,
  HOSTED_MONTHLY,
  HOSTED_PER_MINUTE,
  HOSTED_PER_MINUTE_TILE,
  LICENCE,
  PRICING_AS_OF,
  repoPath,
  repoUrl,
  sectionLinks,
  showcaseProjects,
  STUDIO_HREF,
  STUDIO_TOPIC_MAX,
  STUDIO_TOPIC_PARAM,
  studioTopicHref,
  type NavLink,
  type ShowcaseAspect,
} from './site-config';
