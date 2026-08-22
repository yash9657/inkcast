import * as React from 'react';
import { ChevronDownIcon } from 'lucide-react';

import { Reveal } from './reveal';
import { CodeChip, Section, SectionHeading } from './section';
import { COST_CLOUD, COST_LOCAL, LICENCE, repoUrl } from './site-config';

/**
 * The FAQ.
 *
 * Native `<details>` / `<summary>`, not a JavaScript accordion. It is keyboard
 * operable, findable by the browser's in-page search even while collapsed, and
 * works before hydration — three things a `div` with an `onClick` gives up in
 * exchange for nothing. There is no accordion primitive in
 * `components/ui`, and this is the reason none was needed.
 *
 * ## What the re-skin changed here
 *
 * The list is one bordered block with `shadow-card` instead of seven rows ruled
 * off from an otherwise empty section. The reason is a token value, not taste:
 * `--border` is ink now (docs/DESIGN.md §11), so the old `border-b border-border`
 * between rows draws a 1px *black* rule, and seven of them stacked on bare paper
 * read as a table with no table. Ink goes on the outside where it is the block's
 * edge; the separators between questions drop to `border-subtle`, which is what
 * that token was added for. The two `rounded-*` classes that used to sit on the
 * summary and the licence link are gone rather than set to `rounded-none` — the
 * radius ladder is flat, so they produced no CSS and would have quietly become
 * wrong again the day somebody gave `--radius-md` a value.
 */

type Entry = { q: string; a: React.ReactNode };

const ENTRIES: Entry[] = [
  {
    q: 'Do I need an API key?',
    a: (
      <>
        No. With no environment variables set, planning is a deterministic structure-aware pass,
        narration is Kokoro running locally through ONNX, and the artwork comes from a built-in icon
        set with procedural diagrams. Cloud providers are opt-in adapters selected by env var; if a
        key is missing the run logs a warning and continues on the local path instead of failing.
      </>
    ),
  },
  {
    q: 'What does a video actually cost to make?',
    a: (
      <>
        {COST_LOCAL} on the local path — there is no provider to bill you. If you opt into model
        planning, a hosted voice or generated artwork, the target is {COST_CLOUD} per finished
        minute of output, which is what those providers charge you directly rather than a
        subscription we resell.
      </>
    ),
  },
  {
    q: 'Can I change the video after it is generated?',
    a: (
      <>
        Yes, and it is the normal way to work rather than an upgrade. The whole video is one
        readable <CodeChip>storyboard.json</CodeChip>: an edit is a patch to that document and a
        re-render is a pure function of it. Because every stage hashes its inputs, changing scene
        seven re-renders scene seven and reuses the audio and artwork for everything else.
      </>
    ),
  },
  {
    q: 'Why Playwright and ffmpeg instead of Remotion?',
    a: (
      <>
        Remotion requires a paid company licence above three employees, which is incompatible with a
        project whose point is that it is free. So the renderer drives a headless Chromium page,
        seeks it deterministically frame by frame, captures the frames and muxes them with ffmpeg.
        Both are tools you already have and neither asks about your headcount.
      </>
    ),
  },
  {
    q: 'What about other languages and other voices?',
    a: (
      <>
        Narration language and voice are fields on the storyboard —{' '}
        <CodeChip>meta.language</CodeChip> and <CodeChip>meta.voice</CodeChip>. Element entry times
        are stored as fractions of a scene rather than seconds, so re-voicing reflows the animation
        automatically instead of drifting out of sync. Which languages and voices you can reach
        depends on the voice provider you point it at, so we do not print a number here.
      </>
    ),
  },
  {
    q: 'What shapes can it output?',
    a: (
      <>
        16:9, 9:16 and 1:1, set by <CodeChip>meta.aspect</CodeChip>, at the frame rate in{' '}
        <CodeChip>meta.fps</CodeChip>. Ink personality (<CodeChip>marker</CodeChip>,{' '}
        <CodeChip>pencil</CodeChip>, <CodeChip>chalk</CodeChip>, <CodeChip>ink</CodeChip>) and mono
        or colour are storyboard fields too, not tiers.
      </>
    ),
  },
  {
    q: 'What is the licence, and can I self-host it?',
    a: (
      <>
        {LICENCE}. Run it on your own machine or your own server, keep your documents on your own
        disk, change whatever you like — the licence asks that you share your changes to Inkcast
        itself under the same terms.
        {repoUrl ? (
          <>
            {' '}
            The full text is in{' '}
            <a
              href={`${repoUrl.replace(/\/+$/, '')}/LICENSE`}
              target="_blank"
              rel="noreferrer noopener"
              className="focus-ring text-primary underline underline-offset-4"
            >
              LICENSE
            </a>
            .
          </>
        ) : (
          <>
            {' '}
            The full text ships in <CodeChip>LICENSE</CodeChip> at the root of the repository.
          </>
        )}
      </>
    ),
  },
];

export function Faq() {
  return (
    <Section id="faq" aria-labelledby="faq-heading">
      <SectionHeading
        eyebrow="FAQ"
        headingId="faq-heading"
        title="The questions that decide it"
        lead="Short answers. Where a claim depends on something you can check, the field or the file is named."
      />

      <ul className="max-w-3xl border border-border bg-card shadow-card">
        {ENTRIES.map((entry, i) => (
          <Reveal
            as="li"
            key={entry.q}
            index={i}
            className="border-b border-border-subtle last:border-b-0"
          >
            <details className="group">
              {/* `list-none` kills the triangle in Chrome and Firefox; the
                  `-webkit-details-marker` rule is what Safari needs.

                  The open row tints rather than moves. An 8% accent wash on the
                  summary is enough to hold your place in a list of seven while
                  you read the answer, and it costs no layout: `bg-accent-soft` on
                  `group-open` and on hover are the same colour, so opening a row
                  under the pointer does not flash. */}
              <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 transition-colors duration-fast ease-out group-open:bg-accent-soft hover:bg-accent-soft [&::-webkit-details-marker]:hidden">
                <h3 className="text-md font-medium">{entry.q}</h3>
                <ChevronDownIcon
                  className="size-4 shrink-0 text-muted-foreground transition-transform duration-brisk ease-out group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="px-5 pt-1 pb-5 text-md text-muted-foreground">{entry.a}</p>
            </details>
          </Reveal>
        ))}
      </ul>
    </Section>
  );
}
