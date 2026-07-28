import * as React from 'react';
import {
  BracesIcon,
  FingerprintIcon,
  HardDriveIcon,
  PenLineIcon,
  ScaleIcon,
  ScanIcon,
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';

import { Reveal } from './reveal';
import { CodeChip, Section, SectionHeading } from './section';
import { COST_LOCAL, LICENCE } from './site-config';

/**
 * The differentiators, strongest first.
 *
 * Every one of these is a property of `packages/core/src/storyboard.ts` rather
 * than a feature bolted on top, which is the actual argument: they are hard to
 * copy without rebuilding the IR, and they cost nothing to give away because
 * they are structural.
 */

type Feature = {
  title: string;
  ir: string;
  body: React.ReactNode;
  Icon: React.ComponentType<{ className?: string }>;
};

const FEATURES: Feature[] = [
  {
    title: 'The board builds up. It never wipes.',
    ir: 'persist: true',
    body: (
      <>
        Elements default to staying on the canvas, and scenes move a <CodeChip>camera</CodeChip>{' '}
        around it rather than cutting to a blank slide. Scene nine can circle the thing scene one
        drew, so a viewer keeps the spatial context that makes a whiteboard worth using in the first
        place.
      </>
    ),
    Icon: ScanIcon,
  },
  {
    title: 'The rover stays the rover.',
    ir: 'assets[].seed',
    body: (
      <>
        Entities live in one library keyed by <CodeChip>id</CodeChip> and locked to a{' '}
        <CodeChip>seed</CodeChip>. An element references <CodeChip>assetId</CodeChip>, so the same
        character is drawn once and reused — never regenerated into a slightly different character
        four scenes later.
      </>
    ),
    Icon: FingerprintIcon,
  },
  {
    title: 'Handwriting in stroke order.',
    ir: "enter.style: 'write'",
    body: (
      <>
        Text is written along its strokes, the way a hand moves, instead of a finished outline
        fading in all at once. The same applies to drawn shapes: the renderer animates the stroke,
        not the opacity.
      </>
    ),
    Icon: PenLineIcon,
  },
  {
    title: `Runs on your laptop for ${COST_LOCAL}.`,
    ir: 'no env vars required',
    body: (
      <>
        No account, no key, no network. The planner is a deterministic structure-aware pass, the
        narration is Kokoro through ONNX, the artwork is a built-in icon set with procedural
        diagrams. Cloud providers are opt-in adapters behind env vars; a missing key logs a warning
        and keeps going.
      </>
    ),
    Icon: HardDriveIcon,
  },
  {
    title: 'Edit the storyboard in words.',
    ir: 'storyboard.json',
    body: (
      <>
        The whole video is one JSON document you can read. A natural-language edit is a patch to
        that document and a re-render is a pure function of it — so &ldquo;move the equation under
        the diagram and cut the third scene&rdquo; is a diff, not a regeneration, and it is free.
      </>
    ),
    Icon: BracesIcon,
  },
  {
    title: 'Yours to host and to fork.',
    ir: LICENCE,
    body: (
      <>
        Clone it, run it behind your own firewall, change the ink style, keep your documents on your
        own disk. Every project is a directory with a hash-checked cache, so a refresh cannot lose a
        finished video and a resumed run does not redo work.
      </>
    ),
    Icon: ScaleIcon,
  },
];

export function Features() {
  return (
    <Section id="features" aria-labelledby="features-heading">
      <SectionHeading
        eyebrow="Features"
        headingId="features-heading"
        title="Six things that fall out of the storyboard, not out of a feature list"
        lead="These are properties of the intermediate representation every stage agrees on. That is why none of them are a paid tier."
      />

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature, i) => (
          <Reveal as="li" key={feature.title} index={i} className="flex">
            <Card className="w-full gap-4">
              <CardHeader>
                <span
                  className="mb-2 grid size-9 place-items-center rounded-lg bg-primary/12 text-primary"
                  aria-hidden
                >
                  <feature.Icon className="size-4" />
                </span>
                <CardTitle className="text-lg leading-snug">{feature.title}</CardTitle>
                <CardDescription className="font-mono text-xs">{feature.ir}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{feature.body}</p>
              </CardContent>
            </Card>
          </Reveal>
        ))}
      </ul>
    </Section>
  );
}
