import Link from 'next/link';
import { ArrowRightIcon } from 'lucide-react';

import { Badge, Button, InkUnderline } from '@/components/ui';

import { CommandSnippet } from './command-snippet';
import { InkDemo } from './ink-demo';
import { Reveal } from './reveal';
import { COST_LOCAL, LICENCE, STUDIO_HREF } from './site-config';

/**
 * The hero.
 *
 * The headline states the mechanism, not the magic (DESIGN.md §9): it says
 * *draws*, because a hand-drawn stroke is what actually comes out. One
 * `InkUnderline`, on the one word that carries the claim — the page's single
 * flourish, per DESIGN.md §7.
 *
 * The row of chips under the CTAs is deliberately made of checkable facts —
 * a licence, a dependency, a number from `docs/CONTRACT.md`. There are no logos,
 * no star ratings and no user counts on this page, because we would have to
 * invent them.
 */
export function Hero() {
  return (
    <section className="surface-grain relative">
      <div className="mx-auto w-full max-w-6xl px-4 pt-16 pb-20 sm:px-6 sm:pt-24 sm:pb-24">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <Badge variant="outline" className="mb-6">
              Open source · {LICENCE} · no API keys
            </Badge>
          </Reveal>

          <Reveal index={1}>
            {/* The one `text-6xl`+ heading on the site. `font-display` is only
                legal at this size (DESIGN.md §3). */}
            <h1 className="font-display text-5xl text-balance sm:text-6xl lg:text-7xl">
              <InkUnderline tone="primary" seed="draw">
                Draw
              </InkUnderline>{' '}
              an explainer from anything you have written.
            </h1>
          </Reveal>

          <Reveal index={2}>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
              Hand it a document or a prompt. It plans a storyboard, writes on one growing canvas
              stroke by stroke, narrates the whole thing out loud, and hands back an mp4. The
              default path runs entirely on your own machine for {COST_LOCAL}.
            </p>
          </Reveal>

          <Reveal index={3}>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="w-full sm:w-auto" render={<Link href={STUDIO_HREF} />}>
                Open studio
                <ArrowRightIcon aria-hidden />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto"
                render={<a href="#how-it-works" />}
              >
                See the pipeline
              </Button>
            </div>
          </Reveal>

          <Reveal index={4}>
            <div className="mt-6 flex justify-center">
              <CommandSnippet command="pnpm cast examples/gradient-descent.md" />
            </div>
          </Reveal>
        </div>

        <Reveal index={5} className="mt-16 sm:mt-20">
          <InkDemo />
        </Reveal>
      </div>
    </section>
  );
}
