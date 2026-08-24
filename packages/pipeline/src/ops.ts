/**
 * Storyboard edit operations.
 *
 * An edit is never "regenerate the video" — it is a small list of typed
 * operations applied to the storyboard JSON, then a cache-checked re-render.
 * Both edit paths funnel through `applyOps`:
 *
 *   - zero-key: `parseInstruction()` turns plain English into ops with regexes.
 *   - with a key: Claude turns plain English into the *same* ops via a tool call.
 *
 * That means the risky part (mutating the IR) is one deterministic, validated
 * code path no matter who produced the ops.
 */

import {
  critiqueStoryboard,
  cueWordIndex,
  parseStoryboard,
  type Camera,
  type Scene,
  type Storyboard,
  type StoryboardMeta,
} from '@inkcast/core';

/** A scene reference: `3` or `"3"` is the 1-based position, anything else an id. */
export type SceneRef = string | number;

export type EditOp =
  | { op: 'set-title'; title: string }
  | { op: 'set-meta'; meta: Partial<StoryboardMeta> }
  | { op: 'set-narration'; scene: SceneRef; text: string }
  | { op: 'delete-scene'; scene: SceneRef }
  | { op: 'insert-scene'; at: SceneRef | 'start' | 'end'; narration: string }
  | { op: 'move-scene'; scene: SceneRef; to: number }
  | {
      op: 'set-camera';
      scene: SceneRef;
      x?: number;
      y?: number;
      zoom?: number;
      transition?: number;
    }
  | { op: 'set-text'; elementId: string; text: string }
  | { op: 'delete-element'; elementId: string };

export class EditError extends Error {
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, opts);
    this.name = 'EditError';
  }
}

/* ------------------------------------------------------------------- schema */

/** JSON Schema for the ops list, used as Claude's tool `input_schema`. */
export const EDIT_OPS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ops'],
  properties: {
    ops: {
      type: 'array',
      description: 'The edits to apply, in order.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['op'],
        properties: {
          op: {
            type: 'string',
            enum: [
              'set-title',
              'set-meta',
              'set-narration',
              'delete-scene',
              'insert-scene',
              'move-scene',
              'set-camera',
              'set-text',
              'delete-element',
            ],
          },
          title: { type: 'string', description: 'set-title: the new video title.' },
          meta: {
            type: 'object',
            additionalProperties: false,
            description: 'set-meta: only the fields that change.',
            properties: {
              language: { type: 'string' },
              aspect: { type: 'string', enum: ['16:9', '9:16', '1:1'] },
              palette: { type: 'string', enum: ['mono', 'color'] },
              style: { type: 'string', enum: ['marker', 'pencil', 'chalk', 'ink'] },
              voice: { type: 'string' },
              fps: { type: 'number' },
              outroSec: { type: 'number' },
            },
          },
          scene: {
            type: 'string',
            description: 'Scene id, or a 1-based position as a string ("3").',
          },
          text: { type: 'string', description: 'set-narration / set-text: the new text.' },
          narration: { type: 'string', description: 'insert-scene: what the new scene says.' },
          at: {
            type: 'string',
            description: 'insert-scene: "start", "end", or the scene id/position to insert after.',
          },
          to: { type: 'number', description: 'move-scene: 1-based target position.' },
          x: { type: 'number' },
          y: { type: 'number' },
          zoom: { type: 'number' },
          transition: { type: 'number' },
          elementId: { type: 'string' },
        },
      },
    },
  },
} as const;

/* -------------------------------------------------------------- application */

export type ApplyResult = {
  storyboard: Storyboard;
  applied: string[];
  /**
   * What `critiqueStoryboard` says about the board the edit produced (plan 3.2).
   *
   * An edit is the one place a human hand reaches into the IR, and half of these ops
   * can dangle a reference by design: deleting a scene leaves every `persistUntil`
   * and every morph that named it pointing at nothing, moving one turns a morph into
   * a forward reference, and rewriting narration invalidates the cues of every
   * element in that scene. `delete-element` already sweeps up the emphasis elements
   * that would dangle, which is the whole class stated one op at a time — this is the
   * general answer, and it says so at edit time rather than as a render log line
   * about a move the film quietly no longer makes.
   *
   * Reported, not thrown: the edit is the user's, it is saved either way, and the
   * gate stage (3.1) is where a broken board stops a render.
   */
  problems: string[];
};

