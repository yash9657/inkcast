/**
 * Referring: when a beat should point at what is already drawn instead of drawing it again.
 *
 * ## The defect this exists to remove
 *
 * `projects/cardiac8f` draws the heart four times. Beat 1 generates "cutaway cross-section
 * of a human heart showing all four chambers", beat 3 generates "cutaway cross-section of a
 * human heart, upper chambers contracting", beat 6 generates "cutaway cross-section of a
 * human heart showing both lower chambers" — three separate images, three separate cells,
 * three separate charges on the image provider — and then the recap opens a *fourth* panel
 * and redraws the whole pathway in 22 strokes while the originals are all still on the
 * board. It reads as amnesia. A teacher who has drawn a heart does not draw a second heart
 * to talk about its atria; they point at the one on the board and mark it up.
 *
 * ## Why an identity had to be invented, and what was checked first
 *
 * Two identities already exist and neither can say this.
 *
 * - **Asset ids.** `underlayAsset` hashes the *exact* prompt, and `registry.mint` dedupes
 *   on the id, so two beats asking for a picture in the same words already share one
 *   image. That is deliberate and it must stay — the header of `underlay.ts` records what
 *   happened in `projects/cardiac5` when two different prompts collided on one four-word
 *   slug, and it was silent and wrong. But an author writing about the atria and an author
 *   writing about the septum do not describe the same heart in the same words, and the
 *   whole point is that it is the same heart.
 * - **`libraryFingerprint`.** Real identity, but only for the curated library: it answers
 *   "which pinned file and version is this", and returns `''` for every generated picture,
 *   which is every picture in the hybrid lane.
 *
 * So `subjectOf` is a deliberate *coarsening* of the asset id rather than a new scheme: it
 * keeps the head of the prompt — the object being drawn — and throws away the clause that
 * describes this beat's view of it. Two beats whose pictures are of the same object, in the
 * same box, in the same mode, are drawing the same subject.
 *
 * It is deliberately exact rather than fuzzy. "cutaway cross-section of a human heart" and
 * "a human heart, anatomical, external front view" are *not* the same subject here, and
 * merging them is precisely the `cardiac5` failure: the beats that needed to see inside the
 * heart would be annotating the outside of one. A cut-open view and an external view are
 * two pictures, and a viewer can see that they are.
 */
import type { BoardMode, LessonStep, Mark, VisualIntent } from '@inkcast/core';
import { readInkBox } from './underlay.js';
import type { BeatRole, Board } from './regions.js';

/**
 * Words that end the name of an object and begin the description of a *view* of it.
 *
 * Everything before one of these is what the picture is *of*; everything after is what
 * this beat wanted to see of it. Cutting here is what lets three prompts that all open
 * "cutaway cross-section of a human heart" agree, while keeping the external view of the
 * same organ separate — the clause boundary is where the beat's own interest starts.
 */
const VIEW = /\b(?:showing|shown|with|where|in which|labelled|labeled|seen|viewed|drawn)\b/i;

/** Articles and joiners that carry no identity. Everything else in the head is kept. */
const NOISE = new Set(['a', 'an', 'the', 'of', 'its', 'and']);

/** Tokens of a name, lowercased, punctuation dropped, noise words removed. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 0 && !NOISE.has(w));
}

/**
 * The object a generated-picture prompt is a picture of, as tokens.
 *
 * The prompt's first clause, cut at the first punctuation or at the first word of `VIEW`.
 */
