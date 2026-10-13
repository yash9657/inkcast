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

/**
 * Where the typed topic waits while a visitor signs in, and how long it waits.
 *
 * `?topic=` is the primary carrier and Clerk's `redirect_url` is what brings it
 * back, so this is the belt to that braces — and it exists because the failure
 * it covers is the one that would actually happen. A sign-up with an emailed
 * verification link finishes in whatever tab the mail client opens, and a
 * password manager or an OAuth hop can drop a query string on the way through.
 * A visitor who typed a sentence on the landing page and lands on an empty
 * studio box has been made to do the work twice, which turns the try strip from
 * the zero-friction hook into a bait.
 *
 * `sessionStorage`, not `localStorage`: this is one tab's unfinished business,
 * and it should die with the tab rather than resurface next week. The stored
 * value carries the time it was written and is only honoured for the window
 * below — long enough for an email round trip, short enough that a topic never
 * appears in a box the visitor did not just type it into. It is read exactly
 * once and cleared, and only when the box is empty and no `?topic=` arrived.
 *
 * Nothing sensitive is involved: the value is a sentence the visitor typed into
 * a public form and which is already in their URL bar and their history.
 */
const STUDIO_TOPIC_STASH_KEY = 'inkcast.studio.topic';
const STUDIO_TOPIC_STASH_TTL_MS = 30 * 60 * 1000;

/**
 * Hold a topic for the far side of a sign-in. Browser only; never throws.
 *
 * Called by the sign-in wall (`app/(app)/sign-in-gate.tsx`) at the moment a
 * signed-out visitor arrives carrying one.
 */
export function stashTopic(topic: string): void {
  const trimmed = topic.trim().slice(0, STUDIO_TOPIC_MAX);
  if (trimmed === '') return;
  try {
    window.sessionStorage.setItem(
      STUDIO_TOPIC_STASH_KEY,
      JSON.stringify({ topic: trimmed, at: Date.now() }),
    );
  } catch {
    // Safari in private browsing throws on `setItem` rather than no-opping, and
    // a quota can throw anywhere. This is the backup path — `?topic=` and
    // Clerk's `redirect_url` are the primary ones — so losing it costs nothing
    // and must not surface as an error.
  }
}

/**
 * Read and clear a stashed topic, if one is still fresh. Browser only.
 *
 * Read-once-and-clear is the whole contract, and the TTL is the other half: a
 * topic that survived into a later visit would appear in a box the visitor did
 * not just type it into, which is a worse outcome than losing it. Called by
 * `components/studio/create-form.tsx`, and only when the URL carried nothing and
 * the box is empty.
 */
export function takeStashedTopic(): string | null {
  try {
    const raw = window.sessionStorage.getItem(STUDIO_TOPIC_STASH_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(STUDIO_TOPIC_STASH_KEY);
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { topic, at } = parsed as { topic?: unknown; at?: unknown };
    if (typeof topic !== 'string' || typeof at !== 'number') return null;
    if (!Number.isFinite(at) || Date.now() - at > STUDIO_TOPIC_STASH_TTL_MS) return null;
    const trimmed = topic.trim();
    return trimmed === '' ? null : trimmed;
  } catch {
    // Storage disabled, or a hand-edited value that is not our JSON. Either way
    // there is nothing to restore and nothing worth saying about it.
    return null;
  }
}

/* ------------------------------------------------------------ what this box is */

/**
 * Whether *this deployment* asks for a sign-in before it will draw anything.
 *
 * The one switch behind every account-shaped sentence on this surface. It exists
 * because the copy this file governs went from true to false the day the hosted
 * site grew a gate: "No account, no key" is still exactly right about the
 * software, and still exactly wrong as a description of pressing the button on
 * inkcast.video. Rule 1 at the top of this file does not allow a claim that is
 * false of the page it is printed on, and the two-deployment answer is not to
 * pick a side — the local path really is free, keyless and open source, and that
 * is worth more said honestly than said everywhere.
 *
 * Derived from the Clerk publishable key rather than from a flag of its own,
 * because a flag of its own is a second thing to remember and the failure mode
 * of forgetting it is a landing page that lies. An operator who configures
 * accounts gets truthful copy without doing anything else.
 *
 * **This is copy, never enforcement.** The gate is `readAccess()` in
 * `app/(app)/access.ts` and the ownership checks in `app/api/_lib/session.ts`;
 * nothing on the marketing surface can let anybody in or keep anybody out. And
 * because the landing route is prerendered — `next build` reports `○ /` — the
 * value is fixed when the image is built, exactly like
 * `NEXT_PUBLIC_INKCAST_BASE_URL` and `NEXT_PUBLIC_INKCAST_REPO_URL`, whose build
 * arguments the Dockerfile already passes and explains for this same reason.
 */
export const signInRequired: boolean =
  (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').trim() !== '';

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
 * These optional project previews are deployment configuration. User films
 * live in project directories outside the build (see
 * `app/api/media/[id]/[...path]/route.ts` — "working state rather than static
 * assets"), so the landing page can only ever *point at* one. The launch runbook
 * renders three showcase films and pins them; these env vars select those
 * previews. The approved GPS hero film is a separate, checked-in public asset
 * under `apps/web/public/showcase/`; it never needs access to a user's project.
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
