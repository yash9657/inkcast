/**
 * The marketing surface's single source of truth for links, claims and numbers.
 *
 * Two rules govern what may live in here:
 *
 * 1. **Every figure is verified.** The per-minute costs come from
 *    `docs/CONTRACT.md`; the hosted list prices come from
 *    `docs/research/golpo-ux.md`, which recorded them from public pricing pages
 *    on 2026-07-28. Nothing is estimated, rounded up for effect, or invented,
 *    and there are no user counts, testimonials or customer logos anywhere on
 *    this surface because we do not have any.
 * 2. **Every link resolves or is not rendered.** The repository URL is not
 *    knowable at build time from inside the repo, so it comes from
 *    `NEXT_PUBLIC_INKCAST_REPO_URL`. When it is unset, the source links are
 *    omitted rather than pointed at a guess — the same "degrade, never
 *    fabricate" rule the pipeline applies to a missing API key.
 */

/** The studio route. Owned by the studio agent; this surface only links to it. */
export const STUDIO_HREF = '/studio';

/**
 * Public repository URL, or `null` when it has not been configured.
 * Callers must handle `null` — see `siteFooter`/`SiteHeader` for the pattern.
 */
export const repoUrl: string | null = process.env.NEXT_PUBLIC_INKCAST_REPO_URL?.trim() || null;

/** A repository sub-path, or `null` when there is no repository configured. */
export function repoPath(path: string): string | null {
  if (!repoUrl) return null;
  return `${repoUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export type NavLink = { href: string; label: string };

/** In-page sections, in document order. Used by the header and the footer. */
export const sectionLinks: readonly NavLink[] = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#cost', label: 'Cost' },
  { href: '#faq', label: 'FAQ' },
] as const;

/* -------------------------------------------------------------- the numbers */

/**
 * Marginal cost per finished minute, both paths. From `docs/CONTRACT.md`:
 * "our marginal cost target is under $0.20/minute, and $0.00 with fully local
 * models."
 */
export const COST_LOCAL = '$0.00';
export const COST_CLOUD = 'Under $0.20';
/**
 * The same ceiling as a compact glyph, for the display-size tile where
 * "Under $0.20" would wrap. Never used without a spoken equivalent beside it,
 * because screen readers routinely swallow a bare "<".
 */
export const COST_CLOUD_TILE = '<$0.20';

/**
 * Public list pricing for hosted whiteboard-video generators, recorded
 * 2026-07-28 (`docs/research/golpo-ux.md`). Stated as a category rather than
 * attached to a vendor name: the point of the comparison is the shape of the
 * bill, not a fight with one company.
 */
export const HOSTED_PER_MINUTE = '$1.25 – $8.00';
/** Same range, tightened so it fits a display-size tile on one line. */
export const HOSTED_PER_MINUTE_TILE = '$1.25–8.00';
export const HOSTED_MONTHLY = '$39.99 – $999.99';
export const HOSTED_COLOUR_FROM = '$199.99/mo';
export const HOSTED_FRAME_EDIT_FROM = '$499.99/mo';
export const HOSTED_CHEAPEST_LENGTH = '30 seconds';
export const PRICING_AS_OF = 'July 2026';

/** SPDX identifier from the repository's root `package.json`. */
export const LICENCE = 'AGPL-3.0-only';
