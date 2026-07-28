import Link from 'next/link';
import { ArrowRightIcon } from 'lucide-react';

import { Button, GithubIcon, InkBoard } from '@/components/ui';

import { CommandSnippet } from './command-snippet';
import { Reveal } from './reveal';
import { COST_LOCAL, repoUrl, STUDIO_HREF } from './site-config';

/**
 * The last thing on the page: the two ways in, and nothing else.
 *
 * `InkBoard`'s dot grid sits behind it — the one decorative surface on the page
 * that quotes the canvas, masked at the bottom so it reads as continuing rather
 * than as a panel with an edge.
 */
export function ClosingCta() {
  return (
    <section
      className="relative border-t border-border py-20 sm:py-24"
      aria-labelledby="closing-heading"
    >
      <InkBoard className="mask-fade-b pointer-events-none absolute inset-0 -z-10 opacity-60" />

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 id="closing-heading" className="font-display text-5xl text-balance">
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
