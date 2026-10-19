import { Easing, interpolate, spring } from 'remotion';

import data from './words.json';

/** docs/DESIGN.md tokens: ink, paper, highlighter (light theme). The whiteboard keeps its paper palette. */
export const C = {
  paper: 'oklch(0.988 0.003 85)',
  background: 'oklch(0.982 0.005 90)',
  card: 'oklch(0.993 0.003 90)',
  muted: 'oklch(0.963 0.007 88)',
  mutedFg: 'oklch(0.46 0.016 260)',
  border: 'oklch(0.885 0.009 88)',
  dot: 'oklch(0.86 0.006 88)',
  fg: 'oklch(0.215 0.022 260)',
  primary: 'oklch(0.215 0.022 260)',
  onPrimary: 'oklch(0.993 0.003 90)',
  night: 'oklch(0.17 0.016 262)',
  highlighter: 'oklch(0.925 0.155 100)',
  highlighterSoft: 'oklch(0.965 0.045 100)',
  canvas: 'oklch(0.965 0.045 100)',
  canvasInk: 'oklch(0.215 0.022 260)',
  sky: 'oklch(0.955 0.025 250)',
  skyInk: 'oklch(0.33 0.08 255)',
  rose: 'oklch(0.95 0.025 22)',
  roseInk: 'oklch(0.38 0.1 22)',
  shadow: 'oklch(0.2 0.02 260 / 0.16)',
  ink: 'oklch(0.2535 0.024 256)',
  blue: 'oklch(0.55 0.16 250)',
  red: 'oklch(0.575 0.19 22)',
  green: 'oklch(0.545 0.13 152)',
  amber: 'oklch(0.665 0.14 72)',
  violet: 'oklch(0.55 0.19 292)',
} as const;

export const HAND = '"Shantell Sans", cursive';
export const DISPLAY = '"Newsreader", Georgia, serif';
export const BODY = 'Inter, system-ui, sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, monospace';

export const FPS = 30;
export const W = 1920;
export const H = 1080;
export const s = (seconds: number): number => Math.round(seconds * FPS);

export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

/** 0..1 between two times in seconds (frame-based), clamped. */
export function ramp(f: number, from: number, to: number, easing = easeOut): number {
  return interpolate(f, [s(from), s(to)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  });
}

export const pop = (f: number, at: number, damping = 13): number =>
  spring({ frame: f - s(at), fps: FPS, config: { damping, mass: 0.6, stiffness: 170 } });

export interface Word {
  readonly w: string;
  readonly line: string;
  readonly at: number;
  readonly end: number;
}
export const WORDS: readonly Word[] = data.words;
export const LINES = data.lines;

/** Film time (s) of the n-th occurrence of a spoken word. */
export function word(w: string, nth = 0): number {
  const hits = WORDS.filter((x) => x.w.toLowerCase() === w.toLowerCase());
  const hit = hits[nth];
  if (!hit) throw new Error(`narration has no "${w}" #${nth}`);
  return hit.at;
}

export const TOTAL = 40.5;

/** Deterministic jitter for hand-drawn geometry. */
export function rand(seed: number): () => number {
  let x = seed * 9301 + 49297;
  return () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
}
