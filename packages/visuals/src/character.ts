/**
 * Character rigs — the same person, drawn in several poses.
 *
 * ## The problem this solves
 *
 * `figures/` gives four archetypes, and four archetypes are not a cast. A narrative
 * topic needs *one* character who stands in beat two, walks in beat five and points in
 * beat eight, and a learner must recognise them as the same person all three times. Four
 * unrelated SVGs cannot do that: nothing ties them together, so the "character" changes
 * face every time they move.
 *
 * A rig ties them together by construction. One drawing, named parts, and a pose is a
 * set of rotations applied to it — so the head in beat eight is not a similar head, it is
 * *the same path data*.
 *
 * ## Composition is the mechanism; generation is the fallback
 *
 * `PIPELINE.md` is emphatic about the order and it is worth restating: composition is
 * free, instant and exactly consistent, and generation is none of those. So a pose is
 * composed wherever it is a limb rotation, and only generated where it is not — a change
 * of expression, a hand doing something a rotation cannot describe.
 *
 * ## Three details that identity actually depends on
 *
 * 1. **The rig declares its own `viewBox`, and every pose is fitted through it.** If the
 *    source box were measured from the composed parts instead, a raised arm would widen
 *    the box, every pose would land on a different `fitMatrix`, and the head would come
 *    out a slightly different size in each one. Nothing would look broken; the character
 *    would just quietly stop being the same size.
 *
 * 2. **A part's ink seed is a function of the rig and the part id, and nothing else.**
 *    Not its index, which is what a naive loop gives you: a pose that hides the far leg
 *    shifts every later part by one, and the whole body re-wobbles. With per-part seeds a
 *    pose can hide, reorder or add parts and everything it did not touch is byte-identical.
 *
 * 3. **The rig's `seed` overrides the asset's.** One character across three beats is
 *    three `Asset` entries — resolution is per id — so seeding from the asset id would
 *    give the same face three different wobbles. That is precisely the failure
 *    `PIPELINE.md` calls worse than shipping a stiffer character.
 *
 * Together those are what make `the same character composes identically across poses`
 * (in `test/character.test.ts`) an assertion about bytes rather than about vibes.
 *
 * ## Rigs are authored in profile
 *
 * Facing right. A 2D rig can only rotate about pivots, and rotating a limb is only
 * meaningful in the view where limbs swing — front-on, the same rotations give you arm
 * gestures and nothing else. `AssetElement.flipX` already exists to face left.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cacheDir, logger } from '@inkcast/core';
import type { DrawContext, InkMode, InkPath, StrokeWeight } from './geometry.js';
import { roughenPathData, seedFrom } from './geometry.js';
import type { Box, Matrix } from './svg.js';
import {
  fitMatrix,
  identity,
  multiply,
  parsePath,
  pathToString,
  pointsBBox,
  rotateM,
  samplePath,
  svgChildren,
  transformSegs,
} from './svg.js';

const log = logger('visuals:character');

/** One named, pivotable piece of a character. */
export type RigPart = {
  id: string;
  /** Path data in the rig's own coordinate space, at rest. */
  d: string;
  /** The joint this part rotates about, in the same space. */
  pivot: [number, number];
  /**
   * The part this one hangs off, if any.
   *
   * A chain is what lets a knee bend: rotating a thigh carries its shin and foot, and
   * the shin's own angle is then relative to the thigh. Without it a leg is one rigid
   * stick and a seated pose is unreachable by composition — which would push it into the
   * generated lane for no reason other than a missing fifteen lines.
   */
  parent?: string;
  /** `currentColor` fills with the board ink; a literal colour is honoured verbatim. */
  fill?: string;
  weight?: StrokeWeight;
};

export type RigPose = {
  /** Part id -> degrees clockwise about that part's pivot. Omitted parts stay at rest. */
  compose?: Record<string, number>;
  /** Parts to leave out — the far leg in a tucked profile pose, say. */
  hide?: string[];
  /**
   * This pose cannot be composed and must be generated.
   *
   * Generation needs a provider, so `fallback` names the composed pose to draw instead
   * when there is no key, the cache is cold, or the identity gate rejects the result.
   * A pose with no reachable fallback is a pose that can vanish from a video.
   */
  generated?: boolean;
  fallback?: string;
};

