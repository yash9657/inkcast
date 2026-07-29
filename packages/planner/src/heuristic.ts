/**
 * The heuristic planner — the default, zero-API-key path.
 *
 * It is not a placeholder for an LLM: it reads the document's structure, picks a
 * visual form per beat, writes spoken narration from the source sentences, wires
 * up asset references from the built-in icon vocabulary, and hands the whole
 * thing to the layout engine for placement and camera work.
 *
 * Everything is deterministic: same document in, byte-identical storyboard out.
 */
import type { Asset, Element, Scene, Storyboard } from '@inkcast/core';
import { logger, parseStoryboard, report } from '@inkcast/core';
import type { Beat } from './beats.js';
import { buildBeats } from './beats.js';
import {
  makeAsset,
  makeDiagram,
  makeEmphasis,
  makeShape,
  makeText,
  measureText,
} from './elements.js';
import { matchIcons } from './icons.js';
import type { Hints, PlacementHint } from './layout.js';
import { layoutStoryboard } from './layout.js';
import { composeItems, writeNarration } from './narration.js';
import { estimateDurationSec, shorten, stripMarkdown, wordCount } from './text.js';
import type { PlanOptions, SourceDoc } from './types.js';

const log = logger('planner:heuristic');

/** Scene-length guard rails, in seconds. */
const MIN_SCENE_SEC = 3.5;
const MAX_SCENE_SEC = 12;

/* ------------------------------------------------------------------ assets */

type Registry = {
  use(slug: string, prompt: string): string;
  list(): Asset[];
};

function registry(): Registry {
  const map = new Map<string, Asset>();
  return {
    use(slug, prompt) {
      const existing = map.get(slug);
      if (existing) return existing.id;
      map.set(slug, {
        id: slug,
        kind: 'icon',
        prompt,
        seed: seedOf(slug),
        source: 'builtin',
      });
      return slug;
    },
    list: () => [...map.values()],
  };
}

/** Stable 31-bit seed from a slug, so regeneration is visually identical. */
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 2147483647;
}

/* ------------------------------------------------------------------- plan */

export function heuristicPlan(doc: SourceDoc, opts: PlanOptions = {}): Storyboard {
  const wps = opts.wordsPerSecond ?? 2.6;
  const maxWords = Math.round(clamp(wps * 10.5, 18, 34));
  const minWords = Math.round(clamp(wps * 4.5, 9, 16));
  const maxScenes = opts.maxScenes ?? 24;

  report(opts, { stage: 'plan', pct: 5, note: 'detecting beats' });
  const beats = trimBeats(buildBeats(doc, { maxWords, minWords }), maxScenes);
  log.info(`planned ${beats.length} beats`, { shapes: beats.map((b) => b.shape).join(',') });

  const assets = registry();
  const used = new Set<string>();
  const scenes: Scene[] = [];
  const hints: Hints = {};
  let prevSlots: Record<string, string> = {};
  let lastIcon = '';

  beats.forEach((beat, i) => {
    report(opts, {
      stage: 'plan',
      pct: 10 + Math.round((i / Math.max(1, beats.length)) * 70),
      note: `scene ${i + 1}/${beats.length} (${beat.shape})`,
    });
    const built = buildScene(beat, i, doc, {
      assets,
      used,
      prevSlots,
      lastIcon,
      maxWords,
      minWords,
      wps,
    });
    if (!built) return;
    Object.assign(hints, built.hints);
    scenes.push(built.scene);
    prevSlots = built.slots;
    lastIcon = built.icon ?? lastIcon;
  });

  if (!scenes.length) {
    // A document with no usable prose still deserves a video.
    const narration = writeNarration(doc.text || doc.title, { maxWords, minWords });
    const title = makeText('e0_title', doc.title, 'title', { align: 'center' });
    hints[title.id] = { span: 'full' };
    scenes.push({
      id: 's0',
      narration: narration || `${doc.title}.`,
      camera: { x: 0, y: 0, zoom: 1, transition: 0 },
      elements: [title],
      hold: 0,
    });
  }

  report(opts, { stage: 'plan', pct: 85, note: 'layout + camera' });
  const draft: Storyboard = {
    version: 1,
    title: doc.title,
    meta: {
      language: opts.language ?? 'en',
      aspect: opts.aspect ?? '16:9',
      palette: opts.palette ?? 'color',
      fps: opts.fps ?? 30,
      style: opts.style ?? 'marker',
      voice: opts.voice ?? 'af_heart',
      outroSec: 1.2,
    },
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    assets: assets.list(),
    scenes,
  };

  const laid = layoutStoryboard(draft, { aspect: draft.meta.aspect, hints });
  report(opts, { stage: 'plan', pct: 100, note: `${laid.scenes.length} scenes` });
  return parseStoryboard(laid);
}

