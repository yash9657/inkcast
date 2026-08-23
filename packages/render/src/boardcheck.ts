/**
 * The board assertions (audit S4-c, S4-d, S7-c; Golpo defect D4; plan item 2.3).
 *
 * Everything here is arithmetic over data `compilePlan` already holds — element
 * boxes, resolved cameras, item timings — promoted from "computable" to *checked*.
 * The three checks:
 *
 *  (a) **Ink on ink.** Two solid elements that share board-time must not share
 *      board-space. Nested pairs are fine (a label annotating its picture), morph
 *      pairs are fine (the target grows out of the source), and arrows, paths and
 *      emphasis marks are exempt by type — an arrow's box spans the things it
 *      connects, an emphasis draws around its target on purpose.
 *  (b) **Ink off frame.** Every element revealed in a scene must sit inside that
 *      scene's view. On a *derived* camera a miss is a warning — the framing was
 *      fitted to the board, and the two deliberate exceptions (the walk window
 *      letting the oldest ink scroll off, the close-up ceiling) are the system
 *      trading legibility for coverage, not an authoring error. On an *authored*
 *      camera a miss is exactly an authoring error, and blocks under strict.
 *  (c) **Reveals that outlive their scene.** `itemsFor` clamps durations into the
 *      scene, so an overrun can only mean that arithmetic regressed — it blocks.
 *      Separately, a text reveal that finishes with less residence than a reader
 *      needs (`max(1.2s, words × 0.25s)`) is warned about, never blocked: the fix
 *      is `holdForCadence`'s floor upstream, not a per-item hack here.
 *
 * All three surface through `gate(...)` so `--degrade` stays the escape and the
 * message format stays uniform.
 */
import { TYPE_SCALE, basePxPerUnit, elementBounds, viewRect } from '@inkcast/core';
import type { Element, FrameSize, Rect, Scene, SceneFraming } from '@inkcast/core';
import { rectContains } from './geom.js';

export type BoardViolation = {
  kind: 'ink-on-ink' | 'off-frame' | 'overrun' | 'illegible';
  message: string;
};

/**
 * The smallest handwriting the board may introduce, in output pixels (plan 2.4).
 *
 * Measured against the corpus on 2026-08-23, not taken from the spec (18) or the
 * plan's provisional guess (14). Across seven boards the corpus letters at 26px and
 * up everywhere except the recap pull-backs, where newly revealed labels and
 * captions ship at 10.9–13.9px — reviewed films, readable text, deliberately wide
 * shots. A 14px floor would fail three shipped, watched reveals; the honest floor
 * sits just under the shipped minimum (10.9px), where everything below it really is
 * the illegible class: handwriting under 10 output pixels has no x-height left.
 */
export const MIN_GLYPH_PX = 10;

/** Element kinds whose box is solid content — the ones the overlap sweep covers. */
const SOLID = new Set(['text', 'equation', 'asset', 'diagram', 'plot', 'shape']);

/** Boxes are shrunk by this before intersecting, so edge-kissing is not a collision. */
const TOUCH_SLACK = 2;

const shrink = (b: Rect, by: number): Rect => ({
  x: b.x + by,
  y: b.y + by,
  w: Math.max(0, b.w - by * 2),
  h: Math.max(0, b.h - by * 2),
});

const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const at = (b: Rect): string => `(${Math.round(b.x + b.w / 2)},${Math.round(b.y + b.h / 2)})`;

/**
 * The drawing an element belongs to, from the planner's id convention
 * (`buildDrawing` names every element it builds `<drawingId>_<markId>`, and drawing
 * ids end in `_v<n>`). Two elements of one drawing are one *picture*: an atom outline
 * over its stack, a name written in a container's empty middle. Their overlaps are
 * the drawing lane's jurisdiction, measured against real ink segments
 * (`draw-geom.ts` — "a bounding box is the wrong obstacle"), not this sweep's.
 */
function drawGroup(id: string): string | null {
  const m = /^(.+_v\d+)(?:_|$)/.exec(id);
  return m ? (m[1] as string) : null;
}

type Placed = {
  el: Element;
  scene: string;
  /** First and last scene index the element is on the board for. */
  from: number;
  until: number;
  bounds: Rect;
};

/**
 * (a) Solid elements that share board-time and board-space.
 *
 * Lifetimes mirror `heldBounds` in `core/src/camera.ts`: a persistent element is on
 * the board for ever (accumulate is append-only), a wiped board's `persistUntil`
 * bounds it, and anything else lives only in its own scene.
 */