export type CharacterRig = {
  id: string;
  version: number;
  /** Locked, so the same part is inked identically in every pose and every project. */
  seed: number;
  /** The canonical description a generated variant is conditioned on. */
  look: string;
  /** Fixed for every pose — see note 1 in the header. `[x, y, w, h]`. */
  viewBox: [number, number, number, number];
  /** Draw order is reveal order, as everywhere else in the library. */
  parts: RigPart[];
  poses: Record<string, RigPose>;
};

/* ------------------------------------------------------------------ loading */

const cache = new Map<string, CharacterRig | undefined>();

/** Drop the memoised rigs. Tests only. */
export function resetRigCache(): void {
  cache.clear();
}

/**
 * Read and validate a rig file.
 *
 * Validation is deliberately strict about *structure* — a rig with a bad parent id or a
 * cyclic chain would compose into silent nonsense — and returns `undefined` rather than
 * throwing, so a malformed rig degrades to the next asset lane like every other library
 * failure.
 */
export function loadRig(file: string): CharacterRig | undefined {
  const key = path.resolve(file);
  if (cache.has(key)) return cache.get(key);
  const rig = readRig(key);
  cache.set(key, rig);
  return rig;
}

function readRig(file: string): CharacterRig | undefined {
  if (!existsSync(file)) {
    log.warn(`no rig at ${file}`);
    return undefined;
  }
  let parsed: Partial<CharacterRig>;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<CharacterRig>;
  } catch (err) {
    log.warn(`could not parse the rig ${file}`, err);
    return undefined;
  }

  const { id, seed, viewBox, parts, poses } = parsed;
  if (!id || typeof seed !== 'number') {
    log.warn(`rig ${file} needs an id and a numeric seed`);
    return undefined;
  }
  if (!Array.isArray(viewBox) || viewBox.length !== 4 || !(viewBox[2] > 0 && viewBox[3] > 0)) {
    // Not a nicety: without a fixed box every pose is fitted differently. See note 1.
    log.warn(`rig ${id} needs a viewBox [x, y, w, h] with a positive width and height`);
    return undefined;
  }
  if (!Array.isArray(parts) || parts.length === 0) {
    log.warn(`rig ${id} has no parts`);
    return undefined;
  }

  const ids = new Set<string>();
  for (const p of parts) {
    if (!p?.id || !p.d || !Array.isArray(p.pivot) || p.pivot.length !== 2) {
      log.warn(`rig ${id} has a part with no id, no path data or no pivot`);
      return undefined;
    }
    if (ids.has(p.id)) {
      log.warn(`rig ${id} declares the part "${p.id}" twice`);
      return undefined;
    }
    ids.add(p.id);
  }
  for (const p of parts) {
    if (p.parent && !ids.has(p.parent)) {
      log.warn(`rig ${id}: part "${p.id}" hangs off "${p.parent}", which does not exist`);
      return undefined;
    }
  }
  if (cyclicPart(parts)) {
    log.warn(`rig ${id} has a cycle in its part chain`);
    return undefined;
  }

  const rig: CharacterRig = {
    id,
    version: parsed.version ?? 1,
    seed: seed || 1, // 0 means "unseeded" to roughjs; see the note in geometry.ts.
    look: parsed.look ?? id,
    viewBox: [viewBox[0] ?? 0, viewBox[1] ?? 0, viewBox[2], viewBox[3]],
    parts,
    poses: poses ?? {},
  };
  return rig;
}

function cyclicPart(parts: RigPart[]): boolean {
  const parent = new Map(parts.map((p) => [p.id, p.parent]));
  for (const start of parent.keys()) {
    const seen = new Set<string>([start]);
    let at = parent.get(start);
    while (at) {
      if (seen.has(at)) return true;
      seen.add(at);
      at = parent.get(at);
    }
  }
  return false;
}

/* -------------------------------------------------------------- composition */

export type ComposedPart = {
  id: string;
  /** Path data in rig space, with the pose's rotations applied. */
  d: string;
  fill?: string;
  weight?: StrokeWeight;
  /** True when this part's own chain applied no rotation at all. */
  atRest: boolean;
};

