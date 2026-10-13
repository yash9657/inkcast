'use client';
import { LANGUAGES, voiceLabel } from './options';

import * as React from 'react';
import { ChevronDownIcon, PlayIcon } from 'lucide-react';

import { Badge, Button, Card, CardContent, ScrollArea } from '@/components/ui';
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
    <Card className={cn('gap-4 py-4', className)}>
      <CardContent className="flex flex-col gap-3 px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">Storyboard</h2>
          <p className="tabular text-xs text-muted-foreground">
            {storyboard.scenes.length} scenes
            {measured ? ` · ${clock(totalDuration(storyboard))}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{meta.aspect}</Badge>
          <Badge variant="outline">
            {meta.style.charAt(0).toUpperCase() + meta.style.slice(1)}
          </Badge>
          <Badge variant="outline">{meta.palette === 'color' ? 'Colour' : 'Monochrome'}</Badge>
          <Badge variant="outline">{voiceLabel(meta.voice)}</Badge>
          <Badge variant="outline">
            {LANGUAGES.find((language) => language.value === meta.language)?.label ?? meta.language}
          </Badge>
          <Badge variant="outline">{meta.fps} fps</Badge>
        </div>
      </CardContent>

      <ScrollArea className="max-h-144 border-t border-border" fadeEdges>
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
    </Card>
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
    <li className="border-b border-border last:border-b-0">
      <div className="flex gap-3 p-4">
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
          className="w-20 shrink-0 self-start overflow-hidden rounded-sm border border-border bg-paper"
          style={{ aspectRatio: aspectRatio(storyboard.meta.aspect) }}
        >
          <MiniBoard storyboard={storyboard} sceneIndex={index} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <span className="tabular text-2xs uppercase text-muted-foreground">
              Scene {index + 1}
            </span>
            {measured && scene.durationSec ? (
              <span className="tabular text-2xs text-muted-foreground">
                {clock(offset)} · {scene.durationSec.toFixed(1)}s
              </span>
            ) : null}
          </div>

          <p className="text-md leading-relaxed text-foreground">{scene.narration}</p>

          <p className="text-xs text-muted-foreground">
            {elements.length
              ? `${elements.length} visual element${elements.length === 1 ? '' : 's'}`
              : 'No new visual elements'}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-1">
            {onSeek && measured ? (
              <Button variant="ghost" size="xs" onClick={() => onSeek(offset)}>
                <PlayIcon aria-hidden />
                Play from here
              </Button>
            ) : null}
            {elements.length ? (
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
                {open ? 'Hide elements' : 'Elements'}
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
