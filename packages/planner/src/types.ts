/**
 * Public types for the planner stage.
 *
 * `SourceDoc` is the ingest output and the plan input. It is deliberately
 * structural: headings and lists in the source are a free outline, and the
 * heuristic planner leans on them heavily.
 */
import type { BoardMode, Lesson, Mark, StageOptions } from '@inkcast/core';
import type { PresetName } from './presets.js';

/**
 * Renders a drawing as the board will draw it, so the model that composed it can look.
 *
 * The seam exists because of the package graph, and it is worth stating why rather than
 * routing around it. Rendering means roughjs, real font metrics and Chromium — the visuals
 * and render stages — and the planner depends on neither and must not start: the planner
 * is the stage that has to work with no browser installed at all. So the caller that
 * already has a renderer passes one in, exactly as `illustrations` is how the caller tells
 * the lesson stage that an image provider exists.
 *
 * Returns `undefined` when a picture cannot be produced. That is never an error — a
 * drawing revised without a render is weaker, not broken.
 */
export type DrawPreview = (
  marks: Mark[],
  /**
   * `underlay: true` renders the marks against the whole authoring canvas instead of
   * fitting them to their own content bounds — the fit an annotated drawing gets on the
   * real board. Without it the preview shown to the critic is in a different coordinate
   * space from the picture the marks are annotating, and the two cannot be read together.
   */
  opts?: { underlay?: boolean },
) => Promise<Uint8Array | undefined>;

/**
 * Generates the picture a drawing will be composed **on top of**, and says where it lands.
 *
 * The hybrid lane (`./underlay.ts`): an image for a real object's form, composed marks for
 * its parts and their names. Same seam and the same reasoning as `DrawPreview` above —
 * generating means an image provider, tracing means the vectoriser, and the planner
 * depends on neither. The caller that already has both passes one in.
 *
 * `png` is the board **as the author will be shown it**: the traced ink of the generated
 * image, drawn at `inkBox` on a blank `DRAW_W`x`DRAW_H` canvas. Not the raw raster. That
 * costs one screenshot and buys the only thing that makes the lane work — the author is
 * looking at the same coordinate space it is placing marks in, so "the SA node is high in
 * the right atrium" is a reading of the picture rather than a guess about one.
 *
 * `inkBox` is `[x, y, w, h]` in that canvas's units, and is recorded in the lesson so the
 * compiler can put the image back exactly there without a key or a network.
 *
 * `undefined` whenever a picture cannot be produced — no image key, no vectoriser, a
 * provider error. Never an error: the beat falls back to marks alone, which is the drawing
 * this lane has always made.
 */
export type DrawUnderlay = (
  prompt: string,
) => Promise<{ png: Uint8Array; inkBox: number[] } | undefined>;

/** One heading and the body text that belongs to it. */
export type SourceSection = {
  /** Heading text. `''` for the implicit preamble before the first heading. */
  heading: string;
  /** 1 = `#`, 2 = `##`, … The preamble is level 0. */
  level: number;
  /** Body text under this heading, excluding nested subsection bodies. */
  text: string;
};

/** An image referenced by the source document. */
export type SourceImage = {
  /** Stable slug usable as an `Asset.id`. */
  id: string;
  /** Alt text / caption, used as the generation prompt. */
  description: string;
  /** Absolute path or URL as written in the source. */
  href: string;
};

export type SourceKind = 'text' | 'markdown' | 'txt' | 'pdf' | 'docx' | 'url' | 'html';

export type SourceDoc = {
  title: string;
  /** Normalised markdown-ish plain text of the whole document. */
  text: string;
  sections: SourceSection[];
  images?: SourceImage[];
  /** Where this came from, for cache keys and attribution. */
  origin?: { kind: SourceKind; ref?: string };
};