/**
 * The transform for every part under one pose.
 *
 * `T(part) = T(parent) · R(angle, pivot)`, with pivots read in the rig's rest space —
 * the standard hierarchy, and the reason a thigh's rotation carries its shin without the
 * shin having to know anything about it.
 */
function partTransforms(rig: CharacterRig, pose: RigPose): Map<string, Matrix> {
  const angles = pose.compose ?? {};
  const byId = new Map(rig.parts.map((p) => [p.id, p]));
  const out = new Map<string, Matrix>();

  const resolve = (part: RigPart): Matrix => {
    const done = out.get(part.id);
    if (done) return done;
    const own = angles[part.id];
    const local = own ? rotateM(own, part.pivot[0], part.pivot[1]) : identity;
    const parent = part.parent ? byId.get(part.parent) : undefined;
    const m = parent ? multiply(resolve(parent), local) : local;
    out.set(part.id, m);
    return m;
  };

  for (const part of rig.parts) resolve(part);
  return out;
}

/** True when neither this part nor anything above it is rotated by `pose`. */
function restingUnder(rig: CharacterRig, pose: RigPose, part: RigPart): boolean {
  const angles = pose.compose ?? {};
  const byId = new Map(rig.parts.map((p) => [p.id, p]));
  let at: RigPart | undefined = part;
  while (at) {
    if (angles[at.id]) return false;
    at = at.parent ? byId.get(at.parent) : undefined;
  }
  return true;
}

/**
 * Apply a pose to a rig, in rig space.
 *
 * Returns `undefined` for an unknown pose name rather than silently drawing the rest
 * pose, because a storyboard asking for a pose that does not exist is a bug worth seeing
 * in a log rather than a character standing still for no reason.
 */
export function composePose(rig: CharacterRig, poseName: string): ComposedPart[] | undefined {
  const pose = rig.poses[poseName];
  if (!pose) {
    log.warn(`rig ${rig.id} has no pose "${poseName}" (has ${Object.keys(rig.poses).join(', ')})`);
    return undefined;
  }
  const transforms = partTransforms(rig, pose);
  const hidden = new Set(pose.hide ?? []);

  const out: ComposedPart[] = [];
  for (const part of rig.parts) {
    if (hidden.has(part.id)) continue;
    const m = transforms.get(part.id) ?? identity;
    const d = m === identity ? part.d : pathToString(transformSegs(parsePath(part.d), m));
    if (!d) continue;
    out.push({
      id: part.id,
      d,
      atRest: restingUnder(rig, pose, part),
      ...(part.fill ? { fill: part.fill } : {}),
      ...(part.weight ? { weight: part.weight } : {}),
    });
  }
  return out;
}

/* ----------------------------------------------------------------- drawing */

/**
 * Ink a set of composed parts into `box`, through the rig's fixed viewBox.
 *
 * Exported because the generated lane inks its cached geometry the same way — one funnel,
 * so a generated pose and a composed one are laid down by the same hand.
 */
export function inkParts(args: {
  rig: CharacterRig;
  parts: readonly ComposedPart[];
  box: Box;
  ctx: DrawContext;
  ink: InkMode;
  inset?: number;
}): InkPath[] {
  const [vx, vy, vw, vh] = args.rig.viewBox;
  const inset = args.inset ?? Math.min(args.box.w, args.box.h) * 0.04;
  const m = fitMatrix({ x: vx, y: vy, w: vw, h: vh }, args.box, inset);

  const out: InkPath[] = [];
  for (const part of args.parts) {
    const d = pathToString(transformSegs(parsePath(part.d), m));
    if (!d) continue;

    const fill =
      !part.fill || part.fill === 'none'
        ? undefined
        : part.fill === 'currentColor'
          ? (args.ctx.colour ?? args.ctx.style.ink)
          : part.fill;

    const ctx: DrawContext = {
      ...args.ctx,
      ink: args.ink,
      // Note 2 in the header: the rig and the part id, and nothing else. Not the index,
      // and not the asset id — a hidden sibling or a second beat must not re-wobble a face.
      seed: seedFrom('rig', args.rig.id, args.rig.seed, part.id),
      group: `character:${args.rig.id}:${part.id}`,
      ...(part.weight ? { weight: part.weight } : {}),
    };

    // Same fork as the library lane, for the same reason: roughjs must be *given* a fill
    // so it can hachure the region, because what it returns is the stroke it drew rather
    // than the contour it was given. Crisp output is the contour, so it takes the fill after.
    const over = fill && args.ink === 'sketch' ? { fill, fillStyle: ctx.style.fillStyle } : {};
    for (const p of roughenPathData(ctx, d, 0, over)) {
      out.push({ ...p, ...(fill && args.ink === 'crisp' ? { fill, fillRule: 'nonzero' } : {}) });
    }
  }
  return out;
}

