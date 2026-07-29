import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

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

  return (
    <div className="flex min-h-svh flex-col items-center px-4 py-10 sm:py-16">
      <main id="main" className="flex w-full max-w-3xl flex-col gap-6">
        {src ? (
          <video
            controls
            playsInline
            preload="metadata"
            src={src}
            poster={poster}
            aria-label={project.title}
            className="w-full rounded-xl border border-border bg-black"
            style={{ aspectRatio: aspectRatio(aspect) }}
          />
        ) : (
          <div
            className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-input bg-card p-8 text-center"
            style={{ aspectRatio: aspectRatio(aspect) }}
          >
            <p className="text-base font-medium text-foreground">Still being drawn</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              This explainer has no rendered video yet. The storyboard exists — the frames do not.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl text-foreground">{project.title}</h1>
          <p className="tabular flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {duration ? <span>{clock(duration)}</span> : null}
            {storyboard ? (
              <span>
                {duration ? '· ' : ''}
                {storyboard.scenes.length} scenes on one canvas
              </span>
            ) : null}
            {storyboard ? <span>· {storyboard.meta.style}</span> : null}
          </p>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
          <p className="text-sm text-muted-foreground">
            Drawn with{' '}
            <Link href="/" className="focus-ring rounded-xs font-medium text-primary outline-none">
              Inkcast
            </Link>{' '}
            — open source, runs locally, no per-minute bill.
          </p>
          <Link
            href="/studio"
            className="focus-ring rounded-md border border-input bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-xs outline-none transition-colors duration-fast ease-out hover:bg-accent hover:text-accent-foreground"
          >
            Draw your own
          </Link>
        </footer>
      </main>
    </div>
  );
}
