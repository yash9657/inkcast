'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';
import { PlayIcon } from 'lucide-react';
import { Button } from '@/components/ui';

/** Keep the poster clear until play, then hand controls to the native player. */
export function GpsShowcase() {
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
              src="/showcase/gps-v4-poster.jpg"
              alt="A finished GPS diagram with two satellite range circles and their intersections highlighted in cyan."
              className="block aspect-video w-full"
              width={1920}
              height={1080}
            />
            <Button
              onClick={play}
              variant="secondary"
              size="lg"
              className="absolute bottom-4 left-4"
              aria-label="Play How GPS finds your position"
            >
              <PlayIcon aria-hidden /> Watch the film
            </Button>
          </>
        )}
        <video
          ref={player}
          aria-labelledby="gps-film-title"
          className={started ? 'focus-ring block aspect-video w-full' : 'hidden'}
          controls
          playsInline
          preload="none"
          poster="/showcase/gps-v4-poster.jpg"
          width={1920}
          height={1080}
          onError={showFailure}
        >
          <source src="/showcase/gps-v4.mp4" type="video/mp4" />
          <track kind="captions" src="/showcase/gps-v4.vtt" srcLang="en" label="English" />
          <a href="/showcase/gps-v4.mp4">Watch the GPS video</a>
        </video>
      </div>
      {failed && (
        <p role="alert" className="px-5 py-4 text-sm text-muted-foreground">
          The video could not play. Try again or{' '}
          <a href="/showcase/gps-v4.mp4" className="focus-ring underline underline-offset-4">
            open the video directly
          </a>
          .
        </p>
      )}
    </>
  );
}
