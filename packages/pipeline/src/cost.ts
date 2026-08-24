/**
 * What a run actually cost.
 *
 * Honesty rules for this file:
 *  - A fully local run is **exactly $0.00**, not "about zero". Nothing left the
 *    machine, so there is nothing to estimate.
 *  - A cloud-assisted run is priced from *observed quantities* (characters sent
 *    to the planner, characters narrated, images actually generated) multiplied
 *    by published list prices. Token counts are derived from character counts,
 *    so those lines are flagged `estimated: true` and the CLI says so.
 *  - **Except where the provider counted for us.** A `ModelSpend` carries the token
 *    counts the Messages API itself returned, so a line built from one is priced from
 *    a real quantity and is not flagged estimated (plan item 3.5; audit X-c). This is
 *    still not an invoice — see below — it is the provider's own accounting of a call
 *    we made, at its published rate.
 *  - No provider gives us a per-request invoice, so we never claim to have one.
 *
 * ## What used to be free by construction
 *
 * Every quantity above except the last is one the pipeline can see from *outside* a
 * stage. That is why the drawing lane cost nothing for as long as it existed: it
 * composes a picture per beat and the critic looks at each one again — five to ten
 * pictures a video, two Opus calls each, plus a generated raster per underlay — and
 * none of it changed the storyboard's byte count, the narration's characters, or the
 * asset count the visuals stage reports. The cheapest lane in the report was the
 * expensive half of the run.
 */

import { totalDuration, type ModelSpend, type Storyboard } from '@inkcast/core';
import type { Providers } from './providers.js';

/** List prices in USD, recorded 2026-07. Sources noted per entry. */
const PRICES = {
  /** Anthropic published per-MTok pricing (docs/research/tech-stack.md §9). */
  anthropic: {
    'claude-opus-5': { in: 5, out: 25 },
    'claude-opus-4-8': { in: 5, out: 25 },
    'claude-sonnet-5': { in: 3, out: 15 },
    'claude-sonnet-4-6': { in: 3, out: 15 },
    'claude-haiku-4-5': { in: 1, out: 5 },
  } as Record<string, { in: number; out: number }>,
  /** ElevenLabs Creator tier: ~$22 per 100,000 credits => $0.00022/credit. */
  elevenlabsPerCredit: 0.00022,
  /** FLUX-class text-to-image on Replicate/fal: ~$0.003 per 1024px image. */
  imagePerAsset: 0.003,
} as const;

/** Rough but stable tokens-per-character for English prose and JSON. */
const CHARS_PER_TOKEN = 4;

/**
 * Credits ElevenLabs bills per character, by engine.
 *
 * The bill is not a rate per character — it is a rate per *credit*, and how many
 * credits a character costs is a property of the model. `eleven_flash_v2_5` and
 * `eleven_turbo_v2_5` bill half a credit, which is the whole of why the voice line
 * halves when the adapter switches to flash.
 */
const ELEVENLABS_CREDITS_PER_CHAR: Record<string, number> = {
  eleven_multilingual_v2: 1,
  eleven_turbo_v2_5: 0.5,
  eleven_flash_v2_5: 0.5,
};

/**
 * A model this table has not heard of is billed at the full rate.
 *
 * The wrong direction to fail is the cheap one: a pricing table that silently
 * discounts what it does not recognise under-states a real bill and nobody finds out
 * until the invoice arrives.
 */
function creditsPerChar(model: string | undefined): number {
  return (model === undefined ? undefined : ELEVENLABS_CREDITS_PER_CHAR[model]) ?? 1;
}

export type CostLine = {
  stage: string;
  provider: string;
  usd: number;
  /** What the number was computed from, shown verbatim in `--json` output. */
  basis: string;
  estimated: boolean;
};

export type CostReport = {
  usd: number;
  /** USD per finished minute of video, or 0 for a free run. */
  perMinuteUsd: number;
  /** True when nothing billable happened. */
  local: boolean;
  /** True when at least one line is derived rather than measured. */
  estimated: boolean;
  lines: CostLine[];
};

