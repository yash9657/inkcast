import type { Metadata } from 'next';

import {
  ClosingCta,
  CostComparison,
  Faq,
  Features,
  FormatRow,
  Hero,
  HowItWorks,
  TryStrip,
} from '@/components/marketing';

/**
 * The landing page.
 *
 * ## The order is an argument
 *
 * `PLAN-LAUNCH.md` C5 fixes it, and every position in it is doing work:
 *
 * 1. **Hero** — the claim, next to a board drawing itself. Show before tell.
 * 2. **Try strip** — one box, straight into the studio. It sits *second*, above
 *    every explanation, because the cheapest thing a convinced visitor can do is
 *    type six words, and making them scroll past five sections to find the box is
 *    how a landing page loses the person it already persuaded.
 * 3. **Format row** — the proof that the thing has three shapes, one per feed.
 * 4. **How it works** — the five real stages, with their real signatures.
 * 5. **Features** — the properties that fall out of the storyboard IR.
 * 6. **Cost** — money last, on purpose: a visitor who has watched the board build
 *    up reads the table as a consequence rather than as a claim.
 * 7. **FAQ**, then the closing CTA.
 *
 * ## Why `Features` is still here when C5 does not list it
 *
 * The plan's seven-item structure names Hero, try strip, format row, how it
 * works, cost, FAQ and the closing block. `Features` is not in that list, and it
 * survives anyway because the plan is a structure for the page, not a licence to
 * delete its content: those six cards are the only place on the site that states
 * the properties competitors cannot copy without rebuilding the IR
 * (`persist: true`, `assets[].seed`, `enter.style: 'write'`). Cutting them to
 * match an outline literally would trade an argument for a shorter page. It goes
 * between "how" and "cost" because it answers the question the pipeline diagram
 * raises — *so what does that buy me* — immediately before the price.
 *
 * One `<h1>`, in the hero. Every section below it opens with an `<h2>` and uses
 * `<h3>` inside; nothing skips a level. Three of them are anchor targets the nav
 * points at (`#how-it-works`, `#examples`, `#faq`) and each of those ids lives on
 * the section element itself with `scroll-mt-16`, so an anchor jump does not park
 * the heading under the sticky header.
 */
export const metadata: Metadata = {
  // The root layout's title template appends "· Inkcast"; the landing page is
  // the one place that would read badly, so it declares an absolute title.
  title: {
    absolute: 'Inkcast — draw an explainer from anything you have written',
  },
};

export default function MarketingPage() {
  return (
    <>
      <Hero />
      <TryStrip />
      <FormatRow />
      <HowItWorks />
      <Features />
      <CostComparison />
      <Faq />
      <ClosingCta />
    </>
  );
}
