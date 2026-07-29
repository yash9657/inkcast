'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangleIcon, PlusIcon } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardInteractive,
  InkArrow,
  InkBoard,
  Skeleton,
  StatusDot,
} from '@/components/ui';
import { errorMessage, listProjects, thumbnailUrl, videoUrl, type Project } from '@/lib/api';

import { EXAMPLES } from './options';
import { absoluteTime, clock, relativeTime } from './format';
import { DeleteProjectButton } from './project-actions';

/**
 * The library. Rebuilt from disk on every load, which is the point: a finished
 * video is a directory, not a row in this component's state, so a refresh can
 * never make one disappear.
 */

const POLL_MS = 5000;

export function LibraryView() {
  const [projects, setProjects] = React.useState<Project[] | null>(null);
  const [error, setError] = React.useState<string | undefined>(undefined);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    const next = await listProjects(signal);
    setProjects(next);
    setError(undefined);
    return next;
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(err));
    });
    return () => controller.abort();
  }, [load]);

  // Only poll while something is genuinely in flight.
  const inFlight = (projects ?? []).some((p) => p.status === 'running' || p.status === 'queued');

  React.useEffect(() => {
    if (!inFlight) return;
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [inFlight, load]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl text-foreground">Library</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {projects === null
              ? 'Reading the projects directory…'
              : projects.length === 0
                ? 'Every project lives on disk, so nothing here is temporary.'
                : `${projects.length} project${projects.length === 1 ? '' : 's'} on disk.`}
          </p>
        </div>
        <Button size="sm" render={<Link href="/studio" />}>
          <PlusIcon aria-hidden />
          New explainer
        </Button>
      </header>

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-8">
            <span className="flex size-9 items-center justify-center rounded-full bg-destructive/12 text-destructive">
              <AlertTriangleIcon className="size-4" aria-hidden />
            </span>
            <p className="text-base font-medium text-foreground">The library could not be read</p>
            <p className="max-w-prose text-sm text-muted-foreground">{error}</p>
            <Button
              size="sm"
              onClick={() => void load().catch((e: unknown) => setError(errorMessage(e)))}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : projects === null ? (
        <LibrarySkeleton />
      ) : projects.length === 0 ? (
        <EmptyLibrary />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <ProjectCard
                project={project}
                onDeleted={() =>
                  setProjects((prev) => (prev ?? []).filter((p) => p.id !== project.id))
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------- card */

function ProjectCard({ project, onDeleted }: { project: Project; onDeleted: () => void }) {
  const thumbnail = thumbnailUrl(project);
  const video = videoUrl(project);
  const when = relativeTime(project.updatedAt ?? project.createdAt);

  return (
    <CardInteractive className="gap-0 overflow-hidden py-0">
      <Link
        href={`/project/${project.id}`}
        aria-label={`Open ${project.title}`}
        className="focus-ring relative block aspect-video overflow-hidden border-b border-border bg-paper outline-none"
      >
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-contain"
          />
        ) : video ? (
          // No thumbnail file is written yet, so the video is its own poster:
          // `#t=1` asks the browser for the frame at one second, and
          // `preload="metadata"` keeps it to a header read rather than a download.
          <video
            src={`${video}#t=1`}
            preload="metadata"
            muted
            playsInline
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none size-full object-contain"
          />
        ) : (
          <InkBoard className="flex size-full items-center justify-center p-4">
            <span className="line-clamp-2 text-center font-hand text-md text-ink">
              {project.title}
            </span>
          </InkBoard>
        )}

        {project.durationSec ? (
          <span className="tabular absolute right-2 bottom-2 rounded-full bg-background/90 px-1.5 py-0.5 text-2xs text-foreground">
            {clock(project.durationSec)}
          </span>
        ) : null}
      </Link>

      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/project/${project.id}`}
            className="focus-ring block rounded-xs outline-none"
          >
            <h2 className="truncate text-base font-medium text-foreground">{project.title}</h2>
          </Link>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusLabel status={project.status} />
            {when ? (
              <span title={absoluteTime(project.updatedAt ?? project.createdAt)}>· {when}</span>
            ) : null}
          </p>
        </div>

        <DeleteProjectButton projectId={project.id} title={project.title} onDeleted={onDeleted} />
      </div>
    </CardInteractive>
  );
}

function StatusLabel({ status }: { status: Project['status'] }) {
  if (status === 'ready') return <span>Ready</span>;
  if (status === 'running') {
    return (
      <Badge variant="default">
        <StatusDot tone="primary" pulse />
        Drawing
      </Badge>
    );
  }
  if (status === 'queued') return <Badge variant="neutral">Queued</Badge>;
  if (status === 'failed') return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="neutral">No video</Badge>;
}

/* ------------------------------------------------------------------ states */

function LibrarySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="gap-0 overflow-hidden py-0">
          <Skeleton className="aspect-video w-full rounded-none" />
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-24" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function EmptyLibrary() {
  return (
    <Card className="overflow-hidden border-dashed">
      <CardContent className="relative flex flex-col items-center gap-4 px-6 py-16 text-center">
        <InkBoard aria-hidden className="pointer-events-none absolute inset-0 opacity-70" />

        <div className="relative flex items-end gap-3">
          <span className="font-hand text-xl text-ink-violet">one canvas, not slides</span>
          <InkArrow direction="down-right" tone="violet" className="size-10 translate-y-1" />
        </div>

        <h2 className="relative text-xl text-foreground">Nothing on the board yet</h2>
        <p className="relative max-w-md text-sm leading-relaxed text-muted-foreground">
          Paste a document, drop a pdf, or hand it a link. Inkcast plans one growing canvas, writes
          on it stroke by stroke, narrates it, and hands you an mp4 — on this machine, with no keys.
        </p>

        <div className="relative flex flex-wrap items-center justify-center gap-2">
          <Button render={<Link href="/studio" />}>Open the studio</Button>
        </div>

        <div className="relative mt-2 flex flex-wrap items-center justify-center gap-2">
          <span className="text-2xs uppercase text-muted-foreground">Or start from an example</span>
          {EXAMPLES.slice(0, 3).map((example) => (
            <Button
              key={example.id}
              variant="outline"
              size="xs"
              render={<Link href={`/studio?example=${example.id}`} />}
            >
              {example.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
