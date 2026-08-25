/**
 * StylePack — the board's personalities, as data (plan item 7.3, audit X-f).
 *
 * `meta.style` used to be a four-name union hardcoded in five different tables: the
 * handwriting face here in `fontmetrics.ts`, the pen weight in `camera.ts`, the
 * rough.js personality in `visuals/src/style.ts`, the sketch engine's hand and the pen
 * sprite in `render/src/palette.ts`, and the embedded font family in
 * `render/src/font.ts`. That is the same defect plan item 2.2 found in the colour table
 * — one fact, several catalogues — and it had already drifted in the same direction:
 * `render/src/font.ts` named `caveat` where `HAND_FONTS.pencil` named `Caveat` with three
 * filename stems, and nothing compared them. A fifth style meant editing all five and
 * publishing a new version of three packages.
 *
 * A style is now a JSON file. `styles/marker.json` is the whiteboard marker, and the four
 * shipped personalities are the first four packs; a fifth is a fifth file and no
 * TypeScript at all — which is `docs/STYLES.md` §2's whole argument, and the item's
 * done-bar.
 *
 * ## What a pack may and may not say
 *
 * It says everything that decides how ink is *laid down*: the face, the pen's weight and
 * sprite art, both drawing engines' hands, and — optionally — the board's own colours.
 * It does not say anything nothing reads. `docs/STYLES.md` §2 sketches `surface.texture`
 * (chalk dust, paper grain), `surface.vignette` and a `generation` prompt block; none of
 * those has a consumer in this tree, and a schema that accepted them would be promising a
 * user something the renderer silently drops. They stay unimplemented and unadvertised
 * until the code that reads them exists (STYLES.md's build order, items 3 and 5).
 *
 * ## Two of several numbers, deliberately
 *
 * Two engines draw this board: the visuals stage resolves geometry through rough.js, and
 * the renderer sketches its own strokes (`render/src/sketch.ts`). They take the same
 * *kind* of parameter — roughness, bowing, a stroke width — on different scales, and
 * today's four styles set them to numbers that are not derivable from one another
 * (marker: rough.js 1.15 roughness and a 4.4-unit stroke, the sketch engine 1.1 and a
 * 6-px base × 1.0). Folding them into one number would move every pinned pixel for a
 * tidiness nobody asked for, so a pack states both, side by side, under `rough` and
 * `sketch` — which at least makes the divergence visible in one file instead of two
 * packages.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Palette } from './palette.js';

/* ----------------------------------------------------------------- the schema */

/** Any CSS colour string the render page understands, plus the `accent` token. */
const Colour = z.string().trim().min(1).max(64);

/** A colour that has to be *measurable*, so the loader can judge how light it is. */
const HexColour = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'must be a hex colour like #fcfbf9');

/**
 * One filled path of a pen sprite, tip-at-origin with the body up the −y axis —
 * `render/src/types.ts`'s `PenPart`, in a pack.
 *
 * `fill` and `stroke` accept the literal token **`accent`**, which resolves to the
 * board's accent at compile time. That token is how the marker's barrel picks up the
 * film's accent colour; it used to be a `p.fill === '#2f6fed'` substitution in
 * `render/src/palette.ts`, which is to say the renderer knew one sprite by the colour of
 * its barrel. A pack that wants a coloured barrel now says so.
 */
export const PenPartSpec = z
  .object({
    d: z.string().trim().min(1),
    fill: Colour.default('none'),
    stroke: Colour.default('none'),
    strokeWidth: z.number().finite().min(0).default(0),
  })
  .strict();

/** Pen sprite geometry, in the sprite's own units. */
export const PenArtSpec = z
  .object({
    /** Height of the sprite in its own units, used to normalise its screen size. */
    unit: z.number().finite().positive(),
    /** Degrees added to the tangent rotation so the sprite is "held" naturally. */
    baseAngle: z.number().finite(),
    /** How strongly the sprite follows the stroke tangent (0–1). */
    follow: z.number().finite().min(0).max(1),
    parts: z.array(PenPartSpec).min(1),
  })
  .strict();