/* -------------------------------------------------- the generated-pose lane */

/** Where a generated variant is cached: `~/.inkcast/cache/characters/<id>/<pose>-<seed>.svg`. */
export function posePath(rig: CharacterRig, pose: string): string {
  return path.join(cacheDir('characters', rig.id), `${pose}-${rig.seed}.svg`);
}

/**
 * Produce the geometry for one generated pose, in rig space.
 *
 * Injected rather than imported so the orchestration below is testable with no provider
 * and no network: the real implementation is text-to-image conditioned on the rig's base
 * raster, vectorised, which is the illustration lane's machinery pointed at a rig.
 */
export type PoseGenerator = (args: {
  rig: CharacterRig;
  pose: string;
  /** 1 on the first try, 2 on the single retry. */
  attempt: number;
}) => Promise<ComposedPart[] | undefined>;

export type PoseGate = (
  candidate: readonly ComposedPart[],
  base: readonly ComposedPart[],
) => { score: number; ok: boolean };

/**
 * How much ink a set of parts carries, and how it is shaped.
 *
 * Both are scale-free — length is expressed against the diagonal of the content's own
 * bounding box — so the two things being compared do not have to be the same size.
 */
function inkProfile(parts: readonly ComposedPart[]): { ink: number; aspect: number } {
  const pts = parts.flatMap((p) => samplePath(parsePath(p.d)));
  const bbox = pointsBBox(pts);
  const diag = Math.hypot(bbox.w, bbox.h) || 1;
  let length = 0;
  for (const p of parts) {
    const s = samplePath(parsePath(p.d));
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1];
      const b = s[i];
      if (a && b) length += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  return { ink: length / diag, aspect: bbox.w / Math.max(1e-6, bbox.h) };
}

/**
 * The default gate — and read the name literally, because it is **not** the identity
 * check `PIPELINE.md` specifies.
 *
 * That check is an embedding similarity against the base raster, which needs a model this
 * package cannot run offline. What this does instead is catch the failure that has nothing
 * to do with identity: a vectoriser that returned mush, a generation that came back as a
 * blob or as a wireframe of a thousand fragments. It compares how much ink there is and
 * how the whole thing is proportioned, both scale-free.
 *
 * So it will reject a smear and accept a different person's face. It is a floor under the
 * lane, not the gate — `PoseGate` is the seam the real one arrives through, and until it
 * does, a generated pose is not trustworthy enough to be worth a key.
 */
export function plausibilityGate(
  candidate: readonly ComposedPart[],
  base: readonly ComposedPart[],
): { score: number; ok: boolean } {
  if (candidate.length === 0) return { score: 0, ok: false };
  const c = inkProfile(candidate);
  const b = inkProfile(base);
  const inkRatio = Math.min(c.ink, b.ink) / Math.max(1e-6, Math.max(c.ink, b.ink));
  const aspectRatio = Math.min(c.aspect, b.aspect) / Math.max(1e-6, Math.max(c.aspect, b.aspect));
  const score = Math.min(inkRatio, aspectRatio);
  return { score, ok: score >= 0.5 };
}

export type GeneratedPose = {
  parts: ComposedPart[];
  how: 'cache' | 'generated';
  score?: number;
};

/** Read a cached variant back as parts. Cached *geometry*, so the ink style can change. */
function readCachedPose(file: string): ComposedPart[] | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const children = svgChildren(readFileSync(file, 'utf8'));
    if (children.length === 0) return undefined;
    return children.map((c, i) => ({
      id: c.attrs['data-part'] ?? `gen${i}`,
      d: c.d,
      atRest: false,
      ...(c.attrs.fill ? { fill: c.attrs.fill } : {}),
    }));
  } catch (err) {
    log.warn(`could not read the cached pose ${file}`, err);
    return undefined;
  }
}

