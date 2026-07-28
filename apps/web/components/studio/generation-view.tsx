'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangleIcon, CheckIcon, RotateCcwIcon } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Progress,
  Skeleton,
  SkeletonText,
  StatusDot,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import {
  GENERATION_STAGES,
  STAGE_COPY,
  type GenerationStage,
  type GenerationState,
  type StageProgress,
} from '@/lib/use-generation';
import type { Storyboard } from '@inkcast/core';

import { aspectRatio, clock, elapsed } from './format';
import { MiniBoard } from './mini-board';
import { resolvedAssetCount } from './board';

/**
 * The waiting screen, treated as a screen rather than as a spinner.
 *
 * Three things are true here and nowhere else in the app: the work takes
 * minutes, the user cannot do anything to speed it up, and they are entitled to
 * know exactly what is happening. So: every stage is named and carries its own
 * state, the overall bar is whatever the server last reported (indeterminate
 * until it reports at all — never a fake number), and the storyboard is drawn as
 * it arrives, so the wait teaches you what the tool is doing.
 */

export type GenerationViewProps = {
  title: string;
  state: GenerationState;
  storyboard?: Storyboard;
  /** Re-run from the failed stage. */
  onRetry: () => void;
  retrying?: boolean;
};

export function GenerationView({
  title,
  state,
  storyboard,
  onRetry,
  retrying = false,
}: GenerationViewProps) {
  const failed = state.status === 'error';

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {failed ? (
            <Badge variant="destructive">
              <AlertTriangleIcon aria-hidden />
              Stopped
            </Badge>
          ) : (
            <Badge variant="default">
              <StatusDot tone="primary" pulse />
              Drawing
            </Badge>
          )}
          <p className="tabular text-xs text-muted-foreground">
            {elapsed(state.elapsedMs)} elapsed
          </p>
        </div>

        <h1 className="text-2xl text-foreground">{title}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {failed
            ? 'The run stopped part-way. Everything finished before the failing stage is cached, so retrying picks up from there rather than starting over.'
            : 'This page is live. The project is a directory on disk, so you can close the tab and come back to it — nothing is held in this browser.'}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,1fr)] lg:items-start">
        <StagePanel
          className="order-1 lg:order-2"
          state={state}
          onRetry={onRetry}
          retrying={retrying}
        />
        <BoardSoFar className="order-2 lg:order-1" storyboard={storyboard} state={state} />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- the stages */

function StagePanel({
  state,
  onRetry,
  retrying,
  className,
}: {
  state: GenerationState;
  onRetry: () => void;
  retrying: boolean;
  className?: string;
}) {
  const current = state.stage ? STAGE_COPY[state.stage] : undefined;

  return (
    <Card className={cn('gap-5', className)}>
      <CardContent className="flex flex-col gap-5">
        <Progress
          value={state.status === 'done' ? 100 : state.pct}
          label={state.status === 'error' ? 'Stopped' : (current?.title ?? 'Starting')}
          note={state.note}
        />

        <ol className="flex flex-col gap-0.5">
          {GENERATION_STAGES.map((stage) => (
            <StageRow key={stage} stage={stage} progress={state.stages[stage]} />
          ))}
        </ol>

        {state.status === 'error' ? (
          <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/8 p-3">
            <p className="text-sm leading-relaxed text-foreground">
              {state.error ?? 'The run failed.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={onRetry} disabled={retrying}>
                <RotateCcwIcon aria-hidden />
                {retrying ? 'Retrying…' : 'Retry from here'}
              </Button>
              <Button size="sm" variant="ghost" render={<Link href="/studio" />}>
                Start something else
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Rendering draws every frame, so it takes the longest by far. The percentage comes from
            the pipeline itself — if it is still, the work is still.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StageRow({ stage, progress }: { stage: GenerationStage; progress: StageProgress }) {
  const copy = STAGE_COPY[stage];
  const { state } = progress;

  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-sm px-1 py-2',
        state === 'active' && 'bg-accent/50',
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
        {state === 'done' ? (
          <CheckIcon className="size-4 text-success" />
        ) : state === 'failed' ? (
          <AlertTriangleIcon className="size-4 text-destructive" />
        ) : state === 'active' ? (
          <StatusDot tone="primary" pulse />
        ) : (
          <span className="size-2 rounded-full border border-input" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block text-sm font-medium',
            state === 'pending' ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {copy.title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {progress.note ?? copy.idle}
        </span>
      </span>

      <span className="tabular shrink-0 pt-0.5 text-2xs text-muted-foreground">
        {state === 'done'
          ? 'done'
          : state === 'failed'
            ? 'failed'
            : state === 'active' && progress.pct !== null
              ? `${progress.pct}%`
              : ''}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------ the board rail */

function BoardSoFar({
  storyboard,
  state,
  className,
}: {
  storyboard?: Storyboard;
  state: GenerationState;
  className?: string;
}) {
  const sceneCount = storyboard?.scenes.length ?? 0;
  const [pinned, setPinned] = React.useState<number | null>(null);

  // Follow the newest scene as the plan grows, unless the user picked one.
  const active = pinned !== null && pinned < sceneCount ? pinned : Math.max(sceneCount - 1, 0);
  const scene = storyboard?.scenes[active];
  const ratio = aspectRatio(storyboard?.meta?.aspect ?? '16:9');

  return (
    <Card className={cn('gap-4 overflow-hidden', className)}>
      <CardHeader>
        <CardTitle className="text-base font-medium">
          {storyboard ? 'The board so far' : 'The board'}
        </CardTitle>
        {storyboard ? (
          <p className="tabular text-xs text-muted-foreground">
            {sceneCount} scene{sceneCount === 1 ? '' : 's'}
            {resolvedAssetCount(storyboard) > 0
              ? ` · ${resolvedAssetCount(storyboard)}/${storyboard.assets.length} drawings resolved`
              : storyboard.assets.length > 0
                ? ` · ${storyboard.assets.length} entities to draw`
                : ''}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Scenes appear here the moment the planner writes them.
          </p>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div
          className="overflow-hidden rounded-lg border border-border bg-paper"
          style={{ aspectRatio: ratio }}
        >
          {storyboard && scene ? (
            <MiniBoard storyboard={storyboard} sceneIndex={active} />
          ) : (
            <Skeleton className="size-full rounded-none" />
          )}
        </div>

        {storyboard && scene ? (
          <>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {storyboard.scenes.map((_scene, index) => (
                <button
                  key={storyboard.scenes[index]?.id ?? index}
                  type="button"
                  onClick={() => setPinned(index)}
                  aria-current={index === active}
                  aria-label={`Scene ${index + 1}`}
                  className={cn(
                    'focus-ring relative w-16 shrink-0 overflow-hidden rounded-sm border outline-none',
                    'transition-[border-color,opacity] duration-fast ease-out',
                    index === active
                      ? 'border-primary'
                      : 'border-border opacity-70 hover:opacity-100',
                  )}
                  style={{ aspectRatio: ratio }}
                >
                  <MiniBoard storyboard={storyboard} sceneIndex={index} />
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-1.5">
              <p className="text-2xs uppercase text-muted-foreground">
                Scene {active + 1}
                {scene.durationSec ? ` · ${clock(scene.durationSec)}` : ''}
              </p>
              <p className="text-md leading-relaxed text-foreground">{scene.narration}</p>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-9 w-16 shrink-0" />
              ))}
            </div>
            <SkeletonText lines={2} />
            <p className="text-xs text-muted-foreground">
              {state.stages.plan.state === 'active'
                ? 'Planning the canvas…'
                : 'Reading the source first.'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
