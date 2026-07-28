import * as React from 'react';

import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

import { Reveal } from './reveal';
import { CodeChip, Section, SectionHeading } from './section';
import {
  COST_CLOUD,
  COST_CLOUD_TILE,
  COST_LOCAL,
  HOSTED_CHEAPEST_LENGTH,
  HOSTED_COLOUR_FROM,
  HOSTED_FRAME_EDIT_FROM,
  HOSTED_MONTHLY,
  HOSTED_PER_MINUTE,
  HOSTED_PER_MINUTE_TILE,
  PRICING_AS_OF,
} from './site-config';

/**
 * The cost section.
 *
 * Rules this section is written under, because a comparison table is the easiest
 * place on a marketing site to start lying:
 *
 * - **No vendor is named.** The right-hand column is a category — "hosted
 *   per-minute generators" — and every figure in it is public list pricing,
 *   recorded in `docs/research/golpo-ux.md` on 2026-07-28. There is no
 *   editorialising about the companies behind those prices.
 * - **Every number is one of the verified figures** in `site-config.ts`. Nothing
 *   is extrapolated, averaged, or dressed up as a saving. There is no "save 97%"
 *   line, because the honest statement is just the two numbers side by side.
 * - **Our own number is a marginal cost, and it says so.** $0.20 is what the
 *   providers charge for a minute of output when you opt into them; it is not a
 *   subscription, and it does not pretend electricity is free — it is the bill
 *   somebody else sends you.
 */

type Row = {
  label: string;
  hosted: React.ReactNode;
  inkcast: React.ReactNode;
};

const ROWS: Row[] = [
  {
    label: 'Marginal cost per finished minute',
    hosted: <span className="tabular">{HOSTED_PER_MINUTE}</span>,
    inkcast: (
      <span className="tabular">
        {COST_LOCAL} local · {COST_CLOUD} with cloud adapters
      </span>
    ),
  },
  {
    label: 'Monthly subscription to get started',
    hosted: <span className="tabular">{HOSTED_MONTHLY}</span>,
    inkcast: 'None. Clone the repository.',
  },
  {
    label: 'Colour output',
    hosted: <>Typically from {HOSTED_COLOUR_FROM}</>,
    inkcast: (
      <>
        Default. <CodeChip>meta.palette</CodeChip>
      </>
    ),
  },
  {
    label: 'Editing after a render',
    hosted: <>Prompt-level frame editing from {HOSTED_FRAME_EDIT_FROM}</>,
    inkcast: (
      <>
        Edit <CodeChip>storyboard.json</CodeChip> and re-render the scenes that changed
      </>
    ),
  },
  {
    label: 'Length on the cheapest paid tier',
    hosted: <>{HOSTED_CHEAPEST_LENGTH}</>,
    inkcast: 'As long as the document needs',
  },
  {
    label: 'Works with no account and no API key',
    hosted: 'No — generation is server-side and gated',
    inkcast: 'Yes — that is the default path',
  },
  {
    label: 'Source available',
    hosted: 'No',
    inkcast: 'Yes, AGPL-3.0-only',
  },
];

/** A headline number. `tabular` because these are figures, per DESIGN.md §3. */
function CostTile({
  value,
  spoken,
  label,
  note,
  emphasis,
}: {
  value: string;
  /** What a screen reader should say, when the glyph form would not read well. */
  spoken?: string;
  label: string;
  note: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        'h-full rounded-xl border p-6',
        emphasis ? 'border-primary/30 bg-primary/8' : 'border-border bg-card',
      )}
    >
      <p
        className={cn(
          'tabular font-display text-5xl',
          emphasis ? 'text-primary' : 'text-foreground',
        )}
      >
        {spoken ? (
          <>
            <span aria-hidden>{value}</span>
            <span className="sr-only">{spoken}</span>
          </>
        ) : (
          value
        )}
      </p>
      <p className="mt-3 text-md font-medium">{label}</p>
      <p className="mt-1 text-sm text-muted-foreground">{note}</p>
    </div>
  );
}

export function CostComparison() {
  return (
    <Section id="cost" aria-labelledby="cost-heading">
      <SectionHeading
        eyebrow="Cost"
        headingId="cost-heading"
        title="What a finished minute actually costs"
        lead={
          <>
            Hosted whiteboard-video tools price per finished minute on top of a monthly plan.
            Inkcast is a compiler you run, so the only bill is the compute you choose to buy.
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Reveal index={0}>
          <CostTile
            value={COST_LOCAL}
            label="Per minute, fully local"
            note="Deterministic planner, Kokoro narration, built-in artwork. No key, no network."
            emphasis
          />
        </Reveal>
        <Reveal index={1}>
          <CostTile
            value={COST_CLOUD_TILE}
            spoken={`${COST_CLOUD} per finished minute`}
            label="Per minute, with cloud adapters"
            note="What the providers charge when you opt into model planning, hosted voice or generated artwork."
          />
        </Reveal>
        <Reveal index={2}>
          <CostTile
            value={HOSTED_PER_MINUTE_TILE}
            spoken={`${HOSTED_PER_MINUTE} per finished minute`}
            label="Per minute, hosted tools"
            note={`Public list pricing for hosted whiteboard-video generators, ${PRICING_AS_OF}.`}
          />
        </Reveal>
      </div>

      <Reveal index={3} className="mt-10">
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Inkcast compared with hosted whiteboard-video generators on cost, gating and
              licensing.
            </caption>
            <thead>
              <tr className="border-b border-border">
                <th
                  scope="col"
                  className="px-3 py-3 text-2xs uppercase sm:px-4 text-muted-foreground"
                >
                  <span className="sr-only">Comparison</span>
                </th>
                <th
                  scope="col"
                  className="px-3 py-3 align-bottom sm:px-4 text-sm font-medium text-muted-foreground"
                >
                  Hosted per-minute tools
                </th>
                <th scope="col" className="px-3 py-3 align-bottom sm:px-4 text-sm font-medium">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    Inkcast
                    <Badge variant="default">Free</Badge>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label} className="border-b border-border last:border-b-0">
                  <th
                    scope="row"
                    className="px-3 py-4 align-top sm:px-4 text-sm font-medium text-muted-foreground"
                  >
                    {row.label}
                  </th>
                  <td className="px-3 py-4 align-top sm:px-4 text-sm text-muted-foreground">
                    {row.hosted}
                  </td>
                  <td className="px-3 py-4 align-top sm:px-4 text-sm text-foreground">
                    {row.inkcast}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      <Reveal index={4}>
        <p className="mt-6 max-w-3xl text-sm text-muted-foreground">
          Figures in the middle column are public list prices for hosted whiteboard-video
          generators, recorded {PRICING_AS_OF}; no vendor is singled out and none of them are
          paraphrased into a claim they did not make. Our per-minute figure is marginal provider
          cost, not a subscription — and the fully local path has no provider, which is the whole
          reason it is {COST_LOCAL}.
        </p>
      </Reveal>
    </Section>
  );
}
