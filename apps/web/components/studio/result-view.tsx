'use client';

import * as React from 'react';
import Link from 'next/link';
import { DownloadIcon, ExternalLinkIcon, FilmIcon, RotateCcwIcon } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui';
import { downloadName, thumbnailUrl, videoUrl, type Project } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Storyboard } from '@inkcast/core';

import { isMeasured, totalDuration } from './board';
import { EditBox } from './edit-box';
import { absoluteTime, clock, relativeTime } from './format';
import { CopyLinkButton, DeleteProjectButton } from './project-actions';
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
function GroundingNote({ grounding }: { grounding?: Project['grounding'] }) {
  if (!grounding) return null;
  const text =
    grounding === 'document'
      ? 'Taught from the source you supplied.'
      : grounding === 'supplied'
        ? 'Rendered from a ready-made lesson — this studio sourced nothing itself.'
        : 'Taught from no source: every claim here is the model’s own knowledge, and nothing checked it.';
  return (
    <p
      className={cn(
        'mt-1 text-xs',
        grounding === 'parametric' ? 'text-warning' : 'text-muted-foreground',
      )}
    >
      {text}
    </p>
  );
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
function LaneNote({ lanes }: { lanes?: string[] }) {
  if (!lanes || lanes.length === 0) return null;
  const named = lanes.map((l) => LANE_LABELS[l] ?? l);
  const list =
    named.length === 1
      ? named[0]
      : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  return (
    <p className="mt-1 text-xs text-warning">
      This lesson asks for {list}, which inkcast has no lane for yet — those pictures are
      approximations, not correct drawings.
    </p>
  );
}

export function ResultView({
  project,
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

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-2xl text-foreground">{project.title}</h1>
            <p className="tabular mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {duration ? <span>{clock(duration)}</span> : null}
              {storyboard ? <span>· {storyboard.scenes.length} scenes</span> : null}
              <span>· {aspect}</span>
              {created ? (
                <span title={absoluteTime(project.updatedAt ?? project.createdAt)}>
                  · {created}
                </span>
              ) : null}
              <span className="font-mono">· {project.id}</span>
            </p>
            <GroundingNote grounding={project.grounding} />
            <LaneNote lanes={project.unservedLanes} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {src ? (
              <Button
                size="sm"
                render={<a href={src} download={downloadName(project.title, project.id)} />}
              >
                <DownloadIcon aria-hidden />
                Download
              </Button>
            ) : null}

            <CopyLinkButton projectId={project.id} />

            <Button variant="outline" size="sm" onClick={onRerender} disabled={rerendering}>
              <RotateCcwIcon aria-hidden />
              {rerendering ? 'Starting…' : 'Re-render'}
            </Button>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Open the public share page"
                    render={<Link href={`/share/${project.id}`} target="_blank" />}
                  />
                }
              >
                <ExternalLinkIcon aria-hidden />
              </TooltipTrigger>
              <TooltipContent>Open the public share page</TooltipContent>
            </Tooltip>

            <DeleteProjectButton
              projectId={project.id}
              title={project.title}
              onDeleted={onDeleted}
            />
          </div>
        </div>

        {dirty ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
            <p className="text-sm text-foreground">
              The storyboard has changed. The video below is the previous render.
            </p>
            <Button size="xs" onClick={onRerender} disabled={rerendering}>
              {rerendering ? 'Starting…' : 'Re-render now'}
            </Button>
          </div>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
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
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <FilmIcon className="size-4" aria-hidden />
                </span>
                <p className="text-base font-medium text-foreground">No video on disk yet</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {project.error
                    ? project.error
                    : 'The storyboard is here, but nothing has been encoded from it. Rendering is a pure function of the storyboard, so this is one click.'}
                </p>
                <Button size="sm" onClick={onRerender} disabled={rerendering}>
                  <RotateCcwIcon aria-hidden />
                  {rerendering ? 'Starting…' : 'Render it'}
                </Button>
              </CardContent>
            </Card>
          )}

          {storyboard ? (
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
          <Card>
            <CardContent className="flex flex-col gap-2 py-6">
              <Badge variant="warning" className="w-fit">
                No storyboard
              </Badge>
              <p className="text-sm text-muted-foreground">
                This project directory has no readable storyboard.json, so there is nothing to
                inspect or edit.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
