'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronDownIcon, PlusIcon, SearchIcon } from 'lucide-react';

import {
  Badge,
  Button,
  Callout,
  chipVariants,
  InkBoard,
  Input,
  Skeleton,
  StatusDot,
} from '@/components/ui';
import { cn } from '@/lib/utils';
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

  const filters = [
    { value: 'all', label: 'All' },
    { value: 'ready', label: 'Ready' },
    { value: 'active', label: 'In progress' },
  ] as const;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display-md">Library</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {projects === null
              ? 'Loading your videos…'
              : projects.length === 0
                ? 'Every video you make will be kept here.'
                : `${projects.length} video${projects.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <Button render={<Link href="/studio" />}>
          <PlusIcon aria-hidden />
          New video
        </Button>
      </header>

      {projects && projects.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-[1_1_16rem]">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Search videos by title"
              placeholder="Search by title"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex flex-[1_1_auto] items-center justify-between gap-3 sm:flex-none">
            <div
              role="group"
              aria-label="Filter by status"
              className="inline-flex h-10 items-center gap-0.5 rounded-pill bg-muted p-1"
            >
              {filters.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  className={cn(
                    'focus-ring h-8 rounded-pill px-3.5 text-sm font-medium whitespace-nowrap transition-colors duration-fast',
                    filter === value
                      ? 'bg-card text-foreground shadow-pop'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="sr-only" htmlFor="library-sort">
              Sort videos
            </label>
            <div className="relative">
              <select
                id="library-sort"
                className="focus-ring h-10 appearance-none rounded-pill border border-border bg-card pr-9 pl-4 text-sm text-foreground hover:border-input"
                value={sort}
                onChange={(event) => setSort(event.target.value as typeof sort)}
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="name">Title A–Z</option>
              </select>
              <ChevronDownIcon
                className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <Callout
          tone="destructive"
          role="alert"
          title="Your library couldn’t be loaded"
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void load().catch((e: unknown) => setError(errorMessage(e)))}
            >
              Try again
            </Button>
          }
        >
          {error}
        </Callout>
      ) : projects === null ? (
        <LibrarySkeleton />
      ) : projects.length === 0 ? (
        <EmptyLibrary />
      ) : visibleProjects.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <h2 className="font-sans text-lg font-semibold">No videos match</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {query.trim()
              ? `Nothing titled “${query.trim()}”${filter === 'all' ? '' : ' with this status'}.`
              : 'Nothing has this status right now.'}
          </p>
          <Button
            variant="secondary"
            className="mt-5"
            onClick={() => {
              setQuery('');
              setFilter('all');
            }}
          >
            Show all videos
          </Button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
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

/**
 * Every card uses the same 16:9 board so the grid reads as rows; a vertical or
 * square film sits centred on paper inside it, the way it would on a whiteboard.
 */
function ProjectCard({ project, onDeleted }: { project: Project; onDeleted: () => void }) {
  const thumbnail = thumbnailUrl(project);
  const video = videoUrl(project);
  const when = relativeTime(project.updatedAt ?? project.createdAt);
  const [thumbFailed, setThumbFailed] = React.useState(false);
  // The canvas accumulates, so a frame near the end shows the whole lesson.
  // Seeking past the end clamps to the last frame in every browser.
  const frameAt = project.durationSec ? Math.max(1, project.durationSec - 1) : 1;

  return (
    <article className="group relative flex flex-col">
      <Link
        href={`/project/${project.id}`}
        className="focus-ring relative block aspect-video overflow-hidden rounded-xl border border-border-subtle bg-paper transition-[border-color,translate,box-shadow] duration-brisk ease-out group-hover:-translate-y-0.5 group-hover:border-input group-hover:shadow-pop"
      >
        <span className="sr-only">Open {project.title}</span>
        {thumbnail && !thumbFailed ? (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setThumbFailed(true)}
            className="size-full object-contain"
          />
        ) : video ? (
          // No still on disk: the video is its own poster. `preload="metadata"`
          // keeps it to a header read rather than a download.
          <video
            src={`${video}#t=${frameAt}`}
            preload="metadata"
            muted
            playsInline
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none size-full object-contain"
          />
        ) : (
          <InkBoard className="flex size-full items-center justify-center p-6">
            <span className="line-clamp-2 text-center font-hand text-lg text-ink">
              {project.title}
            </span>
          </InkBoard>
        )}

        {project.status !== 'ready' ? (
          <span className="absolute top-2.5 left-2.5">
            <StatusLabel status={project.status} />
          </span>
        ) : null}
        {project.durationSec ? (
          <span className="tabular absolute right-2.5 bottom-2.5 rounded-pill bg-ink/80 px-2 py-0.5 text-2xs text-paper">
            {clock(project.durationSec)}
          </span>
        ) : null}
      </Link>

      <div className="mt-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 font-sans text-base leading-snug font-medium text-foreground">
            <Link href={`/project/${project.id}`} className="focus-ring rounded-xs hover:underline">
              {project.title}
            </Link>
          </h2>
          {when ? (
            <p className="tabular mt-1 text-xs text-muted-foreground">
              <span title={absoluteTime(project.updatedAt ?? project.createdAt)}>{when}</span>
            </p>
          ) : null}
        </div>

        {/* Quiet until wanted: revealed on hover or focus where there is a
            pointer to hover with; always visible on touch screens. */}
        <DeleteProjectButton
          projectId={project.id}
          title={project.title}
          onDeleted={onDeleted}
          className="-mt-1 -mr-1.5 transition-opacity duration-fast [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100"
        />
      </div>
    </article>
  );
}

function StatusLabel({ status }: { status: Project['status'] }) {
  if (status === 'running') {
    return (
      <Badge variant="default" className="shadow-card">
        <StatusDot tone="neutral" pulse className="[&_span]:bg-highlighter-foreground" />
        Drawing
      </Badge>
    );
  }
  if (status === 'queued')
    return (
      <Badge variant="neutral" className="bg-card shadow-card">
        Queued
      </Badge>
    );
  if (status === 'failed') {
    return (
      <Badge variant="destructive" className="bg-card shadow-card">
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="neutral" className="bg-card shadow-card">
      No video
    </Badge>
  );
}

/* ------------------------------------------------------------------ states */

function LibrarySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="aspect-video w-full rounded-xl" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

function EmptyLibrary() {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-16 text-center sm:py-20">
      <div
        className="dot-grid mb-8 flex aspect-video w-56 max-w-full items-center justify-center rounded-xl border border-border-subtle bg-paper"
        aria-hidden
      >
        <span className="font-hand text-lg text-ink">
          your first <span className="marker">idea</span> here
        </span>
      </div>
      <h2 className="display-md">Nothing here yet</h2>
      <p className="mt-3 max-w-md text-muted-foreground">
        Ask a question, paste notes or add a link, and your finished video will be saved here.
      </p>
      <Button size="lg" className="mt-7" render={<Link href="/studio" />}>
        <PlusIcon aria-hidden />
        Create your first video
      </Button>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        <span className="text-sm text-muted-foreground">Or start from an example:</span>
        {EXAMPLES.slice(0, 3).map((example) => (
          <Link
            key={example.id}
            href={`/studio?example=${example.id}`}
            className={chipVariants({ size: 'lg' })}
          >
            {example.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