/**
 * Cache an accepted variant as *geometry*, not as a rendering.
 *
 * So the ink style, the palette and the stroke weight can all change afterwards without
 * paying a provider again — the expensive part was deciding what the pose looks like, and
 * that is what is worth keeping. Written in rig space, so it composes with everything else
 * the rig does.
 *
 * A cache write that fails is logged and ignored: the pose has already been accepted, and
 * losing the copy costs a future generation rather than this one.
 */
async function writeCachedPose(
  file: string,
  rig: CharacterRig,
  parts: readonly ComposedPart[],
): Promise<void> {
  const [x, y, w, h] = rig.viewBox;
  const body = parts
    .map((p) => `  <path data-part="${p.id}" d="${p.d}"${p.fill ? ` fill="${p.fill}"` : ''}/>`)
    .join('\n');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" ` +
    `data-rig="${rig.id}" data-seed="${rig.seed}">\n${body}\n</svg>\n`;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, svg);
  } catch (err) {
    log.warn(`could not cache the generated pose at ${file}`, err);
  }
}

let generatorNoticeShown = false;

/**
 * Resolve a `generated: true` pose: cache, then generate, then gate, then give up.
 *
 * The shape of it is the whole point, so it is worth stating plainly. One retry and no
 * more, because a model that missed twice on the same prompt will miss a third time and
 * the caller is holding up a render. And a rejection falls back to a *composed* pose
 * rather than to the best of a bad set, because a stiffer character who is recognisably
 * the same person beats a fluid one who is not — that is the trade `PIPELINE.md` names,
 * and it is the reason this lane is allowed to fail loudly and carry on.
 *
 * `undefined` means the caller should compose `pose.fallback` instead.
 */
export async function resolveGeneratedPose(args: {
  rig: CharacterRig;
  pose: string;
  generate?: PoseGenerator;
  gate?: PoseGate;
  /** The composed pose a candidate is judged against. */
  base: readonly ComposedPart[];
  cacheFile?: string;
}): Promise<GeneratedPose | undefined> {
  const file = args.cacheFile ?? posePath(args.rig, args.pose);

  const cached = readCachedPose(file);
  if (cached) {
    log.debug(`pose ${args.rig.id}/${args.pose} served from the cache`, file);
    return { parts: cached, how: 'cache' };
  }

  if (!args.generate) {
    if (!generatorNoticeShown) {
      generatorNoticeShown = true;
      log.info(
        `pose "${args.pose}" of ${args.rig.id} is a generated variant and nothing can generate ` +
          'it — drawing the composed fallback. This needs an image provider and the identity ' +
          'gate that goes with it.',
      );
    }
    return undefined;
  }

  const gate = args.gate ?? plausibilityGate;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const candidate = await args.generate({ rig: args.rig, pose: args.pose, attempt });
    if (!candidate?.length) {
      log.warn(`pose ${args.rig.id}/${args.pose}: generation attempt ${attempt} produced nothing`);
      continue;
    }
    const verdict = gate(candidate, args.base);
    if (verdict.ok) {
      log.debug(`pose ${args.rig.id}/${args.pose} accepted at ${verdict.score.toFixed(2)}`);
      // Only an *accepted* candidate is cached, which is what makes the cache-hit branch
      // above safe to trust without re-gating: everything in there already passed.
      await writeCachedPose(file, args.rig, candidate);
      return { parts: candidate, how: 'generated', score: verdict.score };
    }
    log.warn(
      `pose ${args.rig.id}/${args.pose}: attempt ${attempt} rejected by the identity gate ` +
        `(${verdict.score.toFixed(2)})`,
    );
  }

  log.warn(
    `pose ${args.rig.id}/${args.pose} could not be generated to the standard — falling back ` +
      'to a composed pose, which is stiffer and still the same character',
  );
  return undefined;
}

/** Reset the once-per-process log latch. Tests only. */
export function resetPoseNotice(): void {
  generatorNoticeShown = false;
}
