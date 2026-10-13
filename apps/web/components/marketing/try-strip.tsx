import { ArrowRightIcon } from 'lucide-react';

import { Button, Input } from '@/components/ui';

import { CommandSnippet } from './command-snippet';
import { Reveal } from './reveal';
import {
  signInRequired,
  STUDIO_HREF,
  STUDIO_TOPIC_MAX,
  STUDIO_TOPIC_PARAM,
  studioTopicHref,
} from './site-config';

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
 * **The studio reads `?topic=` now**, which closes the loop this section shipped
 * without: `components/studio/create-form.tsx` seeds its textarea from
 * `STUDIO_TOPIC_PARAM`, capped by the same `STUDIO_TOPIC_MAX` enforced on the
 * input above. It used to read only `?example=`, a bundled-document slug that
 * cannot carry free text, so a visitor who typed here arrived at an empty box.
 *
 * ## What a sign-in does to this form, and why it is still one line
 *
 * On a deployment with accounts the button leads to a door, and a zero-friction
 * hook that drops the sentence at that door is worse than no hook — it makes
 * somebody type the same thing twice and blames them for it. So the topic
 * survives the round trip four different ways: `/studio` renders the wall in
 * place rather than redirecting, so the query stays in the URL bar; the wall's
 * buttons carry `redirect_url` back to that exact address; the wall shows the
 * sentence back so it is visibly held rather than merely probably held; and it
 * stashes it in `sessionStorage` for the sign-up that finishes in the tab an
 * email client opened. None of that changes anything here — this is still a
 * plain GET form, and that is the point: the handoff is a URL, and a URL is the
 * one thing every one of those paths can carry.
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
              {/* Said here rather than only in the hero, because this is the box
                  somebody is typing into and the door is one click away. It
                  doubles as the promise the wall then keeps. */}
              {signInRequired ? ' Signing in comes next, and your sentence comes with you.' : ''}
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
