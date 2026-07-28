/**
 * The marketing surface's public API. `app/(marketing)/page.tsx` composes the
 * page out of these; nothing outside this directory should reach past the barrel.
 */

export { ClosingCta } from './closing-cta';
export { CommandSnippet } from './command-snippet';
export { CostComparison } from './cost-comparison';
export { Faq } from './faq';
export { Features } from './features';
export { Hero } from './hero';
export { HowItWorks } from './how-it-works';
export { InkDemo } from './ink-demo';
export { Logo, LogoMark } from './logo';
export { Reveal, type RevealProps } from './reveal';
export { CodeChip, Section, SectionHeading } from './section';
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
  STUDIO_HREF,
  type NavLink,
} from './site-config';
