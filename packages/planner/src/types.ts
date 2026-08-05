/**
 * Public types for the planner stage.
 *
 * `SourceDoc` is the ingest output and the plan input. It is deliberately
 * structural: headings and lists in the source are a free outline, and the
 * heuristic planner leans on them heavily.
 */
import type { Lesson, StageOptions } from '@inkcast/core';
import type { PresetName } from './presets.js';

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
    /** Project directory. When given, `lesson.json` is cached there. */
    dir?: string;
  };

export type CompileOptions = StageOptions &
  FormatOptions & {
    /** Storyboard title. Defaults to the lesson's topic. */
    title?: string;
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