/* --------------------------------------------------------------- one scene */

type BuildCtx = {
  assets: Registry;
  prevSlots: Record<string, string>;
  lastIcon: string;
  /** Strings already drawn on the canvas, so nothing is written twice. */
  used: Set<string>;
  maxWords: number;
  minWords: number;
  wps: number;
};

type Built = {
  scene: Scene;
  hints: Hints;
  slots: Record<string, string>;
  icon?: string;
};

function buildScene(beat: Beat, index: number, doc: SourceDoc, ctx: BuildCtx): Built | undefined {
  const sid = `s${index}`;
  const eid = (n: string) => `e${index}_${n}`;
  const elements: Element[] = [];
  const hints: Hints = {};
  const slots: Record<string, string> = {};
  const add = (el: Element, hint: PlacementHint = {}, slot?: string) => {
    elements.push(el);
    hints[el.id] = hint;
    if (slot) slots[slot] = el.id;
    return el.id;
  };

  // Lists and step sequences narrate every item in order, so the spoken track
  // and the diagram on the board stay in lockstep. Everything else is written
  // from the source sentences.
  const narration =
    (beat.shape === 'list' || beat.shape === 'steps') && beat.items?.length
      ? // A list beat must name every item on the board, so it gets a little
        // more room than a prose beat before items are trimmed.
        composeItems(beat.items, beat.shape === 'steps', beat.lead, Math.round(ctx.maxWords * 1.2))
      : writeNarration(beat.source, {
          index,
          maxWords: ctx.maxWords,
          minWords: ctx.minWords,
        });
  if (!narration.trim()) return undefined;

  /** True when this heading is already drawn somewhere on the board. */
  const headingShown = beat.heading !== '' && ctx.used.has(beat.heading);
  const useHeading = (text: string) => {
    ctx.used.add(text);
    return text;
  };

  // Pick an icon for the concrete nouns in this beat, but only register it in the
  // asset library at the moment an element actually references it — an
  // unreferenced asset would make the visuals stage draw something nobody sees.
  const wantsIcon = ['title', 'section', 'statement', 'quote', 'code', 'definition'].includes(
    beat.shape,
  );
  const matches = wantsIcon ? matchIcons(`${beat.heading} ${beat.source}`, 2) : [];
  const iconPick = matches.find((m) => m.slug !== ctx.lastIcon) ?? matches[0];
  const iconId = (): string | undefined =>
    iconPick ? ctx.assets.use(iconPick.slug, iconPick.prompt) : undefined;

  switch (beat.shape) {
    case 'title': {
      const t = add(
        makeText(eid('title'), doc.title, 'title', { align: 'center' }),
        { span: 'full' },
        'anchor',
      );
      add(makeShape(eid('rule'), 'underline', 620, 14), { below: t, span: 'full' });
      const sub = subtitleOf(beat.source, doc.title);
      if (sub)
        add(
          makeText(eid('sub'), sub, 'body', { align: 'center' }),
          { below: t, span: 'full' },
          'sub',
        );
      const ic = iconId();
      if (ic) add(makeAsset(eid('icon'), ic, 260), { breakBefore: true, span: 'block' }, 'icon');
      break;
    }

    case 'section': {
      const label = useHeading(beat.heading || doc.title);
      const h = add(makeText(eid('head'), label, 'heading'), { span: 'full' }, 'anchor');
      add(makeShape(eid('rule'), 'underline', 420, 12), { below: h, span: 'full' });
      const point = keyPhrase(beat.source, beat.heading, 12);
      if (point && !echoes(point, label)) {
        add(makeText(eid('point'), point, 'body'), { breakBefore: true, span: 'half' }, 'point');
      }
      const ic = iconId();
      if (ic) add(makeAsset(eid('icon'), ic, 220), { span: 'block' }, 'icon');
      break;
    }

    case 'definition': {
      const term = add(
        makeText(eid('term'), beat.term ?? beat.heading, 'heading'),
        { span: 'full' },
        'term',
      );
      add(makeShape(eid('rule'), 'underline', 380, 12), { below: term, span: 'full' });
      if (beat.definition) {
        add(
          makeText(eid('def'), beat.definition, 'body'),
          { below: term, span: 'full' },
          'definition',
        );
      }
      const ic = iconId();
      if (ic) add(makeAsset(eid('icon'), ic, 220), { breakBefore: true, span: 'block' }, 'icon');
      break;
    }

    case 'list': {
      const nodes = (beat.items ?? []).map((label, k) => ({ id: `n${k}`, label }));
      if (!nodes.length) return undefined;
      const lead = pickLead(ctx, beat.lead ?? '', headingShown);
      if (lead) add(makeText(eid('lead'), shorten(lead, 6), 'heading'), { span: 'full' }, 'anchor');
      add(makeDiagram(eid('stack'), 'stack', nodes), { span: 'full', breakBefore: true }, 'figure');
      break;
    }

    case 'steps': {
      const items = beat.items ?? [];
      if (!items.length) return undefined;
      const lead = pickLead(
        ctx,
        headingShown ? 'Step by step' : (beat.lead ?? 'Step by step'),
        false,
      );
      if (lead) add(makeText(eid('lead'), shorten(lead, 6), 'heading'), { span: 'full' }, 'anchor');
      const nodes = items.map((label, k) => ({ id: `n${k}`, label }));
      const edges = nodes.slice(1).map((n, k) => ({ from: nodes[k]!.id, to: n.id }));
      add(
        makeDiagram(eid('flow'), 'flow', nodes, edges),
        { span: 'full', breakBefore: true },
        'figure',
      );
      break;
    }

    case 'comparison': {
      const panels = beat.panels;
      if (!panels) return undefined;
      const head = pickLead(ctx, beat.heading || keyPhrase(beat.source, '', 8), headingShown);
      if (head) add(makeText(eid('head'), head, 'heading'), { span: 'full' }, 'anchor');
      const [a, b] = panels;
      add(
        makeDiagram(eid('left'), 'stack', [
          { id: 'a0', label: a.title || 'One way' },
          { id: 'a1', label: a.point },
        ]),
        { span: 'half', breakBefore: true },
        'panelA',
      );
      add(
        makeDiagram(eid('right'), 'stack', [
          { id: 'b0', label: b.title || 'The other' },
          { id: 'b1', label: b.point },
        ]),
        { span: 'half' },
        'panelB',
      );
      break;
    }

    case 'numbers': {
      const all = (beat.facts ?? []).slice(0, 3);
      // Only put a figure on the board if the narration actually says it.
      const spoken = all.filter((f) => saysNumber(narration, f.value));
      const facts = spoken.length ? spoken : all.slice(0, 1);
      if (!facts.length) return undefined;
      const head = pickLead(ctx, beat.heading || keyPhrase(beat.source, '', 8), headingShown);
      if (head) add(makeText(eid('head'), head, 'heading'), { span: 'full' }, 'anchor');
      const span = facts.length >= 3 ? 'third' : facts.length === 2 ? 'half' : 'block';
      facts.forEach((f, k) => {
        const v = add(
          makeText(eid(`v${k}`), f.value, 'title', { align: 'center' }),
          { span, breakBefore: k === 0 },
          k === 0 ? 'figure' : undefined,
        );
        add(makeText(eid(`l${k}`), f.label, 'label', { align: 'center' }), { below: v, span });
      });
      break;
    }

    case 'quote': {
      const q = add(
        makeText(eid('quote'), `“${shorten(beat.source, 26)}”`, 'body'),
        { span: 'full' },
        'anchor',
      );
      add(makeShape(eid('bracket'), 'bracket', 480, 26), { below: q, span: 'full' });
      const ic = iconId();
      if (ic) add(makeAsset(eid('icon'), ic, 200), { breakBefore: true, span: 'block' }, 'icon');
      break;
    }

    case 'code': {
      const lines = beat.code?.lines ?? [];
      if (!lines.length) return undefined;
      const codeHead = pickLead(ctx, beat.heading || 'In code', headingShown);
      if (codeHead) add(makeText(eid('head'), codeHead, 'heading'), { span: 'full' }, 'anchor');
      add(
        makeDiagram(
          eid('code'),
          'stack',
          lines.map((l, k) => ({ id: `c${k}`, label: l })),
        ),
        { span: 'full', breakBefore: true },
        'figure',
      );
      break;
    }

    case 'table': {
      const t = beat.table;
      if (!t) return undefined;
      const tableHead = pickLead(ctx, beat.heading || 'At a glance', headingShown);
      if (tableHead) add(makeText(eid('head'), tableHead, 'heading'), { span: 'full' }, 'anchor');
      const nodes: { id: string; label: string }[] = [];
      t.header.slice(0, 3).forEach((h, k) => nodes.push({ id: `h${k}`, label: shorten(h, 4) }));
      t.rows
        .slice(0, 3)
        .forEach((row, r) =>
          row
            .slice(0, 3)
            .forEach((cell, c) => nodes.push({ id: `r${r}c${c}`, label: shorten(cell, 4) })),
        );
      add(makeDiagram(eid('grid'), 'grid', nodes), { span: 'full', breakBefore: true }, 'figure');
      break;
    }

    case 'recap': {
      const h = add(
        makeText(eid('head'), 'The whole picture', 'heading'),
        { span: 'full' },
        'anchor',
      );
      add(makeShape(eid('rule'), 'underline', 460, 12), { below: h, span: 'full' });
      const nodes = (beat.items ?? []).map((label, k) => ({ id: `r${k}`, label }));
      if (nodes.length)
        add(
          makeDiagram(eid('recap'), 'stack', nodes),
          { span: 'full', breakBefore: true },
          'figure',
        );
      break;
    }

    case 'annotate': {
      const slot = beat.annotate?.slot ?? 'anchor';
      const target = ctx.prevSlots[slot] ?? ctx.prevSlots.figure ?? ctx.prevSlots.anchor;
      if (!target) {
        // Nothing on the board to mark up — fall back to a plain statement.
        return buildScene({ ...beat, shape: 'statement' }, index, doc, ctx);
      }
      add(makeEmphasis(eid('mark'), target, beat.annotate?.effect ?? 'circle'));
      // Annotation scenes deliberately reuse the previous region: the camera
      // stays put and the earlier elements are still on the board.
      return {
        scene: {
          id: sid,
          narration,
          camera: { x: 0, y: 0, zoom: 1, transition: 0.45 },
          elements,
          hold: 0,
        },
        hints,
        slots: { ...ctx.prevSlots, ...slots },
      };
    }

    case 'statement':
    default: {
      const point = keyPhrase(beat.source, beat.heading, 14) || shorten(beat.source, 14);
      const p = add(makeText(eid('point'), point, 'heading'), { span: 'full' }, 'anchor');
      const detail = supportingPhrase(beat.source, point);
      if (detail)
        add(makeText(eid('detail'), detail, 'body'), { below: p, span: 'full' }, 'detail');
      const ic = iconId();
      if (ic) add(makeAsset(eid('icon'), ic, 220), { breakBefore: true, span: 'block' }, 'icon');
      break;
    }
  }

  if (!elements.length) return undefined;

  return {
    scene: {
      id: sid,
      narration,
      camera: { x: 0, y: 0, zoom: 1, transition: index === 0 ? 0 : 0.9 },
      elements,
      // Deliberate silence is a teaching decision, so it belongs to the lesson
      // compiler (see `compile.ts`). The document planner is the no-key CI
      // fixture for the renderer and holds nothing.
      hold: 0,
    },
    hints,
    slots,
    ...(iconPick === undefined ? {} : { icon: iconPick.slug }),
  };
}