/**
 * A pack's own colours — optional, and the item this file's sibling `palette.ts` has
 * been deferring since 2.2 ("per-ink-style colour packs — chalk on dark slate — are a
 * StylePack design decision, plan item 7.3, not a second table here").
 *
 * **One accent, enforced here.** `docs/STYLES.md` §2 models this field as
 * `accents: string[]`, and that is the one place this implementation deliberately departs
 * from the spec it implements: an array is an invitation to the rainbow board
 * `palette.ts` exists to prevent, and the film's discipline — one ink carries the
 * structure, one accent marks things up, one contrast for the one job the accent cannot
 * do — is not a default a pack may opt out of. A single string cannot be a list of five,
 * and the refinements below reject the other two ways to break it: an accent equal to the
 * ink is not a mark-up, and an accent equal to the contrast is not a pair.
 *
 * **Colour mode still wins.** These colours are the *colour* board. `meta.palette: 'mono'`
 * is a mode, not a taste — "no hue to spend" — so a mono film is painted from the mono
 * table whatever the pack says, exactly as it is today. A pack cannot smuggle a hue into
 * the black-and-white cut.
 */
export const PackPalette = z
  .object({
    /** The board's own surface. Hex, because `MIN_PAPER_LUMA` has to measure it. */
    paper: HexColour,
    ink: Colour,
    /** Soft/muted ink — captions, secondary marks, "already explained". */
    inkSoft: Colour,
    grid: Colour,
    /** Exactly one, for the whole film. */
    accent: Colour,
    /** The second marker: warm against the accent's cool. */
    contrast: Colour,
    /** A wash for marking a region up without writing on it. */
    highlight: Colour,
  })
  .strict()
  .superRefine((pal, ctx) => {
    if (pal.accent === pal.ink) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['accent'],
        message: 'the accent must differ from the ink, or nothing reads as marked up',
      });
    }
    if (pal.accent === pal.contrast) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contrast'],
        message: 'the accent and the second marker must be tellable apart — that is the pair',
      });
    }
    const luma = relativeLuminance(pal.paper);
    if (luma < MIN_PAPER_LUMA) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['paper'],
        message:
          `paper ${pal.paper} has relative luminance ${luma.toFixed(3)}, below the ` +
          `${MIN_PAPER_LUMA} floor — a dark board needs the real-alpha work the audit ` +
          'deferred (S5.6). Generated figures composite with `mix-blend-mode: multiply` ' +
          '(visuals/src/image.ts), which can only darken: on a slate board a black-ink ' +
          'raster multiplies into the slate and disappears, and no gate catches it because ' +
          'the raster itself is fine. Scope the pack to a light surface, or write the ' +
          'alpha lane first.',
      });
    }
  });

/**
 * How light a pack's paper has to be, as WCAG relative luminance.
 *
 * A guard rail, not a perceptual threshold, and deliberately loose: its job is to catch a
 * *slate* board (`#1b232e` measures 0.017) rather than to referee a cream one. Every one
 * of the 42 rasters in `~/.inkcast/cache/illustrations` is drawn in dark ink on a ground
 * measuring 0.954 white or better (6.4's `MIN_GROUND_WHITE` comment), and every one of
 * them is composited onto the board with `multiply`. Against paper this light the
 * multiply is near-identity and the picture sits on the board; below it the picture's own
 * ink is multiplying into a surface already darker than the ink, which is not a gradual
 * degradation but a disappearance.
 *
 * 0.5 is the midpoint of the range, which is where "light surface" stops being arguable.
 * It is not measured against anything, because the thing it guards is not a threshold
 * effect — and a pack author who wants a cream, sand or pale-grey board is nowhere near
 * it. Raise the bar or delete it when the alpha lane lands, and say which in writing.
 */
export const MIN_PAPER_LUMA = 0.5;

