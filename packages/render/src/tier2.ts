/**
 * Tier 2: the frames get looked at (plan item 3.3; audit S9-b, S9-d MISSING).
 *
 * Everything the gate does in Tier 1 is arithmetic over the IR, and arithmetic over the
 * IR can only ever find the defects somebody thought to compute. The audit's finding was
 * that nothing in this pipeline had ever *looked at a frame* — not one automated check
 * ran against a pixel — and that Golpo's four measured defects are all things you see
 * immediately and compute with difficulty. So this tier samples the film and asks two
 * questions of the pixels themselves:
 *
 *  - **How much ink is on the board?** Free, deterministic, no key. This is the
 *    ungameable half of the fill gate: `contentFill` counts bounding boxes and can be
 *    satisfied by inflating one, and the two measures disagreeing is a signal rather
 *    than noise (plan 2.6's own trap note). Measured with `./ink.ts`, the same
 *    instrument `inkstat.mts` scores a finished film with.
 *  - **What does a model see?** Keyed, and injected rather than imported — see
 *    `VisionPass`. Clipped text, ink written through ink, a region too small to read, a
 *    board that is mostly empty: the spec's four fixed questions, plus reading the text
 *    back so it can be diffed against what the IR says is on the board.
 *
 * ## Why the vision pass is a seam and not a dependency
 *
 * This package owns Chromium and ffmpeg and knows nothing about model providers, and it
 * must stay that way: `@inkcast/render` is what a machine with no keys renders with. So
 * the caller that already has an Anthropic client passes one in, exactly as the pipeline
 * passes `drawPreview` down to the planner (`stages.ts`, `draw-preview.ts`) for the
 * mirror-image reason. No key, no vision pass, and the report says so — a skipped check
 * never reads as a passed one.
 *
 * ## Why the verdicts are advisory
 *
 * For one release, deliberately, as the plan says. A vision model's false-positive rate
 * on hand-drawn boards is unmeasured, and a blocking check whose false positives are
 * unmeasured teaches everyone to pass `--degrade`. The findings land in `qc.json` where
 * they can be counted against what a human sees in the same frames; that measurement is
 * what earns the promotion.
 */
import { logger } from '@inkcast/core';
import type { Browser } from 'playwright';
import { openCapture } from './browser.js';
import { inkShare } from './ink.js';
import type { BoardViolation } from './boardcheck.js';
import type { Rect, RenderPlan } from './types.js';

const log = logger('check:tier2');

/** How many frames to look at. The plan's N≈8: one a beat on a standard film. */
export const SAMPLES = 8;

/**
 * The ink floor, as a share of the frame's pixels.
 *
 * **1% of pixels, and it is the corpus's number, not a taste.** Measured on
 * 2026-08-23 by running this file's own sampler over all 27 boards in `projects/` —
 * which matters, because the moment you look at decides the answer: `inkstat.mts`
 * samples evenly in time and catches beats mid-reveal, and this samples each beat at
 * its fullest.
 *
 * At those moments the corpus falls into two populations with a gap between them:
 *
 * | class                                   | sparsest frame |
 * | --------------------------------------- | -------------- |
 * | the keyed drawing-lane films (cardiac*) | 2.2 – 4.0%     |
 * | the shipped lessons (longitude, GD)     | 1.6 – 2.1%     |
 * | reviewed lesson films (final-*, battery)| 1.2 – 1.6%     |
 * | — the floor sits here —                 | **1.0%**       |
 * | the document route's slideshow boards    | 0.8 – 1.0%     |
 * | 4-scene pipeline smoke-test boards       | 0.8%           |
 *
 * So the floor is not a target anyone has to reach for: it is drawn in the gap between
 * every board that was made to teach and every board that was made to prove the
 * pipeline runs. Same discipline as `MIN_GLYPH_PX` (10px against a shipped 10.9px) and
 * the bbox fill floor, and for the same reason — a threshold from taste fails a shipped
 * film on its first run and is switched off the same day.
 *
 * This is the measure `contentFill` cannot be: boxes can be satisfied by inflating a
 * box, and pixels cannot. Where the two disagree, that disagreement is the finding.
 */
export const MIN_INK_SHARE = 0.01;

