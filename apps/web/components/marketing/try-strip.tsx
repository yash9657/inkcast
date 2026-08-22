import { ArrowRightIcon } from 'lucide-react';

import { Button, Input } from '@/components/ui';

import { CommandSnippet } from './command-snippet';
import { Reveal } from './reveal';
import { STUDIO_HREF, STUDIO_TOPIC_MAX, STUDIO_TOPIC_PARAM, studioTopicHref } from './site-config';

/**
 * The try strip: one box, one button, straight into the studio.
 *
 * ## It is a real form, not a controlled input
 *
 * `<form action="/studio" method="get">` with `name="topic"` produces exactly
 * `/studio?topic=…` — the browser does the encoding, the navigation is an
 * ordinary document request, and the whole thing works with JavaScript disabled,
 * before hydration, and in a webview that broke `history.pushState`. A
 * `useState` + `router.push` version of this would ship a client component, a
 * hydration boundary and a spinner to reimplement a browser feature from 1995.
 * The FAQ on this same page makes the same trade with `<details>`; this is that
 * argument applied to the one control that matters most.
 *
 * The consequence to be honest about: **the studio does not read `?topic=` yet.**
 * `components/studio/create-form.tsx` reads `?example=`, which selects a bundled
 * document by slug and cannot carry free text. Until that form seeds its textarea
 * from `STUDIO_TOPIC_PARAM`, a visitor who types here lands on the studio with an
 * empty box — friction, not a dead end, and the parameter name is pinned in
 * `site-config.ts` so the other side has something to implement against.
 *
 * ## Why three suggestions
 *
 * The hardest part of a blank box is the blankness. Each chip is a link to the
 * same prefilled URL the form produces, so they cost no JavaScript and they
 * double as documentation of what a good topic looks like: a sentence, not a
 * subject. `photosynthesis` is the one bundled in `examples/photosynthesis.md`,
 * so the first suggestion is also the thing we have most often rendered.
 */
const SUGGESTIONS = [
  'explain photosynthesis',
  'how a jet engine makes thrust',
  'what gradient descent is doing',
] as const;

export function TryStrip() {
  return (
    <section id="try" className="scroll-mt-16 py-16 sm:py-20" aria-labelledby="try-heading">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <Reveal className="mx-auto max-w-3xl">
          <div className="border border-border bg-card p-6 shadow-card sm:p-8">
            <h2 id="try-heading" className="text-2xl sm:text-3xl">
              Start with a topic
            </h2>
            <p className="mt-2 text-md text-muted-foreground">
              One sentence is enough. It plans the lesson, writes the board, and narrates it.
            </p>

            <form action={STUDIO_HREF} method="get" className="mt-6">
              <label htmlFor="try-topic" className="sr-only">
                What should it explain?
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  id="try-topic"
                  name={STUDIO_TOPIC_PARAM}
                  type="text"
                  required
                  maxLength={STUDIO_TOPIC_MAX}
                  autoComplete="off"
                  enterKeyHint="go"
                  placeholder="explain photosynthesis…"
                  className="h-12 flex-1 px-4 text-md"
                />
                <Button type="submit" size="lg" className="h-12 shrink-0">
                  Draw it
                  <ArrowRightIcon aria-hidden />
                </Button>
              </div>
            </form>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="font-mono text-2xs uppercase text-muted-foreground">Or try</span>
              {SUGGESTIONS.map((topic) => (
                <a
                  key={topic}
                  href={studioTopicHref(topic)}
                  className="focus-ring rounded-pill border border-border-subtle px-3 py-1 text-xs text-muted-foreground transition-colors duration-fast ease-out hover:border-accent-strong hover:bg-accent-soft hover:text-foreground"
                >
                  {topic}
                </a>
              ))}
            </div>

            <div className="mt-8 flex flex-col gap-3 border-t border-border-subtle pt-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Or point the compiler at a file you already have:
              </p>
              <CommandSnippet command="pnpm cast examples/photosynthesis.md" />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