export type IngestInput = {
  /** Raw text or markdown. */
  text?: string;
  /** Path to a `.md`, `.txt`, `.pdf` or `.docx` file. */
  filePath?: string;
  /** `http(s)` URL of an article. */
  url?: string;
};

export type PlannerAdapter = 'auto' | 'anthropic' | 'heuristic';

/** What the lesson stage will teach: a document, or a bare topic to teach cold. */
export type LessonInput = SourceDoc | string;

/**
 * Options shared by everything that turns a lesson into pictures.
 *
 * `preset` is the output format (see `./presets.ts`); an explicit `aspect` always
 * wins over the preset's own, so `--vertical` on a standard plan still works.
 */
export type FormatOptions = {
  preset?: PresetName;
  aspect?: '16:9' | '9:16' | '1:1';
  palette?: 'mono' | 'color';
  style?: 'marker' | 'pencil' | 'chalk' | 'ink';
  voice?: string;
  language?: string;
  fps?: number;
  /** Target runtime. Overrides the preset, and is what the critique measures. */
  maxSeconds?: number;
  /**
   * Target words spoken per second. Default 2.5 (≈150 wpm), the teaching pace
   * from `docs/LESSON-ENGINE.md` rather than the summariser's dump-and-move-on.
   */
  wordsPerSecond?: number;
};

export type LessonOptions = StageOptions &
  FormatOptions & {
    /**
     * Which lesson author to use. `auto` (the default) picks `anthropic` when
     * `ANTHROPIC_API_KEY` is set and `heuristic` otherwise. The heuristic author
     * is honest but limited — it can only reorganise what the document says.
     */
    adapter?: PlannerAdapter;
    /** Claude model id for the anthropic adapter. */
    model?: string;
    /** Who the lesson is pitched at. Drives vocabulary and what is assumed. */
    audience?: string;
    /** What the learner must be able to DO afterwards. The acceptance test. */
    objective?: string;
    /** Extra direction for the lesson author (tone, emphasis, constraints). */
    brief?: string;
    /**
     * Whether an image generator is configured, so the brief may offer `illustration`.
     *
     * The lesson stage has to know, and cannot find out for itself: detection lives in
     * `@inkcast/visuals`, which the planner does not depend on and should not start. The
     * caller that already resolved the provider passes it down.
     *
     * Offering a lane that is not there is the failure this closes. Without a key an
     * `illustration` degrades to the icon set and then to a lettered card, so telling the
     * model to ask for one would trade a matched icon for a letter in a box — which is why
     * the brief stayed silent about the lane and, on a keyed run, kept steering every
     * concrete object to `icon`. Same principle as the generated cast pose: do not offer
     * what may not exist.
     */
    illustrations?: boolean;
    /** Claude model id for the drawing author. Overrides `INKCAST_DRAW_MODEL`. */
    drawModel?: string;
    /**
     * How to render a drawing so the drawing author can be shown its own work.
     *
     * Supplied by whoever has a renderer — in practice `@inkcast/pipeline`. Without it the
     * correction pass still runs, from the measurements alone, which is weaker.
     */
    drawPreview?: DrawPreview;
    /**
     * How to generate the picture a drawing is composed on top of, for an intent that
     * asks for one. Without it an `underlay` is ignored and the beat is drawn in marks
     * alone — see `DrawUnderlay`.
     */
    drawUnderlay?: DrawUnderlay;
    /**
     * Whether a drawing with something measurably wrong with it gets a correction call.
     * Default `true`; `INKCAST_DRAW_FIX=0` turns it off for a whole run.
     */
    reviseDrawings?: boolean;
    /** Project directory. When given, `lesson.json` is cached there. */
    dir?: string;
  };

