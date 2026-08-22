'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

import { BoardSketch } from './board-sketch';
import { showcasePosterSrc, showcasePreviewSrc, type ShowcaseAspect } from './site-config';

/**
 * The film in a format card, with a fallback chain that cannot end in a broken
 * image.
 *
 * ## Why a chain at all
 *
 * `preview.gif` is produced by the export bundle (`PLAN-LAUNCH.md` B1) and does
 * not exist yet for any project. `thumbnail.png` does exist today. Both are
 * served out of a project directory by `/api/media/:id/:path`, which 404s a file
 * that has not been rendered — so the markup has to survive its own primary
 * asset being absent, on the deployment as well as in development:
 *
 *   preview.gif -> thumbnail.png -> a drawn board sketch
 *
 * The last step is unconditional and needs no network, which is the property
 * that makes "the page never shows a broken image" a guarantee rather than a
 * hope. `docs/HANDOFF.md` names silent degradation as this repo's dominant
 * failure mode; the loud version of that is a torn-page icon in the middle of a
 * landing page, and this is the fix for it.
 *
 * ## Why this is the only client component on the format row
 *
 * `onError` is the browser's only honest signal that an image did not load —
 * there is no server-side way to know, short of fetching every asset during
 * render and coupling the page's TTFB to three files on disk. So the chain lives
 * in one small client island and the rest of the row stays static HTML.
 *
 * Both fixed dimensions are set in CSS *and* on the element, and the two agree.
 * A card whose image arrives late must not move the two cards beside it.
 */

type Stage = 'preview' | 'poster' | 'sketch';

export function FormatPreview({
  id,
  aspect,
  label,
  seed,
  width,
  height,
  className,
}: {
  /** Project id of the showcase film. */
  id: string;
  aspect: ShowcaseAspect;
  /** The human name of the format, for the alt text. */
  label: string;
  seed: number;
  width: number;
  height: number;
  className?: string;
}) {
  const [stage, setStage] = React.useState<Stage>('preview');

  if (stage === 'sketch') {
    return <BoardSketch aspect={aspect} seed={seed} className={className} />;
  }

  return (
    // A plain `<img>`, not `next/image`. An animated gif is passed through the
    // optimiser untouched, so the wrapper would buy nothing here — and it would
    // cost the `onError` chain above, which is the entire point of this file.
    <img
      src={stage === 'preview' ? showcasePreviewSrc(id) : showcasePosterSrc(id)}
      // The alt describes what the moving picture shows, not the file: a still
      // frame and a four-second loop of the same film are the same content to
      // somebody who cannot see either.
      alt={`The opening seconds of an Inkcast film in the ${label} frame, drawing itself on a whiteboard`}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      onError={() => setStage((current) => (current === 'preview' ? 'poster' : 'sketch'))}
      className={cn('block bg-paper object-cover', className)}
    />
  );
}
