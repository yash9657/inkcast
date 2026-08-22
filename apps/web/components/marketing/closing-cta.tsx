import Link from 'next/link';
import { ArrowRightIcon } from 'lucide-react';

import { Button, GithubIcon } from '@/components/ui';

import { CommandSnippet } from './command-snippet';
import { Reveal } from './reveal';
import { COST_LOCAL, repoUrl, STUDIO_HREF } from './site-config';

/**
 * The last thing on the page: the two ways in, and nothing else.
 *
 * ## It is a block now, and that is the point
 *
 * `PLAN-LAUNCH.md` C5 item 7 asks for "a closing CTA block with `--shadow-pop`",
 * and this is the second and last accent plane on the page — the hero's ink-demo
 * frame is the first. DESIGN.md §5 caps `shadow-pop` at twice per screen, not per
 * page, and these two are separated by the entire document, so the page never
 * shows more than one of them plus a primary button at a time. The 1px ink border
 * is not decoration under that shadow: §5 again — a hard offset shadow on an
 * element with no border looks like a rendering bug, because the shadow is the
 * offset plane and the border is its edge.
 *
 * ## What was here before, and why it went
 *
 * An `InkBoard` at 60% opacity, absolutely positioned behind the section and
 * masked at the bottom. It has to go, and the reason is a token value rather than
 * taste: `InkBoard` paints its dots from `--color-border`, which the C1 swap made
 * *ink* (docs/DESIGN.md §11 — 39 call sites, one global rule). A 16px grid of
 * near-black dots at 60% is not a texture, it is a screen tone, and it sat at a
 * different pitch from the 24px grid the page paints on `body` — two grids out of
 * phase, one of them ten times too dark. The replacement is nothing at all: the
 * section is transparent, the body grid shows through, and the block sits on the
 * same sheet as everything above it. The `dot-grid` utility exists for a surface
 * that needs to repaint the grid over its own background, and this one does not,
 * because the card is where the grid is supposed to stop.
 */
export function ClosingCta() {
  return (
    <section className="border-t border-border py-20 sm:py-24" aria-labelledby="closing-heading">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        {/* No gutter is reserved for the shadow, and that is checked rather than
            assumed. A `10px 10px 0` plane is painted outside the border box and
            does not participate in layout, so it can be clipped by the viewport.
            It is not: below 704px the block is width-constrained by the
            container's own `px-4`, which leaves exactly 16px to the right of it,
            and above 704px `max-w-2xl` (672px) centres inside a container that is
            wider still. 16px > 10px at the tightest point, so the plane is always
            on paper. `py-20` covers the vertical side with 80px. */}
        <Reveal className="mx-auto max-w-2xl border border-border bg-card p-8 text-center shadow-pop sm:p-12">
          <h2 id="closing-heading" className="text-4xl text-balance sm:text-5xl">
            Draw the first one in the next ten minutes.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
            Point it at a document you already have. No account, no key, {COST_LOCAL} — and the
            storyboard it produces is yours to edit line by line.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" className="w-full sm:w-auto" render={<Link href={STUDIO_HREF} />}>
              Open studio
              <ArrowRightIcon aria-hidden />
            </Button>
            {repoUrl ? (
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto"
                render={<a href={repoUrl} target="_blank" rel="noreferrer noopener" />}
              >
                <GithubIcon aria-hidden />
                Read the source
              </Button>
            ) : null}
          </div>

          <div className="mt-8 flex justify-center">
            <CommandSnippet command="pnpm cast examples/gradient-descent.md" />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
