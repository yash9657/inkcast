import Link from 'next/link';
import { ArrowRightIcon, PlusIcon } from 'lucide-react';
import { Button, GithubIcon } from '@/components/ui';
import { ShowcaseFilm } from './showcase-film';
import { repoUrl, signInRequired, STUDIO_TOPIC_MAX, studioTopicHref } from './site-config';

/*
 * The landing page has one job: get a visitor from "what is this?" to typing
 * their own question, in that order, with the real output as the proof.
 *
 *   1. Say what it is in plain words, and put the input right under it.
 *   2. Show a real film, big.
 *   3. Three steps, so nobody wonders what happens after they press the button.
 *   4. The three shapes a video can take.
 *   5. Honest answers to the questions people actually have.
 *   6. Ask again.
 */

const STARTERS = ['Why is the sky blue?', 'How does GPS find my phone?', 'How do vaccines work?'];

const QUESTIONS: [string, string][] = [
  [
    'What can I turn into a video?',
    'A question, your notes, a PDF, Word or Markdown file, or a link to a public web page. Inkcast reads it, plans an explanation, draws the visuals and records the narration.',
  ],
  [
    'How long are the videos?',
    'Choose an explainer of about 75 seconds or a deep dive of about two and a half minutes. Final timing follows the narration.',
  ],
  [
    'Can I change the result?',
    'Yes. Open the project, describe what you want in plain words (“make scene 3 slower”, “narrate it in Spanish”) and render again.',
  ],
  [
    'Do I need API keys?',
    'No. Local planning, local narration and built-in artwork work without any keys. Connect Fireworks or Anthropic for model-written lessons, and ElevenLabs for more voices and languages. Usage is billed by those providers directly.',
  ],
  [
    'Can I run it myself?',
    'Yes. Inkcast is open source under AGPL-3.0. The self-hosted studio plans, narrates and renders on your own machine, with no account and no per-minute bill.',
  ],
];