/**
 * A style pack: one file, one personality.
 *
 * `.strict()` throughout, so a misspelled field is an error rather than a silently
 * ignored line — a pack author has no other way to find out that `roughnes` did nothing.
 * Defaults are the marker's values, because marker is the default style: a pack that
 * states only its face and its pen is a legal, predictable whiteboard variant.
 */
export const StylePack = z
  .object({
    /** Lowercase, hyphenated; this is what `meta.style` names and what a cache key carries. */
    id: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'a style id is lowercase letters, digits and hyphens')
      .max(40),
    /** Human name, for a picker. */
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(400).default(''),

    /** The handwriting that goes on the board. */
    hand: z
      .object({
        /** Preferred family name; `assets/fonts/hand` is searched for `fontFiles`. */
        fontFamily: z.string().trim().min(1),
        /** Filename stems to look for, best first. */
        fontFiles: z.array(z.string().trim().min(1)).min(1),
        /** Extra letter tracking, in em. Marker needs air, liner does not. */
        tracking: z.number().finite().min(-0.1).max(0.2).default(0.012),
        /** Text is filled, not stroked; opacity carries the "pressure". */
        textOpacity: z.number().finite().min(0).max(1).default(1),
      })
      .strict(),

    pen: z
      .object({
        /**
         * The visuals stage's base stroke width, in canvas units.
         *
         * Not derivable from `weight` — see the header. The two run 0.58 to 0.76 of each
         * other across today's four styles, which is a spread, not a conversion.
         */
        width: z.number().finite().positive().max(40),
        /** Multiplier on the renderer's 6-output-px base (`boardMetrics.strokeWidth`). */
        weight: z.number().finite().positive().max(6),
        /** The sprite that rides the stroke tip. */
        art: PenArtSpec,
      })
      .strict(),

    /** The visuals stage's hand: rough.js, resolving recorded geometry. */
    rough: z
      .object({
        roughness: z.number().finite().min(0).max(10).default(1.15),
        bowing: z.number().finite().min(0).max(10).default(1.1),
        /** Multi-stroke (two overlapping passes) reads as a real hand; off = liner. */
        multiStroke: z.boolean().default(true),
        curveFitting: z.number().finite().min(0).max(1).default(0.96),
        maxRandomnessOffset: z.number().finite().min(0).max(20).default(2.2),
        strokeOpacity: z.number().finite().min(0).max(1).default(0.94),
        lineCap: z.enum(['round', 'butt', 'square']).default('round'),
        lineJoin: z.enum(['round', 'miter', 'bevel']).default('round'),
        fill: z
          .object({
            style: z
              .enum(['hachure', 'solid', 'zigzag', 'cross-hatch', 'dots', 'zigzag-line'])
              .default('hachure'),
            weight: z.number().finite().min(0).max(20).default(2.4),
            hachureAngle: z.number().finite().min(-180).max(180).default(-41),
            hachureGap: z.number().finite().min(0).max(60).default(9),
          })
          .strict()
          .default({}),
      })
      .strict()
      .default({}),

    /** The renderer's own hand: `render/src/sketch.ts`, which bakes the stroke paths. */
    sketch: z
      .object({
        /** Random-offset amplitude. Higher = shakier hand. */
        roughness: z.number().finite().min(0).max(10).default(1.1),
        /** How much a "straight" line bows. */
        bowing: z.number().finite().min(0).max(10).default(1),
        /** Strokes per edge. 2 is the classic sketched double stroke. */
        passes: z.number().int().min(1).max(4).default(2),
        cap: z.enum(['round', 'butt', 'square']).default('round'),
        /** Per-stroke opacity — chalk and pencil do not lay down solid ink. */
        opacity: z.number().finite().min(0).max(1).default(1),
      })
      .strict()
      .default({}),

    palette: PackPalette.optional(),
  })
  .strict();

export type StylePack = z.infer<typeof StylePack>;
export type PenArtSpec = z.infer<typeof PenArtSpec>;
export type PackPalette = z.infer<typeof PackPalette>;

