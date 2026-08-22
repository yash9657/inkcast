import * as React from 'react';

import { BoardSketch } from './board-sketch';
import { FormatPreview } from './format-preview';
import { Reveal } from './reveal';
import { CodeChip, Section, SectionHeading } from './section';
import { showcaseProjects, type ShowcaseAspect } from './site-config';

/**
 * The format row: the same compiler, three frame shapes.
 *
 * This is the section the nav calls **Examples**, and the name is the honest one
 * — the cards show films rather than describing features. What each card can show
 * depends on the deployment: `showcaseProjects` maps a frame shape to a pinned
 * project id from the environment, and when one is set the card loops that film's
 * four-second `preview.gif` (falling back to its `thumbnail.png`, then to a drawn
 * sketch — see `format-preview.tsx`). When it is not set, the card draws the
 * sketch directly, server-side, with no request and nothing to break.
 *
 * ## The three boxes are the same area on purpose
 *
 * 256×144, 144×256, 192×192 — all exactly on the 4px spacing scale, all exactly
 * the right ratio, all 36,864 px². Sizing the three shapes to equal area rather
 * than equal width is what makes the row read as "one film, three crops" instead
 * of "one big card and two small ones", and fixing both dimensions in CSS means
 * a late-arriving gif cannot shift the card beside it.
 *
 * Every number stated in this section is a real storyboard field or a shipped
 * capability: `meta.aspect` takes exactly these three values, and all three
 * render at 1080p/30 today (`PLAN-LAUNCH.md` B1). No card claims a platform
 * integration — "Reels, TikTok, Shorts" names where a 9:16 file goes, not an API
 * we have connected.
 */

type Format = {
  aspect: ShowcaseAspect;
  title: string;
  where: string;
  body: React.ReactNode;
  /** Fixed box, on the spacing scale, exact ratio. */
  frame: string;
  width: number;
  height: number;
  seed: number;
};

const FORMATS: Format[] = [
  {
    aspect: '16:9',
    title: 'Landscape',
    where: 'YouTube · slides · embeds',
    body: 'A wide board the camera pans across, so a whole argument can stay on screen and be pointed at later.',
    frame: 'h-36 w-64',
    width: 256,
    height: 144,
    seed: 0x16_09_01,
  },
  {
    aspect: '9:16',
    title: 'Vertical',
    where: 'Reels · TikTok · Shorts',
    body: 'A tall canvas the camera walks down. One idea per beat, and the board is still there under the last one.',
    frame: 'h-64 w-36',
    width: 144,
    height: 256,
    seed: 0x09_16_02,
  },
  {
    aspect: '1:1',
    title: 'Square',
    where: 'Feeds · docs · chat',
    body: 'For the places that crop a wide film and letterbox a tall one. Same lesson, framed to survive both.',
    frame: 'h-48 w-48',
    width: 192,
    height: 192,
    seed: 0x01_01_03,
  },
];

export function FormatRow() {
  return (
    <Section id="examples" aria-labelledby="examples-heading">
      <SectionHeading
        eyebrow="Examples"
        headingId="examples-heading"
        title="Every shape a feed asks for"
        lead={
          <>
            One field on the storyboard — <CodeChip>meta.aspect</CodeChip> — decides the frame, and
            the camera reframes the same canvas to fit it. All three render at 1080p and 30fps, and
            none of them is a paid tier.
          </>
        }
      />

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FORMATS.map((format, i) => {
          const id = showcaseProjects[format.aspect];
          return (
            <Reveal as="li" key={format.aspect} index={i} className="flex">
              <div className="flex w-full flex-col border border-border bg-card shadow-card">
                {/* The well the film sits in: recessed, ruled off from the copy,
                    and the film itself gets its own ink edge so it reads as a
                    frame rather than as a hole in the card. */}
                <div className="inset-shadow-well flex items-center justify-center border-b border-border bg-muted p-6">
                  <div className="border border-border">
                    {id ? (
                      <FormatPreview
                        id={id}
                        aspect={format.aspect}
                        label={format.title.toLowerCase()}
                        seed={format.seed}
                        width={format.width}
                        height={format.height}
                        className={format.frame}
                      />
                    ) : (
                      <BoardSketch
                        aspect={format.aspect}
                        seed={format.seed}
                        className={format.frame}
                      />
                    )}
                  </div>
                </div>

                <div className="flex flex-1 flex-col gap-2 p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h3 className="text-xl">{format.title}</h3>
                    <span className="tabular font-mono text-xs text-muted-foreground">
                      {format.aspect}
                    </span>
                  </div>
                  <p className="font-mono text-2xs uppercase text-muted-foreground">
                    {format.where}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{format.body}</p>
                </div>
              </div>
            </Reveal>
          );
        })}
      </ul>
    </Section>
  );
}