export function applyOps(input: Storyboard, ops: EditOp[]): ApplyResult {
  if (ops.length === 0) throw new EditError('no edits to apply');
  // Deep clone so a failed edit leaves the caller's storyboard untouched.
  const sb: Storyboard = JSON.parse(JSON.stringify(input)) as Storyboard;
  const applied: string[] = [];

  for (const op of ops) {
    switch (op.op) {
      case 'set-title': {
        const title = op.title.trim();
        if (!title) throw new EditError('set-title needs a non-empty title');
        applied.push(`title: "${sb.title}" -> "${title}"`);
        sb.title = title;
        break;
      }
      case 'set-meta': {
        const patch = stripUndefined(op.meta);
        const keys = Object.keys(patch);
        if (keys.length === 0) throw new EditError('set-meta had no fields');
        const revoice =
          ('voice' in patch && patch.voice !== sb.meta.voice) ||
          ('language' in patch && patch.language !== sb.meta.language);
        sb.meta = { ...sb.meta, ...patch };
        applied.push(keys.map((k) => `${k}=${String(patch[k as keyof typeof patch])}`).join(', '));
        // A new voice or language invalidates every measured duration.
        if (revoice) {
          for (const s of sb.scenes) clearAudio(s);
          applied.push('cleared measured audio (voice/language changed)');
        }
        break;
      }
      case 'set-narration': {
        const i = sceneIndex(sb, op.scene);
        const scene = sb.scenes[i]!;
        const text = op.text.trim();
        if (!text) throw new EditError(`scene ${scene.id}: narration cannot be empty`);
        clearAudio(scene);
        applied.push(`scene ${scene.id} narration -> "${truncate(text, 60)}"`);
        scene.narration = text;
        recueScene(scene, applied);
        break;
      }
      case 'delete-scene': {
        const i = sceneIndex(sb, op.scene);
        if (sb.scenes.length === 1) throw new EditError('cannot delete the only scene');
        const [gone] = sb.scenes.splice(i, 1);
        applied.push(`deleted scene ${gone!.id}`);
        break;
      }
      case 'insert-scene': {
        const narration = op.narration.trim();
        if (!narration) throw new EditError('insert-scene needs narration');
        const at =
          op.at === 'start' ? 0 : op.at === 'end' ? sb.scenes.length : sceneIndex(sb, op.at) + 1;
        const neighbour = sb.scenes[Math.max(0, at - 1)] ?? sb.scenes[0]!;
        const scene: Scene = {
          id: freshSceneId(sb),
          narration,
          camera: { ...(neighbour.camera as Camera) },
          elements: [],
          // Inherit the neighbour's silence: an inserted beat lands in the same
          // rhythm as the one it follows, rather than running straight into it.
          // `cadence` comes with it, and must: inheriting the hold alone would give
          // the new scene a considered pause and the global speech rate, which is
          // precisely the disagreement cadence exists to make impossible.
          hold: neighbour.hold,
          emphasis: [],
          ...(neighbour.cadence === undefined ? {} : { cadence: neighbour.cadence }),
          ...(neighbour.region === undefined ? {} : { region: neighbour.region }),
        };
        sb.scenes.splice(at, 0, scene);
        applied.push(`inserted scene ${scene.id} at position ${at + 1}`);
        break;
      }
      case 'move-scene': {
        const from = sceneIndex(sb, op.scene);
        const to = Math.min(Math.max(Math.round(op.to) - 1, 0), sb.scenes.length - 1);
        const [scene] = sb.scenes.splice(from, 1);
        sb.scenes.splice(to, 0, scene!);
        applied.push(`moved scene ${scene!.id} to position ${to + 1}`);
        break;
      }
      case 'set-camera': {
        const i = sceneIndex(sb, op.scene);
        const scene = sb.scenes[i]!;
        const next: Camera = { ...scene.camera };
        if (op.x !== undefined) next.x = op.x;
        if (op.y !== undefined) next.y = op.y;
        if (op.zoom !== undefined) next.zoom = Math.max(0.1, op.zoom);
        if (op.transition !== undefined) next.transition = Math.max(0, op.transition);
        scene.camera = next;
        applied.push(
          `scene ${scene.id} camera -> x=${next.x} y=${next.y} zoom=${round2(next.zoom)}`,
        );
        break;
      }
      case 'set-text': {
        const found = findElement(sb, op.elementId);
        if (found.el.type !== 'text') {
          throw new EditError(`element ${op.elementId} is a ${found.el.type}, not text`);
        }
        applied.push(`element ${op.elementId} text -> "${truncate(op.text, 60)}"`);
        found.el.text = op.text;
        break;
      }
      case 'delete-element': {
        const found = findElement(sb, op.elementId);
        const scene = sb.scenes[found.sceneIndex]!;
        scene.elements = scene.elements.filter((e) => e.id !== op.elementId);
        // Emphasis elements pointing at it would dangle.
        for (const s of sb.scenes) {
          s.elements = s.elements.filter(
            (e) => !(e.type === 'emphasis' && e.targetId === op.elementId),
          );
        }
        applied.push(`deleted element ${op.elementId} from scene ${scene.id}`);
        break;
      }
      default: {
        throw new EditError(`unknown operation "${(op as { op: string }).op}"`);
      }
    }
  }

  let storyboard: Storyboard;
  try {
    storyboard = parseStoryboard(sb);
  } catch (cause) {
    throw new EditError(
      `the edit produced an invalid storyboard: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  return { storyboard, applied, problems: critiqueStoryboard(storyboard) };
}

function clearAudio(scene: Scene): void {
  delete scene.audioPath;
  delete scene.durationSec;
  delete scene.words;
}

/**
 * Re-take every cue index in a scene whose narration just changed.
 *
 * `enter.cueWord` is an index into the *spoken* words of this scene's narration
 * (plan item 4.1), so rewriting the narration is exactly the event that makes it
 * false. Left alone it would be a number that still resolves and no longer means
 * anything — the voice stage would catch it, one minute of synthesis later, and
 * only because the cue phrase beside it disagrees.
 *
 * A cue that still occurs in the new text gets a fresh index and keeps its
 * word-exact placement; one that does not loses the index and falls to the phrase
 * search, which is what `critiqueStoryboard` already reports as a cue that names
 * words its scene no longer says. The edit is the user's and is applied either
 * way: this is bookkeeping, not judgement.
 */
function recueScene(scene: Scene, applied: string[]): void {
  let moved = 0;
  let lost = 0;
  for (const el of scene.elements) {
    if (!el.enter.cue?.trim()) {
      if (el.enter.cueWord !== undefined) delete el.enter.cueWord;
      continue;
    }
    const at = cueWordIndex(scene.narration, el.enter.cue);
    if (at === undefined) {
      if (el.enter.cueWord !== undefined) lost++;
      delete el.enter.cueWord;
      continue;
    }
    if (el.enter.cueWord !== at) moved++;
    el.enter.cueWord = at;
  }
  if (moved || lost) {
    applied.push(
      `re-cued scene ${scene.id}: ${moved} cue index/indices moved` +
        (lost ? `, ${lost} dropped (the cue is not in the new narration)` : ''),
    );
  }
}

function sceneIndex(sb: Storyboard, ref: SceneRef): number {
  const byId = sb.scenes.findIndex((s) => s.id === String(ref));
  if (byId >= 0) return byId;
  const n = Number(ref);
  if (Number.isInteger(n) && n >= 1 && n <= sb.scenes.length) return n - 1;
  throw new EditError(
    `no scene "${String(ref)}" — this storyboard has ${sb.scenes.length} scenes (${sb.scenes
      .map((s) => s.id)
      .join(', ')})`,
  );
}

function findElement(sb: Storyboard, id: string) {
  for (let i = 0; i < sb.scenes.length; i++) {
    const el = sb.scenes[i]!.elements.find((e) => e.id === id);
    if (el) return { el, sceneIndex: i };
  }
  throw new EditError(`no element with id "${id}"`);
}

function freshSceneId(sb: Storyboard): string {
  const used = new Set(sb.scenes.map((s) => s.id));
  for (let n = sb.scenes.length + 1; ; n++) {
    const id = `scene-${String(n).padStart(3, '0')}`;
    if (!used.has(id)) return id;
  }
}

/* ---------------------------------------------------- plain-English parsing */

const LANGUAGES: Record<string, string> = {
  english: 'en',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  italian: 'it',
  portuguese: 'pt',
  dutch: 'nl',
  hindi: 'hi',
  japanese: 'ja',
  korean: 'ko',
  chinese: 'zh',
  mandarin: 'zh',
  arabic: 'ar',
  polish: 'pl',
  turkish: 'tr',
  russian: 'ru',
};

/**
 * Turn an instruction into ops without any model. This is the zero-key edit
 * path, so it has to be genuinely useful rather than a token gesture: it covers
 * every field a user actually asks to change. Unrecognised instructions throw
 * with the list of things it does understand.
 *
 * Instructions may be chained with `;` or newlines. A raw JSON ops array or
 * `{"ops": [...]}` is also accepted, which is how power users script edits.
 */
export function parseInstruction(sb: Storyboard, instruction: string): EditOp[] {
  const raw = instruction.trim();
  if (!raw) throw new EditError('empty instruction');

  const asJson = tryJsonOps(raw);
  if (asJson) return asJson;

  const ops: EditOp[] = [];
  const clauses = raw
    .split(/;|\n/)
    .map((c) => c.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const parsed = parseClause(sb, clause);
    if (parsed.length === 0) {
      throw new EditError(`could not understand "${truncate(clause, 60)}".\n${USAGE_HINT}`);
    }
    ops.push(...parsed);
  }
  return ops;
}

const USAGE_HINT = `Without an ANTHROPIC_API_KEY, edits are matched against these patterns:
  title: <text>                     |  rename to <text>
  scene 3 narration: <text>         |  rewrite the narration of scene 3 to <text>
  add a scene after scene 2: <text> |  add a scene at the end: <text>
  delete scene 4                    |  move scene 4 to position 2
  voice: am_puck                    |  language: es   (or "translate it into Spanish")
  style: pencil                     |  palette: mono  ("make it black and white")
  aspect: 9:16                       ("make it vertical" / "square")
  zoom in on scene 2                |  outro: 2s        |  30 fps
  element <id> text: <text>         |  delete element <id>
Set ANTHROPIC_API_KEY for free-form edits, or pass a JSON ops array.`;

export { USAGE_HINT as EDIT_USAGE_HINT };

function parseClause(sb: Storyboard, clause: string): EditOp[] {
  const s = clause.trim();
  const l = s.toLowerCase();
  const ops: EditOp[] = [];

  // --- title
  let m =
    /^(?:set\s+(?:the\s+)?title\s+(?:to|=)\s*|title\s*[:=]\s*|rename\s+(?:it|this)?\s*to\s+|call\s+it\s+)(.+)$/i.exec(
      s,
    );
  if (m) return [{ op: 'set-title', title: unquote(m[1]!) }];

  // --- narration of an existing scene
  m =
    /\bscene\s+(\S+?)\s*(?:'s)?\s*narration\s*(?:to|=|:)\s*(.+)$/i.exec(s) ??
    /\b(?:change|set|replace|rewrite|reword)\s+(?:the\s+)?narration\s+(?:of|for|in|on)\s+scene\s+(\S+)\s+(?:to|with|so it says)\s*(.+)$/i.exec(
      s,
    ) ??
    /\bscene\s+(\S+?)\s+(?:should\s+say|says)\s*(.+)$/i.exec(s);
  if (m) return [{ op: 'set-narration', scene: cleanRef(m[1]!), text: unquote(m[2]!) }];

  // --- insert a scene
  m =
    /\b(?:add|insert)\s+(?:a\s+)?(?:new\s+)?scene\s+(?:(?:right\s+)?after\s+scene\s+(\S+?)|at\s+the\s+(start|beginning|end)|(?:right\s+)?before\s+scene\s+(\S+?))?\s*(?:that\s+says|saying|with\s+narration|:|,)\s*[:,]?\s*(.+)$/i.exec(
      s,
    );
  if (m) {
    const narration = unquote(m[4]!);
    if (m[1]) return [{ op: 'insert-scene', at: cleanRef(m[1]), narration }];
    if (m[3]) {
      const i = sceneIndex(sb, cleanRef(m[3]));
      return [{ op: 'insert-scene', at: i === 0 ? 'start' : sb.scenes[i - 1]!.id, narration }];
    }
    const where = (m[2] ?? 'end').toLowerCase();
    return [{ op: 'insert-scene', at: where === 'end' ? 'end' : 'start', narration }];
  }

  // --- delete / move scenes
  m = /\b(?:delete|remove|drop|cut)\s+scene\s+(\S+)/i.exec(s);
  if (m) return [{ op: 'delete-scene', scene: cleanRef(m[1]!) }];

  m =
    /\bmove\s+scene\s+(\S+?)\s+(?:to\s+(?:position\s+)?(\d+)|to\s+the\s+(start|beginning|end)|before\s+scene\s+(\S+)|after\s+scene\s+(\S+))/i.exec(
      s,
    );
  if (m) {
    const ref = cleanRef(m[1]!);
    if (m[2]) return [{ op: 'move-scene', scene: ref, to: Number(m[2]) }];
    if (m[3]) {
      return [
        { op: 'move-scene', scene: ref, to: m[3].toLowerCase() === 'end' ? sb.scenes.length : 1 },
      ];
    }
    if (m[4]) return [{ op: 'move-scene', scene: ref, to: sceneIndex(sb, cleanRef(m[4])) + 1 }];
    if (m[5]) return [{ op: 'move-scene', scene: ref, to: sceneIndex(sb, cleanRef(m[5])) + 2 }];
  }

  // --- elements
  m = /\belement\s+(\S+?)\s*(?:'s)?\s*text\s*(?:to|=|:)\s*(.+)$/i.exec(s);
  if (m) return [{ op: 'set-text', elementId: cleanRef(m[1]!), text: unquote(m[2]!) }];

  m = /\b(?:delete|remove|drop)\s+element\s+(\S+)/i.exec(s);
  if (m) return [{ op: 'delete-element', elementId: cleanRef(m[1]!) }];

  // --- camera
  m = /\bzoom\s+(in|out)(?:\s+(?:on|into)?\s*scene\s+(\S+))?/i.exec(s);
  if (m) {
    const factor = m[1]!.toLowerCase() === 'in' ? 1.25 : 0.8;
    const refs = m[2] ? [cleanRef(m[2])] : sb.scenes.map((sc) => sc.id);
    return refs.map((ref): EditOp => {
      const scene = sb.scenes[sceneIndex(sb, ref)]!;
      return { op: 'set-camera', scene: ref, zoom: round2(scene.camera.zoom * factor) };
    });
  }

  // --- meta, which can appear several at a time in one clause
  const meta: Partial<StoryboardMeta> = {};

  m = /\bvoice\s*(?:to|=|:)\s*([\w:.-]+)/i.exec(s);
  if (m) meta.voice = m[1]!;

  m = /\b(16:9|9:16|1:1)\b/.exec(s);
  if (m) meta.aspect = m[1] as StoryboardMeta['aspect'];
  else if (/\b(vertical|portrait|tiktok|reels?|shorts?)\b/i.test(l)) meta.aspect = '9:16';
  else if (/\bsquare\b/i.test(l)) meta.aspect = '1:1';
  else if (/\b(landscape|widescreen|youtube)\b/i.test(l)) meta.aspect = '16:9';

  m =
    /\bstyle\s*(?:to|=|:)\s*(marker|pencil|chalk|ink)\b/i.exec(s) ??
    /\b(?:use|switch\s+to|make\s+it|draw\s+it\s+in|redraw\s+it\s+in|in)\s+(marker|pencil|chalk|ink)\b/i.exec(
      s,
    ) ??
    /\b(marker|pencil|chalk|ink)\s+style\b/i.exec(s);
  if (m) meta.style = m[1]!.toLowerCase() as StoryboardMeta['style'];

  if (/\b(mono|monochrome|black\s*(?:and|&)\s*white|b&w|gr[ae]yscale)\b/i.test(l)) {
    meta.palette = 'mono';
  } else if (
    /\b(colou?rful|full\s+colou?r|in\s+colou?r|colou?r\s+palette|palette\s*[:=]\s*colou?r)\b/i.test(
      l,
    )
  ) {
    meta.palette = 'color';
  }

  m = /\blanguage\s*(?:to|=|:)\s*([a-z]{2}(?:-[a-z]{2})?)\b/i.exec(s);
  if (m) meta.language = m[1]!.toLowerCase();
  else {
    m = /\b(?:translate|re-?voice|say|narrate)\b.*?\b(?:in|into|to)\s+([a-z]+)\b/i.exec(s);
    const named = m ? LANGUAGES[m[1]!.toLowerCase()] : undefined;
    if (named) meta.language = named;
  }

  m = /\b(\d{1,3})\s*fps\b/i.exec(s);
  if (m) meta.fps = Number(m[1]);

  m = /\boutro\s*(?:to|=|:)?\s*(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)?\b/i.exec(s);
  if (m) meta.outroSec = Number(m[1]);

  if (Object.keys(meta).length > 0) ops.push({ op: 'set-meta', meta });
  return ops;
}

function tryJsonOps(raw: string): EditOp[] | undefined {
  if (!raw.startsWith('{') && !raw.startsWith('[')) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return coerceOps(parsed);
  } catch {
    return undefined;
  }
}

/** Accept `[ops]`, `{ops:[...]}` or a single op object; validate the `op` tag. */
export function coerceOps(input: unknown): EditOp[] {
  const list = Array.isArray(input)
    ? input
    : isRecord(input) && Array.isArray(input.ops)
      ? input.ops
      : isRecord(input) && typeof input.op === 'string'
        ? [input]
        : undefined;
  if (!list) throw new EditError('expected an array of edit operations');
  const known = new Set(
    EDIT_OPS_SCHEMA.properties.ops.items.properties.op.enum as readonly string[],
  );
  return list.map((entry) => {
    if (!isRecord(entry) || typeof entry.op !== 'string' || !known.has(entry.op)) {
      throw new EditError(`not a valid edit operation: ${JSON.stringify(entry)}`);
    }
    return entry as unknown as EditOp;
  });
}

/* ------------------------------------------------------------------- helpers */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Clean up the tail of a clause. Leading `:` / `,` left over from a separator
 * goes; surrounding quotes go; the final full stop **stays**, because this text
 * is usually narration and narration is spoken.
 */
function unquote(s: string): string {
  const t = s.trim().replace(/^[:,]+\s*/, '');
  const m = /^(["'`])([\s\S]*)\1$/.exec(t);
  return (m ? m[2]! : t).trim();
}

/** Strip trailing punctuation people type after ids: `scene 3,` -> `3`. */
function cleanRef(s: string): string {
  return s
    .trim()
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/[.,:;]$/, '');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