export type CostInputs = {
  providers: Providers;
  /** Characters of source text handed to the planner. */
  sourceChars: number;
  /** Characters of storyboard JSON produced. Used only when `lessonChars` is absent. */
  storyboardChars: number;
  /**
   * Characters of lesson JSON the model produced.
   *
   * This is the honest output measure now: the model writes a `Lesson`, and the
   * storyboard is compiled from it locally. Charging for storyboard bytes would
   * over-state the bill by whatever the compiler added.
   */
  lessonChars?: number;
  /** Characters of narration synthesised this run (0 when all cached). */
  narratedChars: number;
  /**
   * Did the lesson stage actually reach the model **this run**?
   *
   * The voice line has had `narratedChars > 0` under it since `b829d98`; the lesson
   * line had nothing, and the difference is measurable on disk.
   * `projects/cardiac/pipeline.json` lists `lesson` in its own `skipped` array and
   * books `$0.2567` against `anthropic/claude-opus-5` in the same file — 41% of that
   * project's recorded `$0.627` for a request that was never sent, because the cached
   * lesson was still 9,868 characters long when it was priced. A zero-network
   * `rerender` is the same defect with the numbers rounded down: no source, no lesson,
   * `~2000 in` tokens of imagined system prompt, `cost.usd = 0.01`.
   *
   * `false` is a statement that the stage did no work, and it wins over every other
   * input. Absent means "not stated", and then the character guard below decides —
   * so an older caller that cannot answer the question still cannot be billed for
   * producing nothing.
   */
  lessonAuthored?: boolean;
  /**
   * Billable calls the stages reported making, one entry per call (plan 3.5).
   *
   * Summed per lane and per model below, so a film that drew nine pictures gets one
   * `drawing` line rather than nine — the useful question is what the lane cost, and
   * per-call detail belongs in a log.
   */
  spend?: readonly ModelSpend[];
};

