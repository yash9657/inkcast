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

/**
 * In-page sections, in document order. Used by the header and the footer.
 *
 * Three, not five. `PLAN-LAUNCH.md` C5 specifies the nav as
 * `How it works · Examples · FAQ`, and the reason to obey that literally is not
 * deference: a nav row has to survive 360px, and at 360px the fourth link is
 * what pushes the CTA into the menu. Cost and Features are still on the page and
 * still reachable by scrolling — they are simply not worth a slot in a row whose
 * job is to get somebody to the studio.
 */
export const sectionLinks: readonly NavLink[] = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#examples', label: 'Examples' },
  { href: '#faq', label: 'FAQ' },
] as const;

/* ------------------------------------------------------- the zero-friction hook */

/**
 * The query parameter the try strip hands `/studio`.
 *
 * `/studio` already reads `?example=` (`components/studio/create-form.tsx`),
 * but that selects one of a fixed set of bundled documents by slug — it cannot
 * carry free text. So the landing page's one-line input needs its own parameter,
 * and this constant is the contract for it: **the studio form must seed its text
 * box from `?topic=`**. Until it does, the link still resolves — a visitor lands
 * on the studio with an empty box rather than on a 404 — which is why this
 * shipped before the reader existed rather than waiting for it.
 *
 * Named `topic` rather than `text` or `q` because that is what the visitor typed
 * into a box labelled with a topic, and a parameter name that describes the
 * user's intent survives a change of implementation on the other side.
 */
export const STUDIO_TOPIC_PARAM = 'topic';

/**
 * `/studio?topic=…`, or the bare studio href when there is nothing to carry.
 *
 * Trimmed and length-capped before it goes anywhere near a URL. The cap is not
 * security — the endpoint enforces its own body limits — it is that a query
 * string is the wrong container for a document, and somebody pasting an essay
 * into a one-line box should get the studio, whose textarea is built for it,
 * rather than a 431 from a proxy that dislikes long URLs.
 */
export const STUDIO_TOPIC_MAX = 300;

export function studioTopicHref(topic: string): string {
  const trimmed = topic.trim().slice(0, STUDIO_TOPIC_MAX);
  if (trimmed === '') return STUDIO_HREF;
  return `${STUDIO_HREF}?${STUDIO_TOPIC_PARAM}=${encodeURIComponent(trimmed)}`;
}

/* --------------------------------------------------------- the showcase films */

/** The three frame shapes the renderer supports (`meta.aspect`). */
export type ShowcaseAspect = '16:9' | '9:16' | '1:1';

/**
 * Project ids come from `projectId()` in core: base36 timestamps or hex digests.
 * Same alphabet `isValidProjectId()` enforces in `lib/store.ts` — repeated here
 * rather than imported because that module reaches for `node:fs` at load time
 * and this one is bundled into the client.
 */
const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function showcaseId(value: string | undefined): string | null {
  const id = value?.trim();
  if (!id || !PROJECT_ID_RE.test(id)) return null;
  return id;
}

/**
 * The three films on the format row, one per frame shape, by project id.
 *
 * They are configuration rather than checked-in assets for a reason that is
 * structural: there is no `apps/web/public/`, and there is not going to be one.
 * A finished film lives in a project directory outside the build (see
 * `app/api/media/[id]/[...path]/route.ts` — "working state rather than static
 * assets"), so the landing page can only ever *point at* one. The launch runbook
 * renders three showcase films and pins them; these env vars are how they arrive
 * on this page.
 *
 * Unset is a supported state, not a broken one — the same `degrade, never
 * fabricate` rule `repoUrl` follows. An unconfigured card draws an ink sketch of
 * a board in the right shape instead of hotlinking a file that does not exist.
 */
export const showcaseProjects: Readonly<Record<ShowcaseAspect, string | null>> = {
  '16:9': showcaseId(process.env.NEXT_PUBLIC_INKCAST_SHOWCASE_LANDSCAPE),
  '9:16': showcaseId(process.env.NEXT_PUBLIC_INKCAST_SHOWCASE_VERTICAL),
  '1:1': showcaseId(process.env.NEXT_PUBLIC_INKCAST_SHOWCASE_SQUARE),
};

/**
 * The looping four-second preview for a project, and the still to show while it
 * loads or if it is missing. Both are produced per project by the export bundle
 * (`PLAN-LAUNCH.md` B1) and served by `/api/media/:id/:path`.
 */
export function showcasePreviewSrc(id: string): string {
  return `/api/media/${encodeURIComponent(id)}/preview.gif`;
}

export function showcasePosterSrc(id: string): string {
  return `/api/media/${encodeURIComponent(id)}/thumbnail.png`;
}

/*
 * There is deliberately no `showcaseShareHref()`. A `/share/:id` page is only
 * public once its owner has flipped the share flag (`PLAN-LAUNCH.md` D3 makes
 * that default off), so a card that linked to one would be a link this surface
 * cannot promise resolves — and "every link resolves or is not rendered" is the
 * rule at the top of this file. The preview loops in place instead.
 */

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
