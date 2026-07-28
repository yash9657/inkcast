/**
 * Public types for the planner stage.
 *
 * `SourceDoc` is the ingest output and the plan input. It is deliberately
 * structural: headings and lists in the source are a free outline, and the
 * heuristic planner leans on them heavily.
 */
import type { StageOptions } from '@inkcast/core';

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

export type PlanOptions = StageOptions & {
  /**
   * Which planner to use. `auto` (the default) picks `anthropic` when
   * `ANTHROPIC_API_KEY` is set and `heuristic` otherwise.
   */
  adapter?: PlannerAdapter;
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
