/**
 * The marketing surface's public API. `app/(marketing)/page.tsx` renders
 * `Landing`; the layout renders `MarketingHeader`. The October 2026 revamp
 * folded the old per-section components into `landing.tsx` and deleted them.
 */

export { Landing } from './landing';
export { Logo, LogoMark } from './logo';
export { MarketingHeader } from './marketing-header';
export {
  LICENCE,
  repoPath,
  repoUrl,
  sectionLinks,
  STUDIO_HREF,
  STUDIO_TOPIC_MAX,
  STUDIO_TOPIC_PARAM,
  studioTopicHref,
  type NavLink,
} from './site-config';
