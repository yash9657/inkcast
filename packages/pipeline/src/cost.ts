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
 *  - No provider gives us a per-request invoice, so we never claim to have one.
 */

import { totalDuration, type Storyboard } from '@inkcast/core';
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
  /** ElevenLabs Creator tier: ~$22 per 100,000 characters => $0.00022/char. */
  elevenlabsPerChar: 0.00022,
  /** FLUX-class text-to-image on Replicate/fal: ~$0.003 per 1024px image. */
  imagePerAsset: 0.003,
} as const;

/** Rough but stable tokens-per-character for English prose and JSON. */
const CHARS_PER_TOKEN = 4;

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
  /** Characters of storyboard JSON the planner produced. */
  storyboardChars: number;
  /** Characters of narration synthesised this run (0 when all cached). */
  narratedChars: number;
  /** Assets synthesised by a cloud image model this run. */
  generatedAssets: number;
};

export function costOf(sb: Storyboard, input: CostInputs): CostReport {
  const lines: CostLine[] = [];
  const { planner, voice, images } = input.providers;

  if (planner.cloud) {
    const model = planner.model ?? 'claude-opus-5';
    const price = PRICES.anthropic[model] ?? { in: 5, out: 25 };
    // The planner also sends a system prompt and the JSON schema; ~2k tokens.
    const inTok = input.sourceChars / CHARS_PER_TOKEN + 2000;
    const outTok = input.storyboardChars / CHARS_PER_TOKEN;
    const usd = (inTok / 1e6) * price.in + (outTok / 1e6) * price.out;
    lines.push({
      stage: 'plan',
      provider: `${planner.name}/${model}`,
      usd,
      basis: `~${Math.round(inTok)} in + ~${Math.round(outTok)} out tokens at $${price.in}/$${price.out} per MTok`,
      estimated: true,
    });
  }

  if (voice.cloud && input.narratedChars > 0) {
    lines.push({
      stage: 'voice',
      provider: `${voice.name}${voice.model ? `/${voice.model}` : ''}`,
      usd: input.narratedChars * PRICES.elevenlabsPerChar,
      basis: `${input.narratedChars} characters at $${PRICES.elevenlabsPerChar}/char (Creator list price)`,
      estimated: true,
    });
  }

  if (images.cloud && input.generatedAssets > 0) {
    lines.push({
      stage: 'visuals',
      provider: images.name,
      usd: input.generatedAssets * PRICES.imagePerAsset,
      basis: `${input.generatedAssets} images at $${PRICES.imagePerAsset} each`,
      estimated: true,
    });
  }

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