export function costOf(sb: Storyboard, input: CostInputs): CostReport {
  const lines: CostLine[] = [];
  const { planner, voice } = input.providers;

  // The same rule as the voice line, one field over: a stage that did not run may not
  // be billed, whatever the provider block says. Two guards, because the two ways this
  // failed on disk are genuinely different. `lessonAuthored: false` is the caller
  // stating that the stage was skipped — the `projects/cardiac` case, where the cached
  // lesson is real text and its length is no evidence at all that anybody paid for it.
  // Zero authored characters is the defensive floor under a caller that says nothing —
  // the `rerender()` case, which passes `sourceChars: 0`, `storyboardChars: 0` and no
  // lesson, and was charged a cent for the system prompt it never sent.
  const authoredChars = input.lessonChars ?? input.storyboardChars;
  const lessonRan = input.lessonAuthored !== false && authoredChars > 0;
  if (planner.cloud && lessonRan) {
    const model = planner.model ?? 'claude-opus-5';
    const price = PRICES.anthropic[model] ?? { in: 5, out: 25 };
    // The planner also sends a system prompt and the JSON schema; ~2k tokens.
    const inTok = input.sourceChars / CHARS_PER_TOKEN + 2000;
    const outTok = authoredChars / CHARS_PER_TOKEN;
    const usd = (inTok / 1e6) * price.in + (outTok / 1e6) * price.out;
    lines.push({
      // The lesson stage is where the model actually runs; the storyboard stage
      // downstream of it is local arithmetic and costs nothing.
      stage: 'lesson',
      provider: `${planner.name}/${model}`,
      usd,
      basis: `~${Math.round(inTok)} in + ~${Math.round(outTok)} out tokens at $${price.in}/$${price.out} per MTok`,
      estimated: true,
    });
  }

  // `voice.cloud` must describe the provider that *spoke* — see `resolvedVoiceChoice`,
  // which reconstructs how `projects/cardiac8` came to book $0.4286 for 1,948
  // characters that ElevenLabs demoted out of on its first request. The guard is the
  // defensive floor under that: a run that synthesised nothing cannot emit a line at
  // all, whatever the provider block says.
  if (voice.cloud && input.narratedChars > 0) {
    const credits = creditsPerChar(voice.model);
    lines.push({
      stage: 'voice',
      provider: `${voice.name}${voice.model ? `/${voice.model}` : ''}`,
      usd: input.narratedChars * credits * PRICES.elevenlabsPerCredit,
      basis: `${input.narratedChars} characters × ${credits} credits/char at $${PRICES.elevenlabsPerCredit}/credit (Creator list price)`,
      estimated: true,
    });
  }

  // The lanes that report their own calls. Grouped by (lane, model) rather than by
  // lane alone: a run that switched `INKCAST_DRAW_MODEL` half way through was billed at
  // two rates and the report should say so rather than average them.
  const grouped = new Map<
    string,
    { spend: ModelSpend; inTok: number; outTok: number; images: number; calls: number }
  >();
  for (const s of input.spend ?? []) {
    const key = `${s.lane}::${s.provider}::${s.model ?? ''}`;
    const at = grouped.get(key) ?? { spend: s, inTok: 0, outTok: 0, images: 0, calls: 0 };
    at.inTok += s.inTokens ?? 0;
    at.outTok += s.outTokens ?? 0;
    at.images += s.images ?? 0;
    at.calls += 1;
    grouped.set(key, at);
  }
  for (const g of grouped.values()) {
    const { lane, provider, model } = g.spend;
    if (g.images > 0) {
      lines.push({
        stage: lane,
        provider,
        usd: g.images * PRICES.imagePerAsset,
        basis: `${g.images} image${g.images === 1 ? '' : 's'} generated at $${PRICES.imagePerAsset} each`,
        // The count is exact — cache hits are not counted — but the per-image price is
        // a list rate for a class of model, not this model's invoice.
        estimated: true,
      });
      continue;
    }
    if (g.inTok === 0 && g.outTok === 0) continue;
    const price = PRICES.anthropic[model ?? ''] ?? { in: 5, out: 25 };
    lines.push({
      stage: lane,
      provider: `${provider}${model ? `/${model}` : ''}`,
      usd: (g.inTok / 1e6) * price.in + (g.outTok / 1e6) * price.out,
      basis:
        `${g.calls} call${g.calls === 1 ? '' : 's'}, ${g.inTok} in + ${g.outTok} out tokens ` +
        `as reported by the API, at $${price.in}/$${price.out} per MTok`,
      // Not an estimate: the provider counted these tokens, we did not divide characters
      // by four to guess them.
      estimated: false,
    });
  }

  // There is no image line built from the board any more, and its absence is the point.
  // `generatedAssets` counted every asset the manifest marked `generated` — which is a
  // statement about where a picture came from *originally*, and stays true on every later
  // run that serves it from a cache. `projects/qc64-hashmap` is the measurement: four such
  // assets, zero provider calls, the machine cache unchanged at 42 files afterwards, and
  // `visuals fal $0.0120` on the report. The two raster lanes now report their own calls
  // through `spend` above, exactly as the drawing author and the underlay already did, and
  // `images.cloud` is not evidence that anything was drawn.
  const usd = round4(lines.reduce((a, l) => a + l.usd, 0));
  const minutes = totalDuration(sb) / 60;
  return {
    usd,
    perMinuteUsd: minutes > 0 ? round4(usd / minutes) : 0,
    local: lines.length === 0,
    estimated: lines.some((l) => l.estimated),
    lines: lines.map((l) => ({ ...l, usd: round4(l.usd) })),
  };
}

export function emptyCost(): CostReport {
  return { usd: 0, perMinuteUsd: 0, local: true, estimated: false, lines: [] };
}

/** `$0.00` for free runs, `~$0.0123` for estimated ones. */
export function formatCost(c: CostReport): string {
  if (c.local) return '$0.00';
  const digits = c.usd > 0 && c.usd < 0.01 ? 4 : 2;
  return `${c.estimated ? '~' : ''}$${c.usd.toFixed(digits)}`;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
