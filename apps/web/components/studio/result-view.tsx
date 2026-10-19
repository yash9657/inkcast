'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  DownloadIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FilmIcon,
  RotateCcwIcon,
  Trash2Icon,
} from 'lucide-react';

import {
  Button,
  Callout,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui';
import { downloadName, thumbnailUrl, videoUrl, type Project } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Storyboard } from '@inkcast/core';

import { isMeasured, totalDuration } from './board';
import { EditBox } from './edit-box';
import { clock, relativeTime } from './format';
import { CopyLinkButton, DeleteProjectDialog } from './project-actions';
import { StoryboardInspector } from './storyboard-inspector';
import { VideoPlayer, type VideoPlayerHandle } from './video-player';

/**
 * The finished project: watch it, take it, change it.
 *
 * The storyboard sits next to the video rather than behind a tab, because the
 * two are the same artefact at different stages and an edit is aimed at a scene
 * you can see. Nothing here is gated: download, share, re-render and edit all
 * work on every project.
 */

export type ResultViewProps = {
  project: Project;
  canEdit?: boolean;
  storyboard?: Storyboard;
  /** The storyboard has changed since this video was encoded. */
  dirty: boolean;
  rerendering: boolean;
  onRerender: () => void;
  onEdited: (storyboard: Storyboard) => void;
  onDeleted: () => void;
};

/** Vertical and square videos must not become the tallest thing on the page. */
const PLAYER_WIDTH: Record<string, string> = {
  '16:9': 'max-w-full',
  '1:1': 'max-w-md',
  '9:16': 'max-w-xs',
};

/**
 * What this film's facts rest on — plan item 5.1, the honest half of audit S0-a.
 *
 * There is no retrieval lane: a bare topic is taught from what the model knows, and the
 * finished mp4 looks exactly like one built from a document the user supplied. Nothing in
 * the studio said which you were watching, and that silence is the finding. It reads as a
 * note rather than a warning because teaching a bare topic is the intended, normal use —
 * what is worth knowing is only that no source was ever there to check the claims
 * against.
 *
 * Nothing is rendered when the field is absent: a film cast before the pipeline recorded
 * this has no answer, and inventing one would defeat the purpose of the field.
 */
function groundingText(grounding?: Project['grounding']): string | undefined {
  if (!grounding) return undefined;
  if (grounding === 'document') return 'Taught from the source you supplied.';
  if (grounding === 'supplied') {
    return 'Rendered from a ready-made lesson; this studio sourced nothing itself.';
  }
  return 'Made from the model’s own knowledge, with no source to check against. Review the facts before you share it.';
}

/**
 * A lane's name as a reader would say it. An unknown name falls through verbatim, so a
 * lane a newer pipeline records still reads as a sentence rather than as nothing.
 */
const LANE_LABELS: Record<string, string> = {
  chemistry: 'chemical structures',
  circuits: 'circuit diagrams',
  geography: 'accurate maps',
};

/**
 * What this film asked to be drawn and could not be — plan item 6.1, audit S5-a.
 *
 * Three topic classes have no renderer here (chemical structures, circuit schematics,
 * accurate maps). Highlighted code was the fourth until plan item 6.2 built that lane, and
 * its label came out of the table with it — a studio that goes on apologising for a lane
 * that exists is worse than one that never had it. The fallback for the remaining three is
 * a picture that looks finished and is wrong: an image generator's idea of a molecule. The
 * film still plays,
 * and the person watching is the only one who can tell whether that picture matters — so
 * they have to be told it is there.
 *
 * Phrased around what is missing from *inkcast* rather than what is wrong with the film,
 * because that is where the defect is, and because it is the honest answer to "can I fix
 * this?": not by re-rendering. Beside `GroundingNote` and in the same register, one shade
 * louder — an unsourced claim is the normal case, and a picture that is confidently wrong
 * is not.
 */
function laneText(lanes?: string[]): string | undefined {
  if (!lanes || lanes.length === 0) return undefined;
  const named = lanes.map((l) => LANE_LABELS[l] ?? l);
  const list =
    named.length === 1
      ? named[0]
      : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  return `It asks for ${list}, which Inkcast can’t draw accurately yet, so those pictures are approximations.`;
}

/**
 * Both caveats in one place, in one register. A parametric film or a missing lane is a
 * reason to check before sharing; a film taught from the user's own document is only a
 * fact about it and stays in the meta line.
 */
