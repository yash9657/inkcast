'use client';
import { LANGUAGES, voiceLabel } from './options';

import * as React from 'react';
import { ChevronDownIcon, PlayIcon } from 'lucide-react';

import { Badge, Button, ScrollArea } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { Storyboard } from '@inkcast/core';

import {
  describeCamera,
  describeElement,
  describeEnter,
  isMeasured,
  sceneOffsets,
  totalDuration,
} from './board';
import { aspectRatio, clock } from './format';
import { MiniBoard } from './mini-board';

/**
 * The inspector: the storyboard, readable.
 *
 * This is the part that makes the tool legible instead of magic — every scene
 * lists what it says, when the camera moves, and exactly which elements arrive
 * and when. It is also how you find the thing you want to change before typing
 * an edit, which is why "play from here" is on every row.
 */

export type StoryboardInspectorProps = {
  storyboard: Storyboard;
  /** Seek the player to a scene's start. Omitted when there is no video yet. */
  onSeek?: (seconds: number) => void;
  className?: string;
};

export function StoryboardInspector({ storyboard, onSeek, className }: StoryboardInspectorProps) {
  const offsets = sceneOffsets(storyboard);
  const measured = isMeasured(storyboard);
  const meta = storyboard.meta;

  return (
    <section
      aria-labelledby="storyboard-heading"
      className={cn('overflow-hidden rounded-xl border border-border bg-card', className)}
    >
      <div className="flex flex-col gap-1 px-4 pt-4 pb-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="storyboard-heading" className="font-sans text-base font-semibold">
            Storyboard
          </h2>
          <p className="tabular text-xs text-muted-foreground">
            {storyboard.scenes.length} scenes
            {measured ? ` · ${clock(totalDuration(storyboard))}` : ''}
          </p>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {[
            meta.style.charAt(0).toUpperCase() + meta.style.slice(1),
            meta.palette === 'color' ? 'Colour' : 'Black and white',
            voiceLabel(meta.voice),
            LANGUAGES.find((language) => language.value === meta.language)?.label ?? meta.language,
            `${meta.fps} fps`,
          ].join(' · ')}
        </p>
      </div>

      <ScrollArea className="max-h-[36rem] border-t border-border-subtle" fadeEdges>
        <ol className="flex flex-col">
          {storyboard.scenes.map((scene, index) => (
            <SceneRow
              key={scene.id}
              storyboard={storyboard}
              index={index}
              offset={offsets[index] ?? 0}
              measured={measured}
              onSeek={onSeek}
            />
          ))}
        </ol>

        {storyboard.assets.length > 0 ? <AssetLibrary storyboard={storyboard} /> : null}
      </ScrollArea>
    </section>
  );
}

function SceneRow({
  storyboard,
  index,
  offset,
  measured,
  onSeek,
}: {
  storyboard: Storyboard;
  index: number;
  offset: number;
  measured: boolean;
  onSeek?: (seconds: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const scene = storyboard.scenes[index];
  if (!scene) return null;

  const elements = scene.elements ?? [];
  const detailsId = `scene-${scene.id}-elements`;

  return (
    <li className="border-b border-border-subtle last:border-b-0">
      <div className="flex gap-3 px-4 py-3.5">
        {/* `self-start` is load-bearing, not alignment taste. This is a flex
            row, so the default `align-items: stretch` gives the thumbnail the
            height of the whole row — and once BOTH dimensions are determined
            (width from `w-20`, height from the stretch) `aspect-ratio` has
            nothing left to decide and is ignored. Measured before this line
            existed: a 16:9 scene thumbnail rendered 80px wide by ~300px tall,
            a vertical sliver of a wide board, on every scene of every project.
            `self-start` returns the cross-axis size to `auto` so the aspect
            ratio is what sets it. */}
        <div
          className="w-20 shrink-0 self-start overflow-hidden rounded-md border border-border-subtle bg-paper"
          style={{ aspectRatio: aspectRatio(storyboard.meta.aspect) }}
        >
          <MiniBoard storyboard={storyboard} sceneIndex={index} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="tabular text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Scene {index + 1}</span>
            {measured && scene.durationSec ? (
              <>
                {' '}
                · {clock(offset)} · {scene.durationSec.toFixed(1)}s
              </>
            ) : null}
          </p>

          <p className={cn('text-sm leading-relaxed text-foreground', !open && 'line-clamp-3')}>
            {scene.narration}
          </p>

          <div className="-ml-2.5 flex flex-wrap items-center gap-0.5">
            {onSeek && measured ? (
              <Button variant="ghost" size="xs" onClick={() => onSeek(offset)}>
                <PlayIcon aria-hidden />
                Play from here
              </Button>
            ) : null}
            {elements.length || scene.narration.length > 140 ? (
              <Button
                variant="ghost"
                size="xs"
                aria-expanded={open}
                aria-controls={detailsId}
                onClick={() => setOpen((value) => !value)}
              >
                <ChevronDownIcon
                  aria-hidden
                  className={cn(
                    'transition-transform duration-fast ease-out',
                    open && 'rotate-180',
                  )}
                />
                {open ? 'Less' : elements.length ? `Details · ${elements.length}` : 'More'}
              </Button>
            ) : null}
          </div>

          {open && elements.length ? (
            <ul id={detailsId} className="mt-1 flex flex-col gap-1.5">
              {elements.map((element) => {
                const described = describeElement(element);
                return (
                  <li key={element.id} className="flex items-start gap-2">
                    <Badge variant="neutral" className="mt-0.5 shrink-0">
                      {described.kind}
                    </Badge>
                    <span className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
                      <span className="text-foreground">{described.detail}</span>
                      {' — '}
                      {describeEnter(element)}
                      {element.persist === false ? ' · leaves with the scene' : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function AssetLibrary({ storyboard }: { storyboard: Storyboard }) {
  return (
    <details className="border-t border-border p-4">
      <summary className="focus-ring cursor-pointer text-sm font-medium">Reusable artwork</summary>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Artwork used across multiple scenes stays visually consistent.
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {storyboard.assets.map((asset) => (
          <li key={asset.id} className="flex items-center gap-2">
            <Badge variant={asset.svg ? 'success' : 'neutral'} className="shrink-0">
              {asset.svg ? 'drawn' : 'pending'}
            </Badge>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
              {asset.id}
            </span>
            <span className="shrink-0 text-2xs text-muted-foreground">
              {asset.source ?? asset.kind}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