function headOf(prompt: string): string {
  const clause = prompt.split(/[,;:(]/, 1)[0] ?? prompt;
  const view = VIEW.exec(clause);
  return tokens(view ? clause.slice(0, view.index) : clause).join(' ');
}

/**
 * The identity of the picture a beat's visual intent asks to be generated, or `undefined`
 * when it asks for none.
 *
 * Three things are folded in, and each one is a guard rather than decoration:
 *
 * - **the object** (`headOf`), which is the identity a viewer sees;
 * - **the mode**, because a `form` is traced into the board's own ink and a `figure` is
 *   shown as a colour raster — the same organ in the two modes is two pictures, and
 *   `visuals` already keys its cache on the distinction;
 * - **the box the picture's ink occupies**. This is what makes reuse geometrically safe
 *   rather than hopeful. The marks of the referring beat were composed against a picture
 *   sitting in exactly that box; if the picture that is actually on the board sits
 *   somewhere else, every leader arrow points a little way off the structure it names,
 *   which is the one failure the whole hybrid lane is an argument about (`underlay.ts`).
 *   A `figure` claims a fixed box by construction (`figureBox()`), so figures of one
 *   subject always agree; a `form`'s box is measured from a trace of its own raster, so
 *   two differently-worded forms disagree and are held apart by this term — which is the
 *   right answer, because a form's author *looked at* its picture.
 *
 * No `inkBox` means no picture was ever generated for this prompt, so there is nothing on
 * the board to refer to and nothing to reuse.
 */
export function subjectOf(intent: VisualIntent): string | undefined {
  const prompt = intent.underlay?.prompt?.trim();
  if (!prompt) return undefined;
  const ink = readInkBox(intent.underlay?.inkBox);
  if (!ink) return undefined;
  const head = headOf(prompt);
  if (!head) return undefined;
  const kind = intent.underlay?.kind ?? 'form';
  return `${kind}/${head}/${ink.x},${ink.y},${ink.w},${ink.h}`;
}

/** The one intent of this beat that asks for a generated picture, if there is exactly one. */
function lonePicture(step: LessonStep): VisualIntent | undefined {
  const withPictures = step.visuals.filter((v) => subjectOf(v) !== undefined);
  // Two pictures in one beat cannot be resolved beat-locally: sharing a cell is a
  // property of the whole beat, so referring for one of them would drag the other into
  // the host's cell as well, and the host's picture would come back with a stranger on
  // top of it. No lesson has ever asked for this; if one does, it draws as it always did.
  return withPictures.length === 1 ? withPictures[0] : undefined;
}

/* ------------------------------------------------------------------- part names */

/**
 * A written name, normalised for comparison with another written name.
 *
 * Compared as *written* names on both sides, deliberately. A recap's job is to re-read the
 * board, and the thing a viewer reads is the label; a label the board already carries is a
 * label the recap is writing for the second time. Comparing to mark ids instead would be
 * comparing to something nobody can see.
 *
 * The leading enumerator and the trailing gloss come off because a recap writes
 * `3 AV node (slow doorway)` for the part an earlier beat wrote as `AV node`, and those
 * are the same name with the recap's own scaffolding around it.
 */
export function nameOf(text: string): string {
  const bare = text
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^\s*\d+\s*[.)]?\s*/, ' ')
    .replace(/\s+/g, ' ');
  return tokens(bare).join(' ');
}