/* -------------------------------------------------------------- text picks */

/**
 * Headline for a beat that is mostly a figure. Returns `''` when the words are
 * already on the board — repeating a heading in a second region is clutter, and
 * the persistent canvas means the first one is still there.
 */
function pickLead(ctx: BuildCtx, wanted: string, headingShown: boolean): string {
  const text = wanted.trim();
  if (!text || headingShown || ctx.used.has(text)) return '';
  ctx.used.add(text);
  return text;
}

/** True when two on-canvas strings say the same thing. */
function echoes(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .trim();
  const x = norm(a);
  const y = norm(b);
  return x === y || x.includes(y) || y.includes(x);
}

/** Does the narration actually speak this figure? */
function saysNumber(narration: string, value: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s,]+/g, '');
  const v = norm(value);
  return /\d/.test(v) && norm(narration).includes(v);
}

/** The most quotable short phrase in a passage, avoiding the heading's words. */
function keyPhrase(source: string, avoid: string, maxWords: number): string {
  const clean = stripMarkdown(source);
  const parts = clean.split(/(?<=[.!?])\s+/).filter((s) => wordCount(s) >= 3);
  const avoidLower = avoid.toLowerCase().trim();
  const candidate =
    parts.find((s) => avoidLower.length > 2 && !s.toLowerCase().includes(avoidLower)) ??
    parts[0] ??
    clean;
  return shorten(candidate, maxWords);
}

