'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';
import { PlayIcon } from 'lucide-react';
import { Button } from '@/components/ui';

type ShowcaseFilmProps = {
  /** Path stem under /showcase: `<name>.mp4`, `<name>-poster.jpg`, `<name>.vtt`. */
  name: string;
  /** Describes the poster image. */
  alt: string;
  /** Accessible name of the play button. */
  playLabel: string;
  /** Id of the element that titles the film. */
  titleId: string;
  /** Visible play button text, or `null` when the poster draws its own. */
  cta?: string | null;
};

/** Keep the poster clear until play, then hand controls to the native player. */
export function ShowcaseFilm({
  name,
  alt,
  playLabel,
  titleId,
  cta = 'Watch the film',
}: ShowcaseFilmProps) {
  const src = `/showcase/${name}.mp4`;
  const poster = `/showcase/${name}-poster.jpg`;
  const player = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);

  const showFailure = () => {
    setStarted(false);
    setFailed(true);
  };

  const play = async () => {
    if (!player.current) return;
    setFailed(false);
    setStarted(true);
    try {
      if (failed) player.current.load();
      // Call play directly from the gesture so mobile browsers allow audio.
      await player.current.play();
      player.current.focus({ preventScroll: true });
    } catch {
      showFailure();
    }
  };

  return (
    <>
      <div className="relative">
        {!started && (
          <>
            <Image
              src={poster}
              alt={alt}
              className="block aspect-video w-full"
              width={1920}
              height={1080}
            />
            {cta === null ? (
              <button
                type="button"
                onClick={play}
                className="focus-ring absolute inset-0 cursor-pointer"
                aria-label={playLabel}
              />
            ) : (
              <Button
                onClick={play}
                variant="secondary"
                size="lg"
                className="absolute bottom-4 left-4 border-transparent shadow-overlay sm:bottom-6 sm:left-6"
                aria-label={playLabel}
              >
                <PlayIcon aria-hidden /> {cta}
              </Button>
            )}
          </>
        )}
        <video
          ref={player}
          aria-labelledby={titleId}
          className={started ? 'focus-ring block aspect-video w-full' : 'hidden'}
          controls
          playsInline
          preload="none"
          poster={poster}
          width={1920}
          height={1080}
          onError={showFailure}
        >
          <source src={src} type="video/mp4" />
          <track kind="captions" src={`/showcase/${name}.vtt`} srcLang="en" label="English" />
          <a href={src}>Watch the video</a>
        </video>
      </div>
      {failed && (
        <p role="alert" className="px-5 py-4 text-sm text-muted-foreground">
          The video could not play. Try again or{' '}
          <a href={src} className="focus-ring underline underline-offset-4">
            open the video directly
          </a>
          .
        </p>
      )}
    </>
  );
}
