import Link from 'next/link';
import { ArrowRightIcon } from 'lucide-react';

import { Badge, Button, InkUnderline } from '@/components/ui';

import { InkDemo } from './ink-demo';
import { Reveal } from './reveal';
import { COST_LOCAL, LICENCE, signInRequired, STUDIO_HREF } from './site-config';

/**
 * The hero.
 *
 * The headline states the mechanism, not the magic (DESIGN.md §9): it says
 * *drawn*, because a hand-drawn stroke is what actually comes out, and it says
 * *watch* because the board next to it is doing exactly that while you read.
 * One `InkUnderline`, on the one word that carries the claim — the page's single
 * flourish, per DESIGN.md §7.
 *
 * ## Two columns, and which one is load-bearing
 *
 * Left is the argument, right is the proof, and the proof is the better half:
 * `ink-demo.tsx` draws a real board with real strokes in the browser, from
 * seeded geometry and CSS animation, with no video file and no drawing library.
 * It gets the wider column and the one accent-coloured shadow on the page,
 * because a visitor who watches it does not need the paragraph.
 *
 * ## No background of its own
 *
 * The dot grid is painted on `body` by the base layer, so the hero is
 * *transparent* and the grid shows through. This section used to carry a
 * `surface-grain` class; that utility was deleted in the C1 token swap and the
 * class had been silently doing nothing (docs/DESIGN.md §11). The lesson is the
 * repo's own: a class that no longer resolves does not fail, it just stops
 * mattering — so the fix is to delete it rather than to replace it with a
 * gradient that would fight the grid.
 *
 * The chips under the CTAs are deliberately made of checkable facts — a licence,
 * a number from `docs/CONTRACT.md`. There are no logos, no star ratings and no
 * user counts on this page, because we would have to invent them.
 *
 * ## The two claims that moved when the hosted site grew a gate
 *
 * The pill used to end "no API keys" and the line under the buttons used to open
 * "No account, no key." Both were true of every deployment that existed when
 * they were written, and both became false about *this* page the day generating
 * on the hosted site started asking for a sign-in. `site-config.ts` rule 1 does
 * not permit a claim that is false of the page it is printed on, so they are
 * routed through `signInRequired` and each deployment prints the sentence that
 * is true of it. Nothing is softened for the self-hoster: their pill and their
 * line are byte-for-byte the ones that shipped. What the hosted variant does not
 * do is hide the gate in the small print — it is the first thing under the two
 * buttons that lead to it, because a visitor who finds out at the door was
 * misled, however cheerfully.
 */
export function Hero() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto w-full max-w-6xl px-4 pt-12 pb-16 sm:px-6 sm:pt-20 sm:pb-24">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14">
          <div className="min-w-0">
            <Reveal>
              <Badge variant="outline" className="mb-6 font-mono">
                Open source · {LICENCE} · {signInRequired ? 'sign in to draw' : 'no API keys'}
              </Badge>
            </Reveal>

            <Reveal index={1}>
              {/* The one `text-7xl` on the site (DESIGN.md §3: one per page,
                  ever), and it only reaches that size at `xl`. It starts at
                  `text-4xl` because 76px of Space Grotesk at 360px would set two
                  words to a line and put the CTA below the fold. */}
              <h1 className="text-4xl text-balance sm:text-5xl lg:text-6xl xl:text-7xl">
                Type a topic. Watch it get{' '}
                <InkUnderline tone="primary" seed="drawn">
                  drawn
                </InkUnderline>
                .
              </h1>
            </Reveal>

            <Reveal index={2}>
              <p className="mt-6 max-w-xl text-lg text-muted-foreground">
                Hand-drawn explainer videos with a voice that actually teaches — any topic, any
                format, free.
              </p>
            </Reveal>

            <Reveal index={3}>
              <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button size="lg" className="w-full sm:w-auto" render={<Link href={STUDIO_HREF} />}>
                  Make one free
                  <ArrowRightIcon aria-hidden />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full sm:w-auto"
                  render={<a href="#how-it-works" />}
                >
                  See how it works
                </Button>
              </div>
            </Reveal>

            <Reveal index={4}>
              <p className="mt-6 font-mono text-xs text-muted-foreground">
                {signInRequired
                  ? `Drawing one here starts with a sign-in. Run it yourself and there is no account, no key, and the local path costs ${COST_LOCAL} a minute.`
                  : `No account, no key. The local path costs ${COST_LOCAL} a minute to run.`}
              </p>
            </Reveal>
          </div>

          <Reveal index={5} className="min-w-0">
            <InkDemo />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