export function Landing() {
  const canEdit = process.env.INKCAST_STORAGE !== 'blob';
  const questions = canEdit
    ? QUESTIONS
    : QUESTIONS.map(([q, a]): [string, string] =>
        q === 'Can I change the result?'
          ? [
              q,
              'Scene-by-scene editing is available in the self-hosted studio. On this site, start a new video from your revised source.',
            ]
          : [q, a],
      );

  return (
    <>
      {/* 1 · What it is, and the box to start ─────────────────────────── */}
      <section className="container-page pt-14 pb-12 text-center sm:pt-24 sm:pb-16">
        <h1 className="display-xl mx-auto max-w-4xl">
          Explain anything with a <span className="marker">hand‑drawn video.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl sm:leading-relaxed">
          Ask a question, paste your notes or drop in a PDF. Inkcast writes the lesson, draws it
          stroke by stroke and narrates it for you.
        </p>

        <TopicComposer id="hero-topic" className="mx-auto mt-10 max-w-2xl" />

        <div className="mx-auto mt-5 flex max-w-2xl flex-wrap items-center justify-center gap-2">
          <span className="text-sm text-muted-foreground">Try</span>
          {STARTERS.map((topic) => (
            <Link
              key={topic}
              href={studioTopicHref(topic)}
              className="focus-ring rounded-pill border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:border-input hover:bg-accent/50"
            >
              {topic}
            </Link>
          ))}
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          {signInRequired
            ? 'Free to try. Sign in to create; your question waits for you.'
            : 'No account or API keys needed to start.'}
        </p>
      </section>

      {/* 2 · The proof ─────────────────────────────────────────────────── */}
      <section id="examples" className="container-page scroll-mt-24 pb-20 sm:pb-28">
        <figure>
          <div className="overflow-hidden rounded-2xl bg-[oklch(0.27_0.06_255)] shadow-overlay ring-1 ring-border-subtle">
            <ShowcaseFilm
              name="gps-v4"
              alt="A finished Inkcast frame: two hand-drawn satellite range circles crossing, with the two intersection points circled in cyan."
              playLabel="Play the film: How GPS finds your position"
              titleId="gps-film-title"
              cta="Watch the film"
            />
          </div>
          <figcaption className="mt-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-1 text-sm">
            <span>
              <span id="gps-film-title" className="font-medium text-foreground">
                How GPS finds your position
              </span>
              <span className="text-muted-foreground"> · 2:47, narrated</span>
            </span>
            <span className="text-muted-foreground">
              Made by Inkcast from one question. Nothing retouched.
            </span>
          </figcaption>
        </figure>
      </section>

      {/* 3 · How it works ──────────────────────────────────────────────── */}
      <section
        id="how-it-works"
        className="scroll-mt-16 border-y border-border-subtle bg-card py-20 sm:py-28"
      >
        <div className="container-page">
          <h2 className="display-lg max-w-xl">
            From a question to a finished video in three steps.
          </h2>
          <ol className="mt-12 grid gap-10 sm:mt-16 md:grid-cols-3 md:gap-8">
            <Step
              n={1}
              title="Bring the idea"
              body="A question, lecture notes, a document or a web page. Start wherever the idea already lives."
            >
              <div className="flex h-full flex-col justify-center gap-2 px-6">
                <span className="text-xs text-muted-foreground">Your question</span>
                <span className="font-hand text-xl leading-snug text-ink">
                  How does GPS find my phone?
                </span>
                <span className="mt-1 h-0.5 w-10 animate-pulse rounded-full bg-ink" aria-hidden />
              </div>
            </Step>
            <Step
              n={2}
              title="Pick a shape"
              body="Vertical for Shorts and Reels, landscape for lessons, square for feeds. Short and sharp, or a deeper dive."
            >
              <div className="flex h-full items-center justify-center gap-4" aria-hidden>
                <span className="h-20 w-11 rounded-md border-2 border-ink/35" />
                <span className="h-16 w-28 rounded-md border-2 border-ink bg-highlighter/45" />
                <span className="size-16 rounded-md border-2 border-ink/35" />
              </div>
            </Step>
            <Step
              n={3}
              title="Watch it get drawn"
              body={
                canEdit
                  ? 'Inkcast plans the lesson, draws every scene and records the voice. Ask for changes in plain words.'
                  : 'Inkcast plans the lesson, draws every scene and records the voice. Download it or share a link.'
              }
            >
              <svg viewBox="0 0 200 120" className="h-full w-full p-5" aria-hidden>
                <text x="100" y="26" textAnchor="middle" className="fill-ink font-hand text-[15px]">
                  Each range narrows it down
                </text>
                <path
                  d="M46 34 H154"
                  stroke="var(--ink-blue)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <circle cx="80" cy="78" r="30" fill="none" stroke="var(--ink)" strokeWidth="2" />
                <circle
                  cx="120"
                  cy="78"
                  r="30"
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="2"
                  strokeDasharray="120 200"
                />
                <circle
                  cx="100"
                  cy="56"
                  r="5"
                  fill="none"
                  stroke="var(--ink-blue)"
                  strokeWidth="2.5"
                />
              </svg>
            </Step>
          </ol>
        </div>
      </section>

      {/* 4 · Formats ───────────────────────────────────────────────────── */}
      <section className="container-page py-20 sm:py-28">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <h2 className="display-lg max-w-lg">One idea, three shapes.</h2>
          <p className="max-w-sm text-muted-foreground">
            Pick where the video will live. Inkcast lays the board out for that frame.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-2 items-end gap-x-4 gap-y-8 sm:gap-6 md:grid-cols-[1.5fr_0.75fr_1fr]">
          <FormatCard
            aspect="16:9"
            title="Landscape"
            use="YouTube, lessons, slides"
            className="col-span-2 md:col-span-1"
            boardClass="aspect-[16/10]"
          >
            <span className="font-hand text-xl">A little less error.</span>
            <svg viewBox="0 0 360 130" className="w-full max-w-sm">
              <path d="M28 12v100h310" fill="none" stroke="currentColor" strokeWidth="2" />
              <path
                d="M50 25Q160 170 312 34"
                fill="none"
                stroke="var(--ink-green)"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <circle cx="95" cy="69" r="6" fill="var(--ink-green)" />
              <circle cx="147" cy="93" r="6" fill="var(--ink-green)" />
              <circle cx="195" cy="94" r="6" fill="var(--ink-green)" />
            </svg>
            <span className="font-hand text-sm">One step at a time.</span>
          </FormatCard>
          <FormatCard
            aspect="9:16"
            title="Vertical"
            use="Shorts, Reels, TikTok"
            boardClass="aspect-[9/14]"
          >
            <span className="font-hand text-lg leading-tight">
              Start with
              <br />a question.
            </span>
            <span className="my-1 font-hand text-2xl text-ink-green">↓</span>
            <span className="rounded-lg border-2 border-ink-green px-3 py-1.5 font-hand text-sm">
              Follow the idea.
            </span>
            <span className="my-1 font-hand text-2xl text-ink-green">↓</span>
            <span className="font-hand text-lg">Make it click.</span>
          </FormatCard>
          <FormatCard aspect="1:1" title="Square" use="Feeds and embeds" boardClass="aspect-square">
            <span className="font-hand text-lg">Connect the dots.</span>
            <svg viewBox="0 0 200 130" className="w-40 max-w-full">
              <path
                d="M44 70 100 28 156 70 100 110Z"
                fill="none"
                stroke="var(--ink-blue)"
                strokeWidth="2"
              />
              {[
                [44, 70],
                [100, 28],
                [156, 70],
                [100, 110],
              ].map(([x, y]) => (
                <circle
                  key={`${x}-${y}`}
                  cx={x}
                  cy={y}
                  r="12"
                  fill="var(--paper)"
                  stroke="var(--ink-blue)"
                  strokeWidth="2"
                />
              ))}
            </svg>
          </FormatCard>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          Illustrative frames, drawn in the same hand Inkcast uses.
        </p>
      </section>

      {/* 5 · Questions ─────────────────────────────────────────────────── */}
      <section
        id="faq"
        className="container-page grid scroll-mt-16 gap-10 border-t border-border-subtle py-20 sm:py-28 md:grid-cols-[1fr_1.6fr] md:gap-16"
      >
        <div>
          <h2 className="display-lg">Questions, answered.</h2>
          <p className="mt-4 max-w-sm text-muted-foreground">
            Inkcast is open source. Use it here, or run the whole studio on your own machine.
          </p>
          {repoUrl ? (
            <Button
              variant="secondary"
              className="mt-6"
              render={<a href={repoUrl} target="_blank" rel="noreferrer" />}
            >
              <GithubIcon aria-hidden /> View the source
            </Button>
          ) : null}
        </div>
        <div className="border-t border-border">
          {questions.map(([question, answer]) => (
            <details key={question} className="group border-b border-border">
              <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-6 py-5 [&::-webkit-details-marker]:hidden">
                <h3 className="text-base font-medium">{question}</h3>
                <PlusIcon
                  className="size-5 shrink-0 text-muted-foreground transition-transform duration-brisk group-open:rotate-45"
                  aria-hidden
                />
              </summary>
              <p className="max-w-prose pb-6 leading-relaxed text-muted-foreground">{answer}</p>
            </details>
          ))}
        </div>
      </section>

      {/* 6 · Ask again ─────────────────────────────────────────────────── */}
      <section className="container-page pb-20 sm:pb-28">
        <div className="rounded-3xl bg-brand-canvas px-6 py-14 text-center text-brand-canvas-ink sm:px-12 sm:py-20">
          <h2 className="display-lg">What will you explain first?</h2>
          <TopicComposer id="closing-topic" className="mx-auto mt-8 max-w-xl" />
        </div>
      </section>
    </>
  );
}

