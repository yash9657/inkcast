'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangleIcon, CheckIcon, ClockIcon, RotateCcwIcon } from 'lucide-react';

import {
  Badge,
  Button,
  Callout,
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
  type QueueState,
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
 *
 * ## The queue is a state of this screen, not an error page
 *
 * On a shared box a run can be *in line* before it is running (D1: two renders
 * at a time, FIFO, positions and estimates measured — see `lib/jobs.ts`). That
 * needs saying out loud, with the number, because the alternative is a progress
 * bar sitting at zero for six minutes, which is indistinguishable from a broken
 * deployment and is the single most likely reason somebody closes the tab and
 * never comes back.
 *
 * So the honest wait math is the design here rather than an apology bolted onto
 * it: the place in line is the largest thing on the panel, the sentence beside
 * it is the server's own measured estimate, and the stage list stays visible
 * underneath with every stage still pending — because that is the truth, and a
 * spinner over the top of it would only be hiding it.
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
  const queued = state.status === 'queued' && state.queue !== undefined;

  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {failed ? (
            <Badge variant="destructive">
              <AlertTriangleIcon aria-hidden />
              Stopped
            </Badge>
          ) : queued ? (
            <Badge variant="warning">
              <ClockIcon aria-hidden />
              In line
            </Badge>
          ) : (
            <Badge variant="default">
              <StatusDot tone="neutral" pulse className="[&>span]:bg-highlighter-foreground" />
              Drawing
            </Badge>
          )}
          <p className="tabular text-xs text-muted-foreground">
            {/* The clock restarts when the run is admitted, so this label has to
                say which of the two things it is counting. */}
            {elapsed(state.elapsedMs)} {queued ? 'waiting' : 'elapsed'}
          </p>
        </div>

        <h1 className="display-md max-w-3xl">{title}</h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
          {failed
            ? 'This video stopped part-way. Finished steps are saved, so retrying picks up where it left off.'
            : queued
              ? 'Your video is waiting for a free renderer. You can close this tab; it keeps its place and will be in your library when it’s done.'
              : 'Usually a few minutes. You can close this tab; the video keeps drawing and will be in your library when it’s done.'}
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
  const queue = state.status === 'queued' ? state.queue : undefined;

  return (
    <Card className={cn('gap-5 rounded-2xl py-5 shadow-card', className)}>
      <CardContent className="flex flex-col gap-5 px-5">
        {queue ? (
          <QueueCard queue={queue} waitedMs={state.elapsedMs} />
        ) : (
          <Progress
            value={state.status === 'done' ? 100 : state.pct}
            label={state.status === 'error' ? 'Stopped' : (current?.title ?? 'Starting')}
            note={state.note}
          />
        )}

        <ol className="flex flex-col gap-0.5">
          {GENERATION_STAGES.map((stage) => (
            <StageRow key={stage} stage={stage} progress={state.stages[stage]} />
          ))}
        </ol>

        {state.status === 'error' ? (
          <Callout role="alert" tone="destructive" title="Something went wrong">
            <p>{state.error ?? 'The run failed.'}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={onRetry} disabled={retrying}>
                <RotateCcwIcon aria-hidden />
                {retrying ? 'Retrying…' : 'Retry from here'}
              </Button>
              <Button size="sm" variant="ghost" render={<Link href="/studio" />}>
                Start something else
              </Button>
            </div>
          </Callout>
        ) : queue ? null : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Drawing the frames takes longest. The percentage comes straight from the renderer.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Where you are in line, and how long that means.
 *
 * The position is set in the largest type on the panel because it is the one
 * fact that answers the user's actual question ("is this going to happen?"), and
 * the sentence beneath it is the server's own copy, rendered verbatim — the
 * estimate is derived from measured render durations on *this* box, so the
 * browser is not entitled to round it, restate it, or replace it with a
 * reassurance when there is no measurement yet. Where the server says it cannot
 * put a number on the wait, this component says exactly that.
 */
function QueueCard({ queue, waitedMs }: { queue: QueueState; waitedMs: number }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tabular font-display text-4xl leading-none text-foreground">
          #{queue.position}
        </span>
        <span className="text-sm text-muted-foreground">in line</span>
        <span className="tabular ml-auto text-xs text-muted-foreground">
          waiting {elapsed(waitedMs)}
        </span>
      </div>

      <p className="text-md leading-relaxed text-foreground">{queue.message}</p>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {queue.running === 1
          ? 'One film is being drawn right now. '
          : queue.running > 1
            ? `${queue.running} films are being drawn right now. `
            : ''}
        Two videos are drawn at a time so each one finishes sooner. The estimate comes from how long
        recent videos took here.
      </p>
    </div>
  );
}

function StageRow({ stage, progress }: { stage: GenerationStage; progress: StageProgress }) {
  const copy = STAGE_COPY[stage];
  const { state } = progress;

  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-md px-2 py-2',
        state === 'active' && 'bg-accent-soft',
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
    <Card className={cn('gap-4 overflow-hidden rounded-2xl py-5 shadow-card', className)}>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
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
            Scenes appear here as soon as they’re planned.
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
                      ? 'border-foreground ring-2 ring-highlighter'
                      : 'border-border opacity-70 hover:opacity-100',
                  )}
                  style={{ aspectRatio: ratio }}
                >
                  <MiniBoard storyboard={storyboard} sceneIndex={index} />
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-1.5">
              <p className="tabular text-xs font-medium text-muted-foreground">
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
              {state.status === 'queued'
                ? 'Waiting for a renderer. Nothing has been planned yet.'
                : state.stages.plan.state === 'active'
                  ? 'Planning the scenes…'
                  : 'Reading your source…'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