/** A second, different phrase from the same passage, for the supporting line. */
function supportingPhrase(source: string, used: string): string | undefined {
  const usedKey = used.replace(/…$/, '').toLowerCase().slice(0, 24);
  const parts = stripMarkdown(source)
    .split(/(?<=[.!?])\s+/)
    .filter((s) => wordCount(s) >= 5 && !s.toLowerCase().includes(usedKey));
  const pick = parts[0];
  if (!pick) return undefined;
  const short = shorten(pick, 18);
  return wordCount(short) >= 4 ? short : undefined;
}

/** A subtitle for the opening card: the document's promise in one line. */
function subtitleOf(source: string, title: string): string | undefined {
  const clean = stripMarkdown(source);
  const rest = clean
    .replace(new RegExp(`^\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[.:—-]*`, 'i'), '')
    .replace(/^[.:\s—-]+/, '')
    .trim();
  const first = (rest || clean).split(/(?<=[.!?])\s+/)[0] ?? '';
  const short = shorten(first, 12);
  return wordCount(short) >= 3 ? short : undefined;
}

/* ------------------------------------------------------------ beat trimming */

/**
 * Trim to `maxScenes`, dropping annotations first and then the weakest content
 * beats. The opening and the recap always survive.
 */
function trimBeats(beats: Beat[], maxScenes: number): Beat[] {
  if (beats.length <= maxScenes) return beats;
  const keep = new Set<number>();
  beats.forEach((b, i) => {
    if (b.shape === 'title' || b.shape === 'recap') keep.add(i);
  });
  const ranked = beats
    .map((b, i) => ({ b, i }))
    .filter((x) => !keep.has(x.i))
    .sort(
      (a, b) =>
        b.b.weight - a.b.weight ||
        (a.b.shape === 'annotate' ? 1 : 0) - (b.b.shape === 'annotate' ? 1 : 0) ||
        a.i - b.i,
    );
  for (const x of ranked) {
    if (keep.size >= maxScenes) break;
    keep.add(x.i);
  }
  const kept = beats.filter((_, i) => keep.has(i));
  // An annotation whose subject was dropped no longer makes sense.
  return kept.filter((b, i) => b.shape !== 'annotate' || i > 0);
}

/* ---------------------------------------------------------------- pacing QA */

/**
 * Report scenes that fall outside the 3.5–12 second window, so callers (and the
 * tests) can see the pacing the planner actually achieved.
 */
export function pacing(
  sb: Storyboard,
  wordsPerSecond = 2.6,
): {
  sceneId: string;
  words: number;
  seconds: number;
  verdict: 'short' | 'ok' | 'long';
}[] {
  return sb.scenes.map((s) => {
    const seconds = estimateDurationSec(s.narration, wordsPerSecond);
    return {
      sceneId: s.id,
      words: wordCount(s.narration),
      seconds: Math.round(seconds * 100) / 100,
      verdict: seconds < MIN_SCENE_SEC ? 'short' : seconds > MAX_SCENE_SEC ? 'long' : 'ok',
    };
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Exposed for the studio: how wide a piece of text will be on the canvas. */
export { measureText };
