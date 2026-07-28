import type { Metadata } from 'next';

import {
  ClosingCta,
  CostComparison,
  Faq,
  Features,
  Hero,
  HowItWorks,
} from '@/components/marketing';

/**
 * The landing page.
 *
 * Order is an argument, not a template: show the thing drawing itself, explain
 * the pipeline that produced it, name the properties that make it better,
 * then — and only then — talk about money. A visitor who has already watched the
 * board build up reads the cost table as a consequence rather than a claim.
 *
 * One `<h1>`, in the hero. Every section below it opens with an `<h2>` and uses
 * `<h3>` inside; nothing skips a level.
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
      <HowItWorks />
      <Features />
      <CostComparison />
      <Faq />
      <ClosingCta />
    </>
  );
}