/**
 * A pack plus the digest of what it says.
 *
 * The digest is the half of this item that keeps caches honest. Every cache key that used
 * to carry `meta.style` carried a *name*, which was a sufficient identity only while the
 * numbers behind the name were compiled in. Now that a user can edit `styles/marker.json`,
 * the name is no longer the fact — the file's contents are — so `styleKey()` carries both
 * and an edited pack invalidates the geometry, the render and every segment that used it.
 */
export type LoadedStylePack = StylePack & {
  /** sha256 of the pack's canonical (parsed, key-sorted) JSON. */
  digest: string;
  /** Absolute path of the file it was read from. */
  file: string;
};

/* ------------------------------------------------------------------ the loader */

/** The style the IR defaults to, and the pack every default in this schema is quoted from. */
export const DEFAULT_STYLE = 'marker';

/**
 * Where packs live, most specific first.
 *
 * `INKCAST_STYLE_DIR` comes first so a user can override a shipped pack by id without
 * editing the repo — the same knob shape as `INKCAST_FONT_DIR`. The two package-relative
 * paths are the `src/` and `dist/src/` cases, exactly as `fontBases()` handles them, and
 * the cwd entry is what makes a scratch tree work.
 *
 * First directory to define an id wins; later ones do not merge into it. Merging would
 * mean a pack whose numbers come from two files, which is unreadable at exactly the
 * moment it matters (why does my marker look like that?).
 */
function packDirs(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    process.env.INKCAST_STYLE_DIR,
    path.resolve(here, '../../../styles'), // src/ → repo root
    path.resolve(here, '../../../../styles'), // dist/src/ → repo root
    path.resolve(process.cwd(), 'styles'),
  ].filter((p): p is string => !!p);
}

let cache: Map<string, LoadedStylePack> | undefined;

/**
 * Every pack this tree can draw with, by id.
 *
 * Loaded once per process and cached, like the handwriting metrics beside it and for the
 * same reason: nothing swaps a style pack underneath a running render, and a cast that
 * re-read the files mid-run could draw two beats of one film in two hands.
 *
 * **Finding no packs at all is fatal.** It is the failure mode this whole item is exposed
 * to that the four hardcoded tables were not — a deployment that forgets to copy `styles/`
 * (the Dockerfile has to, and says so) has no ink to draw with. The alternative, falling
 * back to a built-in marker, is the shape of failure `render/src/font.ts`'s header calls
 * out as the worst kind: every video renders in the wrong hand and nothing announces it.
 */
export function stylePacks(): Map<string, LoadedStylePack> {
  if (cache) return cache;
  const found = new Map<string, LoadedStylePack>();
  const searched: string[] = [];
  for (const dir of packDirs()) {
    searched.push(dir);
    let names: string[];
    try {
      if (!statSync(dir).isDirectory()) continue;
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(dir, name);
      const pack = readPack(file);
      if (!pack) continue;
      if (found.has(pack.id)) continue; // first directory wins, see `packDirs`
      if (pack.id !== path.basename(name, '.json')) {
        throw new Error(
          `style pack ${file} declares id "${pack.id}" but is filed as "${path.basename(name)}" — ` +
            'the filename is how a reader finds the pack a film names, so the two must agree',
        );
      }
      found.set(pack.id, pack);
    }
  }
  if (found.size === 0) {
    throw new Error(
      `no style packs found — looked in ${searched.join(', ')}. A style is a JSON file in ` +
        'styles/ (plan item 7.3); with none, there is no ink to draw with. If this is a ' +
        'container, styles/ has to be copied into the image alongside assets/.',
    );
  }
  if (!found.has(DEFAULT_STYLE)) {
    throw new Error(
      `style packs are present but "${DEFAULT_STYLE}" is not among them (${[...found.keys()].join(', ')}) — ` +
        'it is the IR default, so every storyboard that does not name a style would fail to parse',
    );
  }
  cache = found;
  return cache;
}