export function inkOnInkViolations(scenes: readonly Scene[], wipe: boolean): BoardViolation[] {
  const boxes = new Map<string, Rect>();
  for (const scene of scenes) for (const el of scene.elements) boxes.set(el.id, el.at);
  const indexOfScene = new Map(scenes.map((s, i) => [s.id, i]));

  const placed: Placed[] = [];
  scenes.forEach((scene, i) => {
    for (const el of scene.elements) {
      if (!SOLID.has(el.type)) continue;
      // Persistent ink only, as the plan says: a transient annotation lives one
      // beat, often deliberately over the thing it annotates, and fades before
      // anything could be misread.
      if (!el.persist && !(wipe && el.persistUntil !== undefined)) continue;
      const until = el.persist ? Infinity : (indexOfScene.get(el.persistUntil as string) ?? i);
      placed.push({ el, scene: scene.id, from: i, until, bounds: elementBounds(el, boxes) });
    }
  });

  const out: BoardViolation[] = [];
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i] as Placed;
    for (let j = i + 1; j < placed.length; j++) {
      const b = placed[j] as Placed;
      if (a.until < b.from || b.until < a.from) continue; // never on the board together
      // One drawing's parts compose one picture — the drawing lane polices those
      // against real ink, not boxes. Only cross-picture and board-level pairs sweep.
      const ga = drawGroup(a.el.id);
      if (ga !== null && ga === drawGroup(b.el.id)) continue;
      // The morph target grows out of its source; they are one piece of ink in time.
      if (b.el.morph?.fromId === a.el.id || a.el.morph?.fromId === b.el.id) continue;
      // Nested is annotation, not collision: a term written on its picture.
      if (
        rectContains(a.bounds, b.bounds, TOUCH_SLACK) ||
        rectContains(b.bounds, a.bounds, TOUCH_SLACK)
      )
        continue;
      if (!intersects(shrink(a.bounds, TOUCH_SLACK), shrink(b.bounds, TOUCH_SLACK))) continue;
      out.push({
        kind: 'ink-on-ink',
        message:
          `"${a.el.id}" (${a.el.type}, scene ${a.scene}, ${at(a.bounds)}) and ` +
          `"${b.el.id}" (${b.el.type}, scene ${b.scene}, ${at(b.bounds)}) occupy the same ` +
          'board space while both are on screen — two pieces of ink written through each other',
      });
    }
  }
  return out;
}

/**
 * (b) Elements revealed in a scene that its camera does not hold in frame.
 *
 * Returns errors (authored cameras) and warnings (derived — see the header)
 * separately, because only the first blocks.
 */
export function offFrameViolations(
  scenes: readonly Scene[],
  framing: readonly SceneFraming[],
  canvas: Rect,
  frame: FrameSize,
): { errors: BoardViolation[]; warnings: BoardViolation[] } {
  const boxes = new Map<string, Rect>();
  for (const scene of scenes) for (const el of scene.elements) boxes.set(el.id, el.at);

  const errors: BoardViolation[] = [];
  const warnings: BoardViolation[] = [];
  scenes.forEach((scene, i) => {
    const f = framing[i];
    if (!f) return;
    const view = viewRect(f.camera, canvas, frame);
    for (const el of scene.elements) {
      const bounds = elementBounds(el, boxes);
      if (rectContains(view, bounds, TOUCH_SLACK)) continue;
      const v: BoardViolation = {
        kind: 'off-frame',
        message:
          `"${el.id}" (${el.type}, ${at(bounds)}, ${Math.round(bounds.w)}×${Math.round(bounds.h)}) ` +
          `is revealed in scene ${scene.id} but its ${f.derived ? 'derived' : 'authored'} camera ` +
          `only shows ${at(view)} ${Math.round(view.w)}×${Math.round(view.h)} — ` +
          'ink drawn where the viewer is not looking',
      };
      (f.derived ? warnings : errors).push(v);
    }
  });
  return { errors, warnings };
}

/**
 * (2.4, static half) Text a scene reveals at a size its own camera renders illegible.
 *
 * The renderer letters a role at `TYPE_SCALE[role] × typeUnit` canvas units, and the
 * scene's zoom decides how many output pixels that lands as. Equations are skipped:
 * their glyph size is a consequence of typeset geometry fitted to a box, which only
 * the realized report (2.7) can see.
 */
export function glyphFloorViolations(
  scenes: readonly Scene[],
  framing: readonly SceneFraming[],
  canvas: Rect,
  frame: FrameSize,
  typeUnit: number,
): BoardViolation[] {
  const base = basePxPerUnit(canvas, frame);
  const out: BoardViolation[] = [];
  scenes.forEach((scene, i) => {
    const zoom = framing[i]?.camera.zoom;
    if (!zoom) return;
    const seen = new Set<string>();
    for (const el of scene.elements) {
      if (el.type !== 'text' || seen.has(el.role)) continue;
      seen.add(el.role);
      const px = TYPE_SCALE[el.role] * typeUnit * base * zoom;
      if (px < MIN_GLYPH_PX) {
        out.push({
          kind: 'illegible',
          message:
            `scene ${scene.id} reveals ${el.role} text ("${el.id}") at ${px.toFixed(1)} output ` +
            `pixels — below the ${MIN_GLYPH_PX}px legibility floor. The camera is framed too ` +
            'wide for the type it introduces',
        });
      }
    }
  });
  return out;
}