function Caveats({ project }: { project: Project }) {
  const lane = laneText(project.unservedLanes);
  const parametric = project.grounding === 'parametric';
  if (!lane && !parametric) return null;
  return (
    <Callout tone="warning" title="Check before you share">
      {parametric ? <p>{groundingText(project.grounding)}</p> : null}
      {lane ? <p className={parametric ? 'mt-1' : undefined}>{lane}</p> : null}
    </Callout>
  );
}

export function ResultView({
  project,
  canEdit = true,
  storyboard,
  dirty,
  rerendering,
  onRerender,
  onEdited,
  onDeleted,
}: ResultViewProps) {
  const playerRef = React.useRef<VideoPlayerHandle>(null);
  const src = videoUrl(project);
  const poster = thumbnailUrl(project);
  const aspect = storyboard?.meta.aspect ?? '16:9';
  const measured = storyboard ? isMeasured(storyboard) : false;
  const duration =
    project.durationSec ?? (storyboard && measured ? totalDuration(storyboard) : undefined);
  const created = relativeTime(project.updatedAt ?? project.createdAt);

  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const quietGrounding = project.grounding && project.grounding !== 'parametric';

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-5">
        <Link
          href="/library"
          className="focus-ring inline-flex items-center gap-1.5 self-start rounded-sm text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          Library
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0 flex-[1_1_24rem]">
            <h1 className="display-md">{project.title}</h1>
            <p className="tabular mt-2.5 text-sm text-muted-foreground">
              {[
                duration ? clock(duration) : null,
                storyboard ? `${storyboard.scenes.length} scenes` : null,
                aspect,
                created ?? null,
                quietGrounding ? groundingText(project.grounding) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {src ? (
              <Button render={<a href={src} download={downloadName(project.title, project.id)} />}>
                <DownloadIcon aria-hidden />
                Download
              </Button>
            ) : null}

            <CopyLinkButton projectId={project.id} label="Copy share link" />

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="secondary"
                    size="icon"
                    className="size-10"
                    aria-label="More actions"
                  />
                }
              >
                <EllipsisIcon aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                {canEdit ? (
                  <DropdownMenuItem onClick={onRerender} disabled={rerendering}>
                    <RotateCcwIcon aria-hidden />
                    {rerendering ? 'Starting…' : 'Render again'}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  onClick={() => window.open(`/share/${project.id}`, '_blank', 'noopener')}
                >
                  <ExternalLinkIcon aria-hidden />
                  Open share page
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2Icon aria-hidden />
                  Delete video…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DeleteProjectDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              projectId={project.id}
              title={project.title}
              onDeleted={onDeleted}
            />
          </div>
        </div>

        <Caveats project={project} />

        {dirty ? (
          <Callout
            tone="info"
            title="Your edits aren’t in the video yet"
            action={
              <Button size="sm" onClick={onRerender} disabled={rerendering}>
                <RotateCcwIcon aria-hidden />
                {rerendering ? 'Starting…' : 'Render now'}
              </Button>
            }
          >
            The storyboard has changed. The video below is the previous render.
          </Callout>
        ) : null}
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {src ? (
            <VideoPlayer
              ref={playerRef}
              src={src}
              title={project.title}
              poster={poster}
              aspect={aspect}
              fallbackDuration={duration}
              className={cn('mx-auto w-full', PLAYER_WIDTH[aspect] ?? 'max-w-full')}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <FilmIcon className="size-4" aria-hidden />
              </span>
              <p className="text-base font-medium text-foreground">There’s no video yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {project.error
                  ? project.error
                  : canEdit
                    ? 'This project has a storyboard but no finished video.'
                    : 'This project has no finished video. Create another from your source.'}
              </p>
              {canEdit ? (
                <Button size="sm" onClick={onRerender} disabled={rerendering}>
                  <RotateCcwIcon aria-hidden />
                  {rerendering ? 'Starting…' : 'Render it'}
                </Button>
              ) : (
                <Button size="sm" render={<Link href="/studio" />}>
                  Create another video
                </Button>
              )}
            </div>
          )}

          {storyboard && canEdit ? (
            <EditBox
              projectId={project.id}
              storyboard={storyboard}
              onEdited={onEdited}
              disabled={rerendering}
            />
          ) : null}
        </div>

        {storyboard ? (
          <StoryboardInspector
            storyboard={storyboard}
            onSeek={src ? (seconds) => playerRef.current?.seek(seconds, true) : undefined}
          />
        ) : (
          <Callout tone="info" title="No storyboard">
            This project has no readable storyboard, so there is nothing to inspect or edit.
          </Callout>
        )}
      </div>
    </div>
  );
}