function readPack(file: string): LoadedStylePack | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`style pack ${file} is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = StylePack.safeParse(raw);
  if (!parsed.success) {
    const why = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`style pack ${file} is not a valid StylePack — ${why}`);
  }
  return { ...parsed.data, digest: digestOf(parsed.data), file };
}

/**
 * The digest is over the *parsed* pack, key-sorted — so reformatting a file, reordering
 * its keys or writing a default out explicitly does not churn every cache key, while any
 * change to a value the drawing depends on does.
 */
function digestOf(pack: StylePack): string {
  return createHash('sha256').update(canonical(pack)).digest('hex');
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${canonical(val)}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Every style id this tree can draw with, sorted. A picker, a flag and a schema all ask. */
export function styleIds(): string[] {
  return [...stylePacks().keys()].sort();
}

/** True when `id` names a pack. The one question the IR schema asks. */
export function isStyleId(id: string): boolean {
  return stylePacks().has(id);
}

/**
 * The pack a film is drawn with.
 *
 * Throws on an unknown id rather than falling back to the marker, because every caller
 * reaches this *after* `parseStoryboard` has already checked the name against
 * `styleIds()`: an unknown id here means a pack disappeared mid-run, and drawing the rest
 * of the film in a different hand is not a recovery.
 */
export function stylePackFor(id: string): LoadedStylePack {
  const pack = stylePacks().get(id);
  if (!pack) {
    throw new Error(`unknown style "${id}" — this tree has ${styleIds().join(', ')}`);
  }
  return pack;
}

/**
 * The identity of a style, for a cache key: the name *and* what the name currently means.
 *
 * Twelve hex digits of the digest, which is the same truncation `cacheKey` uses elsewhere
 * and is far past collision risk for a directory of hand-written files.
 */
export function styleKey(id: string): string {
  return `${id}@${stylePackFor(id).digest.slice(0, 12)}`;
}

/**
 * The colours a film is painted in: the pack's, or the board's own table.
 *
 * Mono is a mode rather than a taste — there is no hue to spend — so it is answered from
 * `paletteFor('mono')` whatever the pack says. See `PackPalette`.
 */
export function stylePalette(id: string, mode: 'mono' | 'color'): Palette | undefined {
  if (mode === 'mono') return undefined;
  return stylePacks().get(id)?.palette;
}

/* -------------------------------------------------------------------- colour math */

/** WCAG relative luminance of a hex colour, for `MIN_PAPER_LUMA`. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = rgbOf(hex);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function rgbOf(hex: string): [number, number, number] {
  const h = hex.trim().replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/* --------------------------------------------------------------------- test seam */

/**
 * Forget the loaded packs.
 *
 * Only a test has any business calling this — it is how the extensibility test points
 * `INKCAST_STYLE_DIR` at a fixture directory and proves that a fifth style is a fifth
 * file. A running cast must never call it: see `stylePacks()`.
 */
export function resetStylePacks(): void {
  cache = undefined;
}

/**
 * Every handwriting stem any pack asks for, normalised.
 *
 * `render/src/font.ts` kept this list as a `KNOWN` literal — the graceful second choice
 * when a pack's own face is not vendored. Derived here instead, so a fifth pack's face
 * joins the fallback set by existing.
 */
export function knownHandStems(): string[] {
  const packs = stylePacks();
  // The default style's face first, then the rest by id. Order is preference order for a
  // caller that could not find the face it asked for, and the default board's hand is the
  // least surprising substitute — which is what the hardcoded list meant by putting
  // Shantell at its head. Everything after that is alphabetical rather than arbitrary.
  const ids = [DEFAULT_STYLE, ...[...packs.keys()].sort().filter((id) => id !== DEFAULT_STYLE)];
  const stems = new Set<string>();
  for (const id of ids) {
    const pack = packs.get(id);
    if (!pack) continue;
    for (const f of pack.hand.fontFiles) stems.add(f.toLowerCase().replace(/[^a-z0-9]/g, ''));
  }
  return [...stems];
}
