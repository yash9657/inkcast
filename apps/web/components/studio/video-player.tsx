'use client';

import * as React from 'react';
import {
  AlertTriangleIcon,
  KeyboardIcon,
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PlayIcon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Slider,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui';
import { cn } from '@/lib/utils';

import { aspectRatio, clock } from './format';

/**
 * The player.
 *
 * Native `controls` are deliberately off: the app owns the timeline because the
 * storyboard inspector seeks into it, and a UA control bar cannot be told to
 * match the type scale or the focus ring. Everything a UA player gives you is
 * re-implemented here on purpose — keyboard shortcuts, a real scrubber with
 * arrow-key support (Base UI's `Slider`, not a styled `input[type=range]`),
 * volume, rate, fullscreen — plus one thing they do not: the controls stay put
 * while you are tabbing through them.
 */

export type VideoPlayerHandle = {
  /** Jump to a time, optionally starting playback. */
  seek: (seconds: number, play?: boolean) => void;
};

export type VideoPlayerProps = {
  src: string;
  /** Used for the accessible name and the download-adjacent context. */
  title: string;
  poster?: string;
  aspect?: '16:9' | '9:16' | '1:1';
  /** Runtime from the storyboard, shown until the file reports its own. */
  fallbackDuration?: number;
  className?: string;
};

const RATES = ['0.75', '1', '1.25', '1.5', '2'] as const;

const SHORTCUTS: [action: string, keys: string][] = [
  ['Play or pause', 'Space · K'],
  ['Skip 5 seconds', '← →'],
  ['Skip 10 seconds', 'J · L'],
  ['Volume', '↑ ↓'],
  ['Mute', 'M'],
  ['Fullscreen', 'F'],
  ['Jump to 0–90%', '0–9'],
  ['Start or end', 'Home · End'],
];

export const VideoPlayer = React.forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer(
    { src, title, poster, aspect = '16:9', fallbackDuration, className },
    handleRef,
  ) {
    const videoRef = React.useRef<HTMLVideoElement>(null);
    const shellRef = React.useRef<HTMLDivElement>(null);
    const hideTimer = React.useRef<number | undefined>(undefined);

    const [playing, setPlaying] = React.useState(false);
    const [current, setCurrent] = React.useState(0);
    const [duration, setDuration] = React.useState<number | undefined>(fallbackDuration);
    const [volume, setVolume] = React.useState(1);
    const [muted, setMuted] = React.useState(false);
    const [rate, setRate] = React.useState<string>('1');
    const [fullscreen, setFullscreen] = React.useState(false);
    const [controlsVisible, setControlsVisible] = React.useState(true);
    const [failed, setFailed] = React.useState(false);

    const total = duration && duration > 0 ? duration : (fallbackDuration ?? 0);

    /* ------------------------------------------------------------ commands */

    const play = React.useCallback(() => {
      const video = videoRef.current;
      if (!video) return;
      void video.play().catch(() => {
        /* autoplay policy or a decode error; `onError` reports the real one */
      });
    }, []);

    const toggle = React.useCallback(() => {
      const video = videoRef.current;
      if (!video) return;
      if (video.paused) play();
      else video.pause();
    }, [play]);

    const seek = React.useCallback((seconds: number, andPlay = false) => {
      const video = videoRef.current;
      if (!video) return;
      const limit = Number.isFinite(video.duration) ? video.duration : seconds;
      video.currentTime = Math.max(0, Math.min(seconds, limit));
      setCurrent(video.currentTime);
      if (andPlay) void video.play().catch(() => undefined);
    }, []);

    const nudge = React.useCallback(
      (delta: number) => {
        const video = videoRef.current;
        if (!video) return;
        seek(video.currentTime + delta);
      },
      [seek],
    );

    const setVolumeSafely = React.useCallback((next: number) => {
      const video = videoRef.current;
      const clamped = Math.max(0, Math.min(1, next));
      setVolume(clamped);
      if (video) {
        video.volume = clamped;
        video.muted = clamped === 0;
      }
      setMuted(clamped === 0);
    }, []);

    const toggleFullscreen = React.useCallback(() => {
      const shell = shellRef.current;
      if (!shell) return;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      else void shell.requestFullscreen().catch(() => undefined);
    }, []);

    React.useImperativeHandle(handleRef, () => ({ seek: (s, p) => seek(s, p) }), [seek]);

    /* -------------------------------------------------------- side effects */

    React.useEffect(() => {
      const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
      document.addEventListener('fullscreenchange', onChange);
      return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    // Shortcuts are document-level so they work straight after clicking the
    // video, but never while the user is typing — an edit box on the same page
    // must keep every key it needs.
    React.useEffect(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null;
        if (
          target &&
          (target.isContentEditable ||
            ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
            target.getAttribute('role') === 'slider')
        ) {
          return;
        }
        if (event.metaKey || event.ctrlKey || event.altKey) return;

        switch (event.key) {
          case ' ':
          case 'k':
            event.preventDefault();
            toggle();
            break;
          case 'ArrowRight':
            event.preventDefault();
            nudge(5);
            break;
          case 'ArrowLeft':
            event.preventDefault();
            nudge(-5);
            break;
          case 'l':
            nudge(10);
            break;
          case 'j':
            nudge(-10);
            break;
          case 'ArrowUp':
            event.preventDefault();
            setVolumeSafely(volume + 0.1);
            break;
          case 'ArrowDown':
            event.preventDefault();
            setVolumeSafely(volume - 0.1);
            break;
          case 'm': {
            const video = videoRef.current;
            if (video) {
              video.muted = !video.muted;
              setMuted(video.muted);
            }
            break;
          }
          case 'f':
            toggleFullscreen();
            break;
          case 'Home':
            event.preventDefault();
            seek(0);
            break;
          case 'End':
            if (total) seek(total);
            break;
          default:
            if (/^[0-9]$/.test(event.key) && total) {
              seek((Number(event.key) / 10) * total);
            }
        }
      };

      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [nudge, seek, setVolumeSafely, toggle, toggleFullscreen, total, volume]);

    const revealControls = React.useCallback(() => {
      setControlsVisible(true);
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
      }, 2600);
    }, []);

    React.useEffect(() => () => window.clearTimeout(hideTimer.current), []);

    /* ---------------------------------------------------------------- view */

    return (
      <div
        ref={shellRef}
        className={cn(
          // Paper, not black: every Inkcast film is drawn on paper, so the frame
          // the poster and the letterbox share is the board's own colour.
          'group/player relative flex flex-col overflow-hidden rounded-xl border border-border-subtle bg-paper shadow-card',
          'focus-within:border-input',
          className,
        )}
        onPointerMove={revealControls}
        onPointerLeave={() => {
          if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
        }}
      >
        {/* The picture keeps its own aspect so phone controls can sit below it. */}
        <div
          className={cn('relative', fullscreen && 'min-h-0 flex-1')}
          style={fullscreen ? undefined : { aspectRatio: aspectRatio(aspect) }}
        >
          <video
            ref={videoRef}
            src={src}
            poster={poster}
            preload="metadata"
            playsInline
            aria-label={title}
            className="size-full bg-paper object-contain"
            onClick={toggle}
            onPlay={() => {
              setPlaying(true);
              revealControls();
            }}
            onPause={() => {
              setPlaying(false);
              setControlsVisible(true);
            }}
            onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => {
              const value = event.currentTarget.duration;
              if (Number.isFinite(value) && value > 0) setDuration(value);
              setFailed(false);
            }}
            onEnded={() => setPlaying(false)}
            onError={() => setFailed(true)}
          />

          {failed ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 p-6 text-center">
              <AlertTriangleIcon className="size-5 text-destructive" aria-hidden />
              <p className="text-sm text-foreground">This video could not be loaded.</p>
              <p className="text-xs text-muted-foreground">
                The file may still be encoding, or it was removed from the project directory.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setFailed(false);
                  videoRef.current?.load();
                }}
              >
                Try again
              </Button>
            </div>
          ) : null}

          {/* A single big affordance while paused. */}
          {!playing && !failed ? (
            <button
              type="button"
              onClick={play}
              aria-label="Play"
              className={cn(
                'focus-ring absolute inset-0 flex items-center justify-center outline-none',
                'transition-opacity duration-brisk ease-out',
              )}
            >
              <span
                className={cn(
                  'flex size-16 items-center justify-center rounded-full',
                  // `shadow-overlay` is where `shadow-lg` was already resolving
                  // through the alias block; naming it directly is the sweep.
                  'bg-ink text-paper shadow-overlay',
                  'transition-transform duration-fast ease-out',
                  'group-hover/player:scale-105',
                )}
              >
                <PlayIcon className="size-6 translate-x-0.5" aria-hidden />
              </span>
            </button>
          ) : null}
        </div>

        {/* Controls: below the picture on phones, overlaid from `sm` up. */}
        <div
          className={cn(
            'flex flex-col gap-0.5 border-t border-border-subtle bg-card px-2 py-1.5',
            'sm:absolute sm:inset-x-0 sm:bottom-0 sm:gap-1 sm:border-t-0 sm:bg-background/92 sm:p-3 sm:backdrop-blur-sm',
            'transition-opacity duration-brisk ease-out',
            controlsVisible || !playing
              ? 'opacity-100'
              : 'sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover/player:opacity-100',
          )}
        >
          <Slider
            label={<span className="sr-only">Seek</span>}
            showValue={false}
            className="gap-1"
            value={Math.min(current, total || current)}
            min={0}
            max={total || 1}
            step={0.05}
            disabled={!total}
            onValueChange={(value: unknown) => {
              const next = Array.isArray(value) ? value[0] : value;
              if (typeof next === 'number') seek(next);
            }}
          />

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={playing ? 'Pause' : 'Play'}
              onClick={toggle}
            >
              {playing ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />}
            </Button>

            <p className="tabular px-1 text-xs text-muted-foreground">
              <span className="text-foreground">{clock(current)}</span>
              {' / '}
              {total ? clock(total) : '—'}
            </p>

            <div className="ml-auto flex items-center gap-1">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
                  onClick={() => {
                    const video = videoRef.current;
                    if (!video) return;
                    if (video.muted || video.volume === 0) {
                      const restored = volume === 0 ? 1 : volume;
                      video.muted = false;
                      video.volume = restored;
                      setVolume(restored);
                      setMuted(false);
                    } else {
                      video.muted = true;
                      setMuted(true);
                    }
                  }}
                >
                  {muted || volume === 0 ? (
                    <VolumeXIcon aria-hidden />
                  ) : (
                    <Volume2Icon aria-hidden />
                  )}
                </Button>
                <Slider
                  label={<span className="sr-only">Volume</span>}
                  showValue={false}
                  className="hidden w-20 gap-0 sm:flex"
                  value={muted ? 0 : volume}
                  min={0}
                  max={1}
                  step={0.05}
                  onValueChange={(value: unknown) => {
                    const next = Array.isArray(value) ? value[0] : value;
                    if (typeof next === 'number') setVolumeSafely(next);
                  }}
                />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="sm" aria-label="Playback speed" />}
                >
                  <span className="tabular text-xs">{rate}×</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Speed</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={rate}
                    onValueChange={(value: unknown) => {
                      const next = String(value);
                      setRate(next);
                      if (videoRef.current) videoRef.current.playbackRate = Number(next);
                    }}
                  >
                    {RATES.map((option) => (
                      <DropdownMenuRadioItem key={option} value={option}>
                        {option}×
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" />}
                >
                  <KeyboardIcon aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56 p-2">
                  <DropdownMenuLabel className="px-1">Keyboard</DropdownMenuLabel>
                  <dl className="flex flex-col gap-1.5 px-1 py-1">
                    {SHORTCUTS.map(([action, keys]) => (
                      <div key={action} className="flex items-baseline justify-between gap-4">
                        <dt className="text-sm text-foreground">{action}</dt>
                        <dd className="tabular text-2xs text-muted-foreground">{keys}</dd>
                      </div>
                    ))}
                  </dl>
                </DropdownMenuContent>
              </DropdownMenu>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                      onClick={toggleFullscreen}
                    />
                  }
                >
                  {fullscreen ? <MinimizeIcon aria-hidden /> : <MaximizeIcon aria-hidden />}
                </TooltipTrigger>
                <TooltipContent side="top">
                  {fullscreen ? 'Exit fullscreen' : 'Fullscreen'} · F
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    );
  },
);