/** One sampled moment of the film, with what the IR says is on screen at it. */
export type FrameSample = {
  /** 0-based position in the sample set. */
  index: number;
  /** Seconds into the film. */
  at: number;
  /** The scene this moment belongs to. */
  sceneId: string;
  png: Uint8Array;
  /** Ink share of the frame, 0–1, or `undefined` when the decode failed. */
  ink?: number;
  /** Board text the plan says has finished being written by now. */
  text: string[];
};

/** What a vision pass says about one frame: the spec's four questions, plus the text. */
export type FrameVerdict = {
  /** Which sample this is about. */
  index: number;
  /** A description of text that is cut off or clipped, when there is any. */
  clipped?: string;
  /** A description of ink written through other ink, when there is any. */
  overlap?: string;
  /** A description of a region too small or faint to read, when there is any. */
  illegible?: string;
  /** Why the frame reads as mostly empty, when it does. */
  empty?: string;
  /** Every word of board text the model could read. Used for the OCR diff. */
  read?: string[];
};

/**
 * The keyed half, supplied by the caller. Never throws — a provider failure costs the
 * verdicts, not the run, and an empty array is reported as "the pass did not answer".
 */
export type VisionPass = (frames: readonly FrameSample[]) => Promise<FrameVerdict[]>;

/**
 * The longest a fade can run, from `fadeSpan` in `compile.ts`. Duplicated as a bound
 * rather than imported as a function because what is wanted here is the worst case: the
 * sampler needs a moment before *any* fade has started, and it does not know which item
 * on the board is the one with the longest one.
 */
const MAX_FADE = 0.55;

/**
 * When to look: the fullest each beat's board ever gets.
 *
 * That is where all four of the spec's questions are most answerable — "mostly empty",
 * "written through", "clipped", "too small to read" are all about a finished board — and
 * where the ink measurement means something.
 *
 * **The fade is what decides it, not the scene's end.** On an accumulating board nothing
 * leaves, so the fullest moment is just before the cut. On a *wiping* board every card
 * goes out the instant its narration stops, which is `hold` seconds before the scene
 * ends — so a sample taken before the cut lands in the gap after the wipe, on a blank
 * board. Measured, before this read the fade schedule: `cardiac9` and `cardiac10` — two
 * reviewed wipe-mode films — both reported a sampled frame at **0.00% ink**, which is
 * not a defect in the film, it is a photograph of the space between two cards. Reading
 * `item.fadeAt` (which the compiler sets only where ink really leaves early) is what
 * makes one rule serve both modes.
 *
 * A film with more scenes than samples is sampled evenly across them, so the set always
 * spans the whole film rather than its first eight beats.
 */
export function sampleTimes(plan: RenderPlan, n = SAMPLES): { at: number; sceneId: string }[] {
  const scenes = plan.scenes;
  if (scenes.length === 0) return [];
  const pick: number[] = [];
  if (scenes.length <= n) {
    for (let i = 0; i < scenes.length; i++) pick.push(i);
  } else {
    for (let k = 0; k < n; k++) pick.push(Math.round((k * (scenes.length - 1)) / (n - 1)));
  }
  /** The earliest moment any of a scene's own ink begins to leave. */
  const leaves = new Map<number, number>();
  for (const item of plan.items) {
    if (item.fadeAt === undefined) continue;
    const starts = item.fadeAt - MAX_FADE;
    const known = leaves.get(item.scene);
    if (known === undefined || starts < known) leaves.set(item.scene, starts);
  }
  return pick.map((i) => {
    const s = scenes[i]!;
    const gone = leaves.get(i);
    const latest = gone === undefined ? s.start + s.dur : Math.min(s.start + s.dur, gone);
    // A quarter second inside that: past every reveal, before anything goes.
    const at = Math.max(s.start, Math.min(plan.duration, latest - 0.25));
    return { at, sceneId: s.id };
  });
}

/**
 * The camera's view of the board at `t`, in canvas units.
 *
 * The arithmetic is `seek()`'s in `page/runtime.js`, reproduced rather than shared for the
 * reason everything in this package that mirrors the runtime is: that file runs inside
 * Chromium and this one runs in Node. It is three lines and it is pinned by
 * `check.test.ts` — if the runtime's framing ever moves, this moves with it.
 *
 * Taken from the scene the sample belongs to rather than interpolated across a camera
 * transition, and that is safe by construction: `sampleTimes` looks a quarter-second
 * before a beat's ink starts leaving, which is the far end of the scene, and a transition
 * runs at its near end.
 */
