'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangleIcon } from 'lucide-react';

import { Button, Card, CardContent, Skeleton, SkeletonText, toast } from '@/components/ui';
import {
  errorMessage,
  getProject,
  rerenderProject,
  type Project,
  type ProjectDetail,
} from '@/lib/api';
import { useGeneration } from '@/lib/use-generation';
import type { Storyboard } from '@inkcast/core';

import { GenerationView } from './generation-view';
import { ResultView } from './result-view';

/**
 * The project screen. One route, three states: loading, generating, finished.
 *
 * A run is not held in this component — it is a directory on disk and a stream
 * you can re-attach to. Landing here with `?generating=1`, or on a project the
 * server still reports as running, opens the stream; a refresh mid-render
 * re-attaches instead of losing the work (the competitor's worst reported bug).
 */

export type ProjectViewProps = {
  id: string;
  /** Set by the create flow's redirect, so the stream opens immediately. */
  initialGenerating: boolean;
  canEdit?: boolean;
};

export function ProjectView({ id, initialGenerating, canEdit = true }: ProjectViewProps) {
  const router = useRouter();

  const [detail, setDetail] = React.useState<ProjectDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | undefined>(undefined);
  const [generating, setGenerating] = React.useState(initialGenerating);
  const [rerendering, setRerendering] = React.useState(false);
  /** The storyboard has been edited since the video on disk was encoded. */
  const [dirty, setDirty] = React.useState(false);

  const refresh = React.useCallback(
    async (signal?: AbortSignal) => {
      const next = await getProject(id, signal);
      setDetail(next);
      return next;
    },
    [id],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const next = await refresh(controller.signal);
        const running = next.project.status === 'running' || next.project.status === 'queued';
        // A reload after the render finished must not re-open a dead stream.
        const finished = next.project.status === 'ready';
        setGenerating((initialGenerating && !finished) || running);
      } catch (err) {
        if (controller.signal.aborted) return;
        setLoadError(errorMessage(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
    // `initialGenerating` is a first-paint hint only; re-running on its change
    // would fight the stream's own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const generation = useGeneration(id, {
    enabled: generating,
    onStageChange: () => {
      // Each stage writes the storyboard back to disk, so this is exactly when
      // there is something new to show.
      void refresh().catch(() => undefined);
    },
    onDone: () => {
      setDirty(false);
      setGenerating(false);
      void refresh().catch(() => undefined);
      toast.success('Video ready', { description: 'Ready to watch, download and share.' });
    },
  });

  const onRerender = React.useCallback(async () => {
    setRerendering(true);
    try {
      await rerenderProject(id);
      setDirty(false);
      setGenerating(true);
      generation.retry();
    } catch (err) {
      toast.error('Could not start the render', { description: errorMessage(err) });
    } finally {
      setRerendering(false);
    }
  }, [generation, id]);

  const onEdited = React.useCallback((storyboard: Storyboard) => {
    // Optimistic: the endpoint returned the patched storyboard, so show it now
    // and mark the video stale rather than refetching the whole project.
    setDetail((prev) =>
      prev ? { project: { ...prev.project, title: storyboard.title }, storyboard } : prev,
    );
    setDirty(true);
  }, []);

  if (loading && !detail) return <ProjectSkeleton />;

  if (loadError && !detail) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 py-10">
          <span className="flex size-9 items-center justify-center rounded-full bg-destructive/12 text-destructive">
            <AlertTriangleIcon className="size-4" aria-hidden />
          </span>
          <h1 className="text-xl text-foreground">This project could not be opened</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{loadError}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" render={<Link href="/library" />}>
              Back to the library
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setLoadError(undefined);
                setLoading(true);
                refresh()
                  .catch((err: unknown) => setLoadError(errorMessage(err)))
                  .finally(() => setLoading(false));
              }}
            >
              Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const project: Project = detail?.project ?? { id, title: id, status: 'draft' };
  const storyboard = detail?.storyboard;

  if (generating) {
    return (
      <GenerationView
        title={storyboard?.title ?? project.title}
        state={generation}
        storyboard={storyboard}
        onRetry={() => (canEdit ? void onRerender() : router.push('/studio'))}
        retrying={rerendering}
      />
    );
  }

  return (
    <ResultView
      canEdit={canEdit}
      project={project}
      storyboard={storyboard}
      dirty={dirty}
      rerendering={rerendering}
      onRerender={() => void onRerender()}
      onEdited={onEdited}
      onDeleted={() => router.push('/library')}
    />
  );
}

/** Sized to the result screen, so nothing jumps when the data lands. */
function ProjectSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-3.5 w-40" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <div className="flex flex-col gap-6">
          <Skeleton className="aspect-video w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
        <Card className="py-4">
          <CardContent className="flex flex-col gap-4 px-4">
            <Skeleton className="h-4 w-32" />
            <SkeletonText lines={3} />
            <SkeletonText lines={3} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