/**
 * The one input on the page. A plain GET form to `/studio?topic=`, so it works
 * before JavaScript and survives the sign-in round trip (see site-config).
 */
function TopicComposer({ id, className }: { id: string; className?: string }) {
  return (
    <form
      action="/studio"
      method="get"
      className={
        'group/composer flex flex-col gap-2 rounded-2xl border border-input bg-card p-2 text-left shadow-pop transition-[border-color,box-shadow] focus-within:border-foreground focus-within:shadow-[0_0_0_4px_var(--accent-soft)] sm:flex-row sm:items-center sm:rounded-pill sm:pl-6 ' +
        (className ?? '')
      }
    >
      <label htmlFor={id} className="sr-only">
        What do you want to explain?
      </label>
      <input
        id={id}
        name="topic"
        type="text"
        required
        maxLength={STUDIO_TOPIC_MAX}
        autoComplete="off"
        placeholder="What do you want to explain?"
        className="h-12 min-w-0 flex-1 bg-transparent px-3 text-base text-foreground outline-none placeholder:text-muted-foreground sm:px-0 sm:text-lg"
      />
      <Button type="submit" size="lg" className="shrink-0">
        Create video <ArrowRightIcon aria-hidden />
      </Button>
    </form>
  );
}

function Step({
  n,
  title,
  body,
  children,
}: {
  n: number;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-col">
      <div className="dot-grid aspect-[5/3] overflow-hidden rounded-xl border border-border-subtle bg-paper text-ink">
        {children}
      </div>
      <div className="mt-6 flex gap-4">
        <span
          className="font-display text-3xl leading-none text-muted-foreground tabular"
          aria-hidden
        >
          {n}
        </span>
        <div>
          <h3 className="text-lg">{title}</h3>
          <p className="mt-1.5 leading-relaxed text-muted-foreground">{body}</p>
        </div>
      </div>
    </li>
  );
}

function FormatCard({
  aspect,
  title,
  use,
  boardClass,
  className,
  children,
}: {
  aspect: string;
  title: string;
  use: string;
  boardClass: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={`/studio?aspect=${encodeURIComponent(aspect)}`}
      className={'group focus-ring min-w-0 rounded-xl ' + (className ?? '')}
    >
      <div
        aria-hidden
        className={
          'dot-grid flex flex-col items-center justify-center gap-2 rounded-xl border border-border-subtle bg-paper p-5 text-center text-ink transition-[border-color,translate] duration-brisk group-hover:-translate-y-0.5 group-hover:border-input ' +
          boardClass
        }
      >
        {children}
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base">{title}</h3>
          <p className="text-sm text-muted-foreground">{use}</p>
        </div>
        <span className="font-mono text-xs text-muted-foreground tabular">{aspect}</span>
      </div>
    </Link>
  );
}