/** Every part name a drawing writes, in the order it writes them, normalised. */
export function namesWritten(marks: readonly Mark[] | undefined): string[] {
  const out: string[] = [];
  for (const m of marks ?? []) {
    if (m.kind !== 'label') continue;
    const name = nameOf(m.text ?? '');
    if (name.length >= 3 && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Whether two written names name the same part.
 *
 * Containment by whole words, not by substring. `sameTerm` in core is a plain
 * `includes` either way, which is right for vocabulary — `molecule` inside `molecules` —
 * and wrong here: `ring` inside `ringing` is a false match, and a false match makes the
 * recap circle a part it never mentioned. The shorter name has to appear as a run of whole
 * tokens inside the longer one, which is what makes `ripple` the same part as
 * `atrial ripple` and keeps `fibrous ring` apart from `non-conducting ring`.
 */
export function sameName(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = a.split(' ');
  const y = b.split(' ');
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  for (let i = 0; i + short.length <= long.length; i++) {
    if (short.every((w, k) => long[i + k] === w)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------- decisions */

/** A beat that draws no picture of its own because an earlier beat's is the picture. */
export type Referral = {
  /** The beat that drew it first, and still owns it. */
  host: number;
  /** The identity both beats agree on. See `subjectOf`. */
  subject: string;
};

/** A recap that re-reads the board instead of opening a panel to redraw it. */
export type Recall = {
  beat: number;
  /** The cell it takes instead of a fresh one — the beat that named most of its parts. */
  host: number;
  /** The names it would have written again, in its own order. */
  names: string[];
};

export type Referrals = {
  /** `beat -> the earlier beat whose picture is this beat's picture`. */
  pictures: Map<number, Referral>;
  /** The recap, when its drawing is a second copy of what the board already says. */
  recall: Recall | null;
};

/**
 * How many names a recap has to be repeating before its picture is judged a second copy.
 *
 * Three, and a majority of what it names. One repeated name is a recap that mentions
 * something in passing; a recap that re-labels most of its picture with names the board
 * is already carrying has drawn the board again. The threshold is what keeps a recap that
 * genuinely introduces a new picture — a comparison, a graph of the whole process — from
 * losing it.
 */
const RECALL_MIN = 3;

/**
 * Which beats refer to an earlier beat's drawing rather than making their own.
 *
 * Derived from the lesson alone, because it has to be: `planBoard` needs the share map
 * before any beat is built, so the decision cannot depend on the elements the build
 * produces. Everything here reads `visuals` and nothing else.
 *
 * **Both board modes are decided here, and they want different things.** Under
 * `accumulate` the earlier picture is still on the board, so referring is real: the beat
 * takes the host's cell and marks up the picture that is there. Under `wipe` the previous
 * card has been wiped and the board behind this beat is blank paper, so there is nothing
 * to point at — a reference to a wiped board is worse than a redraw, because a redraw at
 * least shows the learner something. So `pictures` is empty under `wipe`; what survives
 * the wipe is the *identity*, which the compiler applies separately by minting one asset
 * for one subject, so a wiping board still draws the same heart on every card and still
 * pays the generator once.
 */
export function findReferrals(
  beats: readonly { step: LessonStep; role: BeatRole }[],
  board: BoardMode,
): Referrals {
  const pictures = new Map<number, Referral>();
  const recall = findRecall(beats, board);
  if (board === 'wipe') return { pictures, recall };

  /** `subject -> the beat that owns its picture`. First to draw it owns it. */
  const owner = new Map<string, number>();
  beats.forEach(({ step }, i) => {
    const intent = lonePicture(step);
    const subject = intent ? subjectOf(intent) : undefined;
    if (!subject) return;
    const host = owner.get(subject);
    if (host === undefined) {
      owner.set(subject, i);
      return;
    }
    // The recap is decided by `findRecall`, which is a different move with a different
    // test: it refers by *name* to parts scattered across the whole board rather than to
    // one picture, and it must not do both.
    if (recall?.beat === i) return;
    pictures.set(i, { host, subject });
  });
  return { pictures, recall };
}

/* ------------------------------------------------------------------- the board */

/**
 * The beat whose cell this beat really draws into, following the share chain to its end.
 *
 * A chain because sharing composes: the beat that morphs the anchor's hillside shares the
 * anchor's cell, and a later beat referring to *that* picture is pointed at the morphing
 * beat. Both have to end up in the anchor's cell or the second one is aimed at a cell that
 * holds nothing. Bounded by the map's own size and guarded against a cycle, because
 * `shares` is assembled from two independent passes (`findReuse` and `findReferrals`) and
 * neither can see the other's entries — a cycle is not reachable today and is exactly the
 * kind of thing that becomes reachable when a third pass is added.
 */
function hostOf(beat: number, shares: ReadonlyMap<number, number>): number | undefined {
  let at = shares.get(beat);
  if (at === undefined) return undefined;
  const seen = new Set<number>([beat]);
  for (;;) {
    if (seen.has(at)) return at;
    seen.add(at);
    const next = shares.get(at);
    if (next === undefined) return at;
    at = next;
  }
}

/**
 * A board on which a beat that shares a cell is asked about *its host's* cell.
 *
 * ## What this fixes, and why `planBoard` cannot fix it alone
 *
 * `planBoard` already honours `sharesCellWith` — but only *within a region*. It builds
 * `cellOfOwner` from the beats of one region at a time and looks the host up in that map,
 * so a share whose host sits in a different region misses and falls through to
 * `?? region.box`: the whole region, which is the sharer's own region and not the host's.
 * That is not a small error. It is a beat handed a box four times the size of a cell,
 * centred on a panel whose ink belongs to other beats, drawing on top of them — and it is
 * silent, because a box is a box.
 *
 * Within a region the two agree exactly, by construction: `planBoard` returns the host's
 * cell and so does this. Which is why it is a decorator rather than a rewrite of the grid.
 * Nothing about how the board is laid out changes here; the pinned storyboard hashes are
 * the check that says so, and they held when this landed.
 *
 * ## Why a cross-region share is now the common case
 *
 * It was rare when the only sharer was the morph, which annotates the beat immediately
 * before it and is therefore almost always in the same phase and the same region. The
 * referrals this file computes are not like that at all: `projects/cardiac8f` draws its
 * heart at beat 1 and refers to it again at beats 3 and 6, and `groupIntoRegions` breaks
 * at every phase boundary — setup, build, practice, recap — so beat 6 pointing at beat 1's
 * picture crosses two of them. The whole point of a referral is that the subject was
 * established a while ago; a mechanism that only worked for adjacent beats would refer
 * exactly where redrawing was cheapest and redraw exactly where it hurt.
 *
 * ## The camera
 *
 * Delegated to the host's own shot rather than recomputed, so the sharer sees precisely
 * the framing the host's picture was composed for — the zoom, the clamps against the
 * canvas edge, all of it — instead of an approximation of it assembled out here.
 *
 * The recap is the exception, and deliberately: it keeps its *own* camera. A recall recap
 * takes the host's cell so that it stops opening a fresh panel, but what it does there is
 * circle names spread across the entire board, and `cameraFor` gives a `recap` the widest
 * shot in the film for exactly that reason. Framing it on one cell would put most of what
 * it is pointing at off screen — the one failure mode worse than the panel it was opening.
 */
export function referTo(board: Board, shares: ReadonlyMap<number, number>): Board {
  if (shares.size === 0) return board;
  return {
    canvas: board.canvas,
    regions: board.regions,
    regionOf: (beat) => board.regionOf(hostOf(beat, shares) ?? beat),
    cellOf: (beat) => board.cellOf(hostOf(beat, shares) ?? beat),
    cameraFor: (beat, role) =>
      role === 'recap'
        ? board.cameraFor(beat, role)
        : board.cameraFor(hostOf(beat, shares) ?? beat, role),
  };
}

/**
 * Whether the recap redraws what the board already says, and whose cell it should take.
 *
 * The test is the names. A recap composes its picture on a blank authoring canvas, so its
 * marks cannot be aimed at anything already drawn — but the *names* it writes are exactly
 * the names the earlier beats wrote, and those are elements with ids and boxes. So the
 * recap does not draw its picture at all: it circles the names where they already are, in
 * its own order, and the camera's pull-back over the whole board is what makes that read
 * as a summary rather than as a new panel.
 *
 * Only under `accumulate`. Under `wipe` there is nothing behind the recap's card — every
 * name it would circle went out with the beat that wrote it — so it draws its picture
 * exactly as it does today. This is the one place where getting the mode wrong produces
 * the worst possible output: a beat pointing at blank paper for the length of the closing
 * hold, which is also the last thing a viewer sees.
 */
function findRecall(
  beats: readonly { step: LessonStep; role: BeatRole }[],
  board: BoardMode,
): Recall | null {
  if (board === 'wipe') return null;
  const at = beats.findIndex((b) => b.role === 'recap');
  if (at <= 0) return null;
  const mine = beats[at]!.step.visuals.flatMap((v) => namesWritten(v.marks));
  if (mine.length < RECALL_MIN) return null;

  /** `beat -> how many of the recap's names that beat has already written`. */
  const already = new Map<number, number>();
  const repeated: string[] = [];
  for (const name of mine) {
    let host: number | undefined;
    for (let i = 0; i < at && host === undefined; i++) {
      for (const v of beats[i]!.step.visuals) {
        if (namesWritten(v.marks).some((seen) => sameName(seen, name))) {
          host = i;
          break;
        }
      }
    }
    if (host === undefined) continue;
    repeated.push(name);
    already.set(host, (already.get(host) ?? 0) + 1);
  }
  if (repeated.length < RECALL_MIN || repeated.length * 2 < mine.length) return null;

  // The cell it takes is the one that named most of what it is recalling; ties go to the
  // earliest, which is the picture the lesson established first and therefore the one the
  // learner has looked at longest.
  let host = -1;
  let best = 0;
  for (const [beat, n] of [...already.entries()].sort((p, q) => p[0] - q[0])) {
    if (n > best) {
      best = n;
      host = beat;
    }
  }
  // A recall scattered across separate cells makes their labels unreadable.
  // Keep the author's compact recap drawing when no single host contains it.
  if (host < 0 || already.size > 1) return null;
  return { beat: at, host, names: repeated };
}