/** One text item as the browser really laid it out — `RealizedText` in browser.ts. */
export type RealizedReport = {
  id: string;
  text: string;
  asked: number;
  size: number;
  lines: number;
  boxW: number;
  boxH: number;
  blockH: number;
  fits: boolean;
};

/**
 * (2.7) The realized-layout sweep: checks the solver cannot run, because the
 * browser's shrink-to-fit is invisible to it. Two failure classes, both real
 * clipping-or-illegibility the estimate said were fine:
 *
 *  - text that does not fit its box even at the shrink floor (`fits: false`) —
 *    the next thing the runtime would do is overflow the box;
 *  - text shrunk below `MIN_GLYPH_PX` at its scene's zoom — legible in the
 *    estimate at the asked size, illegible as lettered.
 */
export function realizedTextViolations(
  reports: readonly RealizedReport[],
  plan: {
    canvas: Rect;
    frame: { w: number; h: number };
    scenes: readonly { camera: { zoom: number } }[];
    items: readonly { id: string; scene: number }[];
  },
): BoardViolation[] {
  const base = basePxPerUnit(plan.canvas, plan.frame);
  const sceneOf = new Map(plan.items.map((it) => [it.id, it.scene]));
  const out: BoardViolation[] = [];
  for (const r of reports) {
    const scene = sceneOf.get(r.id);
    const zoom = scene === undefined ? undefined : plan.scenes[scene]?.camera.zoom;
    if (!zoom) continue;
    if (!r.fits) {
      out.push({
        kind: 'illegible',
        message:
          `"${r.id}" ("${r.text}…") does not fit its ${Math.round(r.boxW)}×${Math.round(r.boxH)} ` +
          `box even at the shrink floor (${r.lines} lines, ${Math.round(r.blockH)} units tall) — ` +
          'the browser will overflow the box the solver reserved',
      });
      continue;
    }
    const px = r.size * base * zoom;
    if (px < MIN_GLYPH_PX && r.size < r.asked) {
      out.push({
        kind: 'illegible',
        message:
          `"${r.id}" ("${r.text}…") was shrunk from ${Math.round(r.asked)} to ` +
          `${r.size.toFixed(1)} canvas units to fit its box — ${px.toFixed(1)} output pixels ` +
          `at its scene's zoom, below the ${MIN_GLYPH_PX}px legibility floor`,
      });
    }
  }
  return out;
}

/** The slice of a `PlanItem` the timing checks need — importable by tests. */
export type TimedItem = {
  id: string;
  start: number;
  dur: number;
  sceneEnd: number;
  persist: boolean;
};

/** (c) Items whose reveal runs past the end of their own scene. */
export function overrunViolations(items: readonly TimedItem[]): BoardViolation[] {
  const out: BoardViolation[] = [];
  for (const item of items) {
    const over = item.start + item.dur - item.sceneEnd;
    if (over > 1e-3) {
      out.push({
        kind: 'overrun',
        message:
          `item "${item.id}" is still being drawn ${over.toFixed(2)}s after its scene ends ` +
          `(start ${item.start.toFixed(2)} + dur ${item.dur.toFixed(2)} > scene end ` +
          `${item.sceneEnd.toFixed(2)}) — the viewer never sees it finish`,
      });
    }
  }
  return out;
}

/**
 * Post-completion residence a reader needs for `words` words on the board.
 * The floor lives in `holdForCadence`'s territory — this only reports against it.
 */
export function dwellFloor(words: number): number {
  return Math.max(1.2, words * 0.25);
}

/**
 * (c, advisory) Text that finishes writing with too little time left to read it.
 *
 * Board-level text only: a drawing's labels enter staggered while the narration
 * walks the picture, and are read as parts of it — `dwellFloor` per mark would
 * demand 1.2s of tail silence for every "+" in a battery diagram.
 */
export function dwellWarnings(
  items: readonly (TimedItem & { words?: number })[],
): BoardViolation[] {
  const out: BoardViolation[] = [];
  for (const item of items) {
    if (!item.persist || item.words === undefined || item.words === 0) continue;
    if (drawGroup(item.id) !== null) continue;
    const residence = item.sceneEnd - (item.start + item.dur);
    const floor = dwellFloor(item.words);
    if (residence + 1e-3 < floor) {
      out.push({
        kind: 'overrun',
        message:
          `"${item.id}" finishes writing with ${residence.toFixed(2)}s left in its scene — ` +
          `${item.words} word${item.words === 1 ? '' : 's'} need about ${floor.toFixed(2)}s ` +
          "of residence to be read. The fix is holdForCadence's floor, not a per-item hack",
      });
    }
  }
  return out;
}
