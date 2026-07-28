import * as React from 'react';
import { FileTextIcon, FilmIcon, LayoutTemplateIcon, MicIcon, PenToolIcon } from 'lucide-react';

import { Reveal } from './reveal';
import { CodeChip, Section, SectionHeading } from './section';

/**
 * The pipeline, as it actually exists.
 *
 * Each step names the real package and the real entry signature from
 * `docs/CONTRACT.md`, because for the audience that will actually adopt this, a
 * function signature is more persuasive than an adjective. Nothing here is a
 * roadmap: every stage listed has a local default that runs with no API key.
 */

type Step = {
  stage: string;
  pkg: string;
  signature: string;
  title: string;
  body: React.ReactNode;
  Icon: React.ComponentType<{ className?: string }>;
};

const STEPS: Step[] = [
  {
    stage: 'ingest',
    pkg: '@inkcast/planner',
    signature: 'ingest({ text, filePath, url }) → SourceDoc',
    title: 'Read the source',
    body: (
      <>
        A markdown file, a pasted prompt, a URL. It comes out the other side as one{' '}
        <CodeChip>SourceDoc</CodeChip> with its headings and structure intact, because the structure
        is what the next stage plans against.
      </>
    ),
    Icon: FileTextIcon,
  },
  {
    stage: 'plan',
    pkg: '@inkcast/planner',
    signature: 'plan(doc, opts) → Storyboard',
    title: 'Lay out one canvas',
    body: (
      <>
        Scenes, narration and element positions land on a single canvas that is wider than the
        frame. Each scene moves a <CodeChip>camera</CodeChip> across it. With no key set this is a
        deterministic structure-aware planner; set <CodeChip>ANTHROPIC_API_KEY</CodeChip> and a
        model does the planning instead.
      </>
    ),
    Icon: LayoutTemplateIcon,
  },
  {
    stage: 'voice',
    pkg: '@inkcast/voice',
    signature: 'narrate(sb, dir) → Storyboard',
    title: 'Speak it, then measure it',
    body: (
      <>
        Kokoro runs locally through ONNX and writes the real measured length of every clip back into{' '}
        <CodeChip>scene.durationSec</CodeChip>. Because entry times are fractions of a scene rather
        than seconds, re-voicing in another language reflows the animation instead of desyncing it.
      </>
    ),
    Icon: MicIcon,
  },
  {
    stage: 'visuals',
    pkg: '@inkcast/visuals',
    signature: 'resolveVisuals(sb, dir) → Storyboard',
    title: 'Resolve each thing once',
    body: (
      <>
        Every entity in <CodeChip>storyboard.assets[]</CodeChip> is drawn a single time, keyed by id
        and locked to a seed. Scene nine references the same rover scene two drew, so it cannot
        quietly become a different rover.
      </>
    ),
    Icon: PenToolIcon,
  },
  {
    stage: 'render',
    pkg: '@inkcast/render',
    signature: 'render(sb, dir) → { videoPath }',
    title: 'Draw the frames, mux the file',
    body: (
      <>
        A headless Chromium page is seeked deterministically frame by frame while the strokes are
        drawn on, then ffmpeg muxes picture and audio. Playwright and ffmpeg, not Remotion — see the
        FAQ for why that distinction costs you nothing.
      </>
    ),
    Icon: FilmIcon,
  },
];

export function HowItWorks() {
  return (
    <Section id="how-it-works" aria-labelledby="how-it-works-heading">
      <SectionHeading
        eyebrow="How it works"
        headingId="how-it-works-heading"
        title="Five stages, each one only adding to the same JSON"
        lead={
          <>
            Inkcast is a compiler, not a model. Every stage takes the storyboard, enriches it, and
            hands it on — which is why a change to scene seven re-renders scene seven and nothing
            else.
          </>
        }
      />

      <ol className="relative flex flex-col gap-4">
        {STEPS.map((step, i) => (
          <Reveal
            key={step.stage}
            as="li"
            index={i}
            className="relative flex gap-4 rounded-xl border border-border bg-card p-5 sm:gap-6 sm:p-6"
          >
            <div className="flex flex-col items-center gap-3">
              <span
                className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary"
                aria-hidden
              >
                <step.Icon className="size-4" />
              </span>
              <span className="tabular text-2xs text-muted-foreground" aria-hidden>
                {String(i + 1).padStart(2, '0')}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-xl">{step.title}</h3>
                <span className="font-mono text-xs text-muted-foreground">{step.pkg}</span>
              </div>
              <p className="mt-2 text-md text-muted-foreground">{step.body}</p>
              <p className="mt-3 overflow-x-auto font-mono text-xs whitespace-nowrap text-foreground/70 scrollbar-none">
                {step.signature}
              </p>
            </div>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}