function cameraRect(plan: RenderPlan, t: number): Rect | undefined {
  let scene = plan.scenes[0];
  for (const s of plan.scenes) {
    if (t >= s.start) scene = s;
  }
  if (!scene) return undefined;
  const base = Math.min(plan.frame.w / plan.canvas.w, plan.frame.h / plan.canvas.h);
  const px = base * (scene.camera.zoom > 0 ? scene.camera.zoom : 1);
  if (!(px > 0)) return undefined;
  const w = plan.frame.w / px;
  const h = plan.frame.h / px;
  return { x: scene.camera.x - w / 2, y: scene.camera.y - h / 2, w, h };
}

/** Whether any of `box` is inside `view`. Touching edges do not count as seen. */
function intersects(box: Rect, view: Rect): boolean {
  return (
    box.x < view.x + view.w &&
    box.x + box.w > view.x &&
    box.y < view.y + view.h &&
    box.y + box.h > view.y
  );
}

/**
 * The board text the plan says is fully written by `t` **and framed by the camera**.
 *
 * The camera clause is plan 5.2, and it is the difference between a check and a nuisance.
 * This feeds `ocrDiff`, which asks a model to read a *frame* and then reports every word
 * the board is supposed to carry that the model could not find. On an accumulating board
 * the board is a 4448×2908 canvas and the frame is one panel of it at zoom 4.44, so almost
 * every word on the board is legitimately off-screen — and the check was reporting all of
 * them as unreadable. Measured on `projects/deb81002b073`, a strict-clean film: five
 * advisories, every one of them a word the camera was never pointed at.
 *
 * Under `wipe` this is close to a no-op, which is the honest description and not a reason
 * to skip it: the studio default is `wipe` now, but the CLI's `standard` still accumulates,
 * every film in `projects/` was made that way, and a check that only tells the truth about
 * the current default is a check that starts lying the next time the default moves.
 *
 * A missing or degenerate camera falls back to the whole board — the previous behaviour
 * exactly. This function must not be the reason a report goes quiet.
 */
export function textAt(plan: RenderPlan, t: number): string[] {
  const view = cameraRect(plan, t);
  const out: string[] = [];
  for (const item of plan.items) {
    if (item.start + item.dur > t) continue;
    if (item.sceneEnd < t && !item.persist) continue;
    if (item.fadeAt !== undefined && item.fadeAt <= t) continue;
    for (const prim of item.prims) {
      if (prim.kind !== 'text' || !prim.text.trim()) continue;
      // The text prim's own box, not the item's: an element can reserve a wide cell and
      // letter one label at the edge of it, and it is the label that is or is not on
      // screen. `motion` moves an item after it is drawn — ignored here on purpose, since
      // a moving element is not what the OCR diff is about and the offsets are per frame.
      if (view && !intersects(prim.box, view)) continue;
      out.push(prim.text.trim());
    }
  }
  return out;
}

/**
 * Capture the sample set and measure its ink.
 *
 * Takes the browser rather than opening one: the gate stage already has a page open for
 * the realized-layout report, and launching Chromium twice to look at the same film
 * would double the one cost this whole tier has on a keyless run.
 */
export async function captureSamples(
  browser: Browser,
  plan: RenderPlan,
  html: string,
  n = SAMPLES,
): Promise<FrameSample[]> {
  const times = sampleTimes(plan, n);
  if (times.length === 0) return [];
  const cap = await openCapture(browser, plan.frame, html);
  const out: FrameSample[] = [];
  try {
    for (const [index, { at, sceneId }] of times.entries()) {
      await cap.seek(at);
      const png = await cap.frame();
      out.push({
        index,
        at,
        sceneId,
        png,
        ...{ ink: await inkShare(png, plan.frame) },
        text: textAt(plan, at),
      });
    }
  } finally {
    await cap.close();
  }
  return out;
}

