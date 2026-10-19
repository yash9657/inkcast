import { Logo } from '@/components/marketing/logo';
import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { Callout } from '@/components/ui/callout';
import { mediaUrl, parseProjectDetail, projectPath, videoUrl, type ProjectDetail } from '@/lib/api';
import { aspectRatio, clock } from '@/components/studio/format';
import { isMeasured, totalDuration } from '@/components/studio/board';

/**
 * The public page for one finished explainer.
 *
 * No app chrome, no auth, no client JavaScript for playback: a native `<video>`
 * with controls, a title, and a way back to the tool. It is a server component
 * so the title and the video are in the HTML — which is the whole point, since a
 * page a crawler cannot see is a page nobody can share.
 */

/** Output pixel dimensions, mirroring `frameSize()` in @inkcast/core. */
function frameFor(aspect: string): { width: number; height: number } {
  if (aspect === '9:16') return { width: 1080, height: 1920 };
  if (aspect === '1:1') return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

type Shared = ProjectDetail & { base: string };

/** One fetch per request, shared between `generateMetadata` and the page. */
const load = cache(async (id: string): Promise<Shared | null> => {
  const configured = process.env.NEXT_PUBLIC_INKCAST_BASE_URL;
  let base = configured?.replace(/\/+$/, '') ?? '';
  if (!base) {
    const headerList = await headers();
    const host = headerList.get('host');
    if (!host) return null;
    const proto =
      headerList.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    base = `${proto}://${host}`;
  }

  try {
    const res = await fetch(`${base}${projectPath(id)}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const detail = parseProjectDetail((await res.json()) as unknown, id);
    return { ...detail, base };
  } catch {
    // The studio server is the only source of truth here; if it cannot answer,
    // this is a 404 rather than a half-rendered page.
    return null;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await load(id);
  if (!data) return { title: 'Explainer not found' };

  const { project, storyboard, base } = data;
  const relativeVideo = videoUrl(project);
  const video = relativeVideo ? `${base}${relativeVideo}` : undefined;
  const relativeThumb = mediaUrl(project.id, project.thumbnailPath);
  const thumbnail = relativeThumb ? `${base}${relativeThumb}` : undefined;
  const aspect = storyboard?.meta.aspect ?? '16:9';
  const frame = frameFor(aspect);

  const description =
    storyboard?.scenes[0]?.narration.slice(0, 200) ??
    'A hand-drawn explainer, planned on one growing canvas and narrated. Made with Inkcast.';

  return {
    title: project.title,
    description,
    alternates: { canonical: `${base}/share/${id}` },
    openGraph: {
      title: project.title,
      description,
      siteName: 'Inkcast',
      type: 'video.other',
      url: `${base}/share/${id}`,
      ...(thumbnail ? { images: [{ url: thumbnail, ...frame }] } : {}),
      ...(video ? { videos: [{ url: video, type: 'video/mp4', ...frame }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: project.title,
      description,
      ...(thumbnail ? { images: [thumbnail] } : {}),
    },
    robots: { index: true, follow: true },
  };
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await load(id);
  if (!data) notFound();

  const { project, storyboard } = data;
  const src = videoUrl(project);
  const poster = mediaUrl(project.id, project.thumbnailPath);
  const aspect = storyboard?.meta.aspect ?? '16:9';
  const measured = storyboard ? isMeasured(storyboard) : false;
  const duration =
    project.durationSec ?? (storyboard && measured ? totalDuration(storyboard) : undefined);

  const frameWidth = aspect === '9:16' ? 'max-w-sm' : aspect === '1:1' ? 'max-w-xl' : 'max-w-4xl';

  return (
    <div className="flex min-h-svh flex-col">
      <header className="container-page flex h-(--header-height) items-center justify-between">
        <Link href="/" className="focus-ring rounded-md" aria-label="Inkcast home">
          <Logo size={26} />
        </Link>
        <Link
          href="/studio"
          className="focus-ring inline-flex h-9 items-center rounded-pill border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:border-input"
        >
          Create your own
        </Link>
      </header>

      <main id="main" className="container-page flex flex-1 flex-col items-center py-8 sm:py-14">
        <div className={`flex w-full flex-col gap-6 ${frameWidth}`}>
          {src ? (
            <video
              controls
              playsInline
              preload="metadata"
              src={src}
              poster={poster}
              aria-label={project.title}
              className="w-full rounded-xl border border-border-subtle bg-paper shadow-overlay"
              style={{ aspectRatio: aspectRatio(aspect) }}
            />
          ) : (
            <div
              className="dot-grid flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-input bg-paper p-8 text-center text-ink"
              style={{ aspectRatio: aspectRatio(aspect) }}
            >
              <p className="font-hand text-xl">Still being drawn…</p>
              <p className="max-w-sm text-sm opacity-70">
                This video isn’t finished yet. Check back in a few minutes.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <h1 className="display-md">{project.title}</h1>
            <p className="tabular text-sm text-muted-foreground">
              {[
                duration ? clock(duration) : null,
                storyboard ? `${storyboard.scenes.length} scenes` : null,
                project.grounding === 'document' ? 'Taught from a source document' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          {/* What the facts in this film rest on (plan 5.1; audit S0-a). This is the
              surface the honesty is most for: a stranger arriving at a shared link has no
              other way to tell a film built from a document somebody supplied from one
              taught out of a model's memory, and the finished mp4 looks identical either
              way. Absent renders nothing — a film cast before the pipeline recorded this
              has no answer, and `parametric` is not the honest default for it. */}
          {project.grounding === 'parametric' ? (
            <Callout tone="warning">
              Made from an AI model’s own knowledge, not a source document. Double-check the facts.
            </Callout>
          ) : null}
        </div>
      </main>

      {/* "Run it yourself" rather than "runs locally": this is the most-shared surface
          the project has, and the film a stranger is watching did not run locally. */}
      <footer className="container-page flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle py-6 text-sm text-muted-foreground">
        <p>
          Made with{' '}
          <Link
            href="/"
            className="focus-ring rounded-xs font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-current"
          >
            Inkcast
          </Link>
          , open-source hand-drawn explainer videos.
        </p>
        <Link
          href="/studio"
          className="focus-ring rounded-xs font-medium text-foreground hover:underline"
        >
          Make one from your own question →
        </Link>
      </footer>
    </div>
  );
}