export type CompileOptions = StageOptions &
  FormatOptions & {
    /** Storyboard title. Defaults to the lesson's topic. */
    title?: string;
    /**
     * What the board does between beats — `accumulate` (the default) or `wipe`.
     *
     * Here rather than on `FormatOptions` above, and the distinction is load-bearing:
     * `FormatOptions` is shared with the lesson stage and with the document planners,
     * which compose their own boards and would take the option and ignore it. This bag
     * belongs to `compileLesson`, the one function that can honour it — offering a lane
     * that is not there is the failure this repo keeps paying for.
     */
    board?: BoardMode;
  };

/** What an edit to a lesson actually did. */
export type LessonEditReport = {
  applied: string[];
  /** Instructions understood but needing a model to carry out. */
  needsKey: string[];
  /** Instructions not understood at all. */
  unsupported: string[];
  /** Problems `critiqueLesson` still reports about the edited lesson. */
  problems: string[];
};

export type PlanOptions = StageOptions & {
  /**
   * Which planner to use. `auto` (the default) picks `anthropic` when
   * `ANTHROPIC_API_KEY` is set and `heuristic` otherwise.
   */
  adapter?: PlannerAdapter;
  /**
   * How to get from a document to a storyboard.
   *
   * `lesson` (the default) runs the pedagogy stage: ingest → lesson → storyboard.
   * `document` is the MVP's summarising path, kept because it is the zero-key CI
   * fixture the renderer is tested against — it is not the recommended route to a
   * watchable video.
   */
  via?: 'lesson' | 'document';
  /** Use this lesson instead of writing one: a `Lesson`, or a path to its JSON. */
  lesson?: Lesson | string;
  /** Output format preset. See `./presets.ts`. */
  preset?: PresetName;
  /** Passed through to the lesson stage. */
  audience?: string;
  objective?: string;
  maxSeconds?: number;
  /** Storyboard title. Defaults to the lesson's topic (or the document's). */
  title?: string;
  /** Claude model id for the anthropic adapter. Default `claude-opus-5`. */
  model?: string;
  /** Overrides for `storyboard.meta`. */
  aspect?: '16:9' | '9:16' | '1:1';
  palette?: 'mono' | 'color';
  style?: 'marker' | 'pencil' | 'chalk' | 'ink';
  voice?: string;
  language?: string;
  fps?: number;
  /** Hard cap on scene count. Default 24. */
  maxScenes?: number;
  /**
   * What the board does between beats — `accumulate` (the default) or `wipe`.
   *
   * Honoured on `via: 'lesson'`, which compiles through `compileLesson`, and stated
   * here so the option is reachable from the one other entry point that ends in a
   * storyboard. `via: 'document'` ignores it, as it ignores `audience` and `brief`:
   * the document planners compose their own boards. `plan()` hashes it into the
   * planner's own cache key for the reason `@inkcast/pipeline`'s `keys.ts` gives —
   * an option that changes the artefact and not the key is served from the cache of
   * the mode you did not ask for.
   */
  board?: BoardMode;
  /**
   * Target words spoken per second, used to size narration so scenes land in
   * the 4–12 second window. Default 2.6 (≈156 wpm, unhurried explainer pace).
   */
  wordsPerSecond?: number;
  /** Extra instruction passed to the anthropic adapter (tone, audience, …). */
  brief?: string;
  /**
   * Project directory. When given, the planner caches `storyboard.json` there
   * and skips work when the inputs are unchanged (see `@inkcast/core`).
   */
  dir?: string;
  /**
   * Re-run the planner's own layout engine over the result. Always on for the
   * heuristic planner; for LLM output it keeps the model's creative choices but
   * guarantees non-overlapping placement and a coherent camera tour.
   * Default `true`.
   */
  relayout?: boolean;
};

export type EditOptions = StageOptions & {
  adapter?: PlannerAdapter;
  model?: string;
  relayout?: boolean;
};

/** What an edit actually did — surfaced so the UI can tell the user. */
export type EditReport = {
  applied: string[];
  /** Instructions that were understood but need an LLM to carry out. */
  needsKey: string[];
  /** Instructions that were not understood at all. */
  unsupported: string[];
};
