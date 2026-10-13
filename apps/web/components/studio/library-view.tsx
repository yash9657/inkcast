'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangleIcon, PlusIcon, SearchIcon, FilmIcon } from 'lucide-react';

import {
  Input,
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
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<'all' | 'ready' | 'active'>('all');
  const [sort, setSort] = React.useState<'newest' | 'oldest' | 'name'>('newest');
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

  const visibleProjects = (projects ?? [])
    .filter(
      (project) =>
        project.title.toLowerCase().includes(query.toLowerCase().trim()) &&
        (filter === 'all' ||
          (filter === 'ready'
            ? project.status === 'ready'
            : ['queued', 'running'].includes(project.status))),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.title.localeCompare(b.title)
        : (sort === 'newest' ? -1 : 1) *
          String(a.updatedAt ?? a.createdAt ?? '').localeCompare(
            String(b.updatedAt ?? b.createdAt ?? ''),
          ),
    );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="page-heading">
          <h1>Your library</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {projects === null
              ? 'Loading your videos…'
              : projects.length === 0
                ? 'A home for every idea you bring to life.'
                : `${projects.length} video${projects.length === 1 ? '' : 's'} in your workspace.`}
          </p>
        </div>
        <Button size="sm" render={<Link href="/studio" />}>
          <PlusIcon aria-hidden />
          Create a video
        </Button>
      </header>

      {projects && projects.length > 0 ? (
        <div className="library-toolbar">
          <div className="relative min-w-0 flex-1">
            <SearchIcon
              className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label="Search videos"
              placeholder="Find a video…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-10"
            />
          </div>
          <div
            role="group"
            aria-label="Filter videos"
            className="flex gap-1 rounded-md bg-muted p-1"
          >
            {(['all', 'ready', 'active'] as const).map((value) => (
              <Button
                key={value}
                variant={filter === value ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? 'All videos' : value === 'ready' ? 'Ready' : 'In progress'}
              </Button>
            ))}
          </div>
          <label className="sr-only" htmlFor="library-sort">
            Sort videos
          </label>
          <select
            id="library-sort"
            className="focus-ring h-11 rounded-md border border-input bg-card px-3 text-sm"
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Title A–Z</option>
          </select>
        </div>
      ) : null}
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
      ) : visibleProjects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <h2 className="text-xl">No videos found</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Try another title or show all videos.
          </p>
          <Button
            variant="outline"
            className="mt-5"
            onClick={() => {
              setQuery('');
              setFilter('all');
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((project) => (
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

      <div className="flex items-start gap-2 p-4">
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
    <div className="library-empty">
      <div
        className="mb-6 flex h-24 w-32 items-center justify-center rounded-xl bg-brand-canvas text-brand-canvas-ink"
        aria-hidden
      >
        <FilmIcon className="size-10" strokeWidth={1.25} />
      </div>
      <h2 className="text-2xl">Your first video starts with an idea.</h2>
      <p className="mt-3 max-w-md text-md leading-relaxed text-muted-foreground">
        Bring a topic, a document or a link. We’ll help turn it into an explanation worth sharing.
      </p>
      <Button className="mt-6" render={<Link href="/studio" />}>
        <PlusIcon aria-hidden />
        Create a video
      </Button>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
        <span className="w-full text-sm text-muted-foreground">Or explore an example</span>
        {EXAMPLES.slice(0, 3).map((example) => (
          <Button
            key={example.id}
            variant="ghost"
            size="sm"
            render={<Link href={`/studio?example=${example.id}`} />}
          >
            {example.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