/** Frames with less ink on them than a drawn board has. */
export function inkFloorViolations(samples: readonly FrameSample[]): BoardViolation[] {
  const out: BoardViolation[] = [];
  for (const s of samples) {
    if (s.ink === undefined) continue;
    if (s.ink >= MIN_INK_SHARE) continue;
    out.push({
      kind: 'vacant',
      message:
        `at ${s.at.toFixed(1)}s (scene ${s.sceneId}) only ${(s.ink * 100).toFixed(2)}% of the ` +
        `frame's pixels are ink, against a ${(MIN_INK_SHARE * 100).toFixed(1)}% floor — this ` +
        'beat is a nearly blank board, whatever its bounding boxes measure',
    });
  }
  return out;
}

/** A one-line summary of what the ink measurement found, for the report's note. */
export function inkNote(samples: readonly FrameSample[]): string | undefined {
  const shares = samples.map((s) => s.ink).filter((v): v is number => v !== undefined);
  if (shares.length === 0) return undefined;
  const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
  return (
    `${shares.length} frames sampled: mean ink ${(mean * 100).toFixed(2)}% of pixels, ` +
    `sparsest ${(Math.min(...shares) * 100).toFixed(2)}%`
  );
}

/** The vision pass's answers, as findings. */
export function visionViolations(
  verdicts: readonly FrameVerdict[],
  samples: readonly FrameSample[],
): BoardViolation[] {
  const at = new Map(samples.map((s) => [s.index, s]));
  const out: BoardViolation[] = [];
  for (const v of verdicts) {
    const s = at.get(v.index);
    const where = s ? `at ${s.at.toFixed(1)}s (scene ${s.sceneId})` : `in frame ${v.index}`;
    const said = (kind: BoardViolation['kind'], what: string | undefined, label: string): void => {
      if (!what?.trim()) return;
      out.push({ kind, message: `${where}, a vision pass reports ${label}: ${what.trim()}` });
    };
    said('illegible', v.clipped, 'clipped or cut-off text');
    said('ink-on-ink', v.overlap, 'ink written through other ink');
    said('illegible', v.illegible, 'a region too small or faint to read');
    said('vacant', v.empty, 'a mostly empty board');
  }
  return out;
}

/**
 * The OCR diff: board text the IR says is written that the model could not read back.
 *
 * After the glyph gate (1.1) and the one metrics stack (2.1) this should be a tautology,
 * and that is exactly the argument for it — it is cheap insurance against the failure
 * class nobody has imagined yet, and it is the instrument that scores a competitor's
 * film in the bake-off, where there is no IR to check against anything.
 *
 * Matching is deliberately generous. A model reading handwriting will differ on case,
 * punctuation and word breaks, and a check that reported those would be noise: only a
 * word of four letters or more that appears *nowhere* in what was read counts, and only
 * when the model read something at all.
 */
export function ocrDiff(
  verdicts: readonly FrameVerdict[],
  samples: readonly FrameSample[],
): BoardViolation[] {
  const at = new Map(samples.map((s) => [s.index, s]));
  const out: BoardViolation[] = [];
  for (const v of verdicts) {
    const s = at.get(v.index);
    if (!s || !v.read || v.read.length === 0) continue;
    const seen = normalise(v.read.join(' '));
    const missing = [...new Set(words(s.text.join(' ')))].filter(
      (w) => w.length >= 4 && !seen.includes(w),
    );
    if (missing.length === 0) continue;
    out.push({
      kind: 'illegible',
      message:
        `at ${s.at.toFixed(1)}s (scene ${s.sceneId}) the board is supposed to carry ` +
        `${missing
          .slice(0, 8)
          .map((w) => `"${w}"`)
          .join(', ')}` +
        `${missing.length > 8 ? ` and ${missing.length - 8} more` : ''}, and a reader of the ` +
        'frame could not find those words on it',
    });
  }
  return out;
}

function normalise(s: string): string {
  return ` ${s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

function words(s: string): string[] {
  return normalise(s).split(/\s+/).filter(Boolean);
}

/** Log what the tier did, so a keyed run says out loud that it looked. */
export function reportTier2(samples: readonly FrameSample[], verdicts: number): void {
  log.info(
    `looked at ${samples.length} frame${samples.length === 1 ? '' : 's'}` +
      (verdicts > 0 ? `, ${verdicts} with a vision verdict` : ', no vision pass configured'),
  );
}
