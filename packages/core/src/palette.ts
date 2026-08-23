/**
 * The board's colours — the ONE table (audit S5-c, plan item 2.2).
 *
 * The Storyboard IR deliberately carries no colours, only semantic roles; this is
 * the single place those roles turn into pixels, for every package that paints.
 * Until 2026-08-23 the renderer and the visuals stage each kept a table of their
 * own, and the two had drifted: visuals' accent was a red (`#d7263d`) where the
 * film's is this blue, and even their blacks differed by a shade — so an equation's
 * typeset fill (recorded by visuals) was a subtly different black from the text
 * beside it (painted by the renderer). The film always painted the renderer's
 * numbers — every frame of both shipped lessons shows the blue — so the renderer's
 * table is the one that survives here, and the red is deleted, not aliased.
 *
 * Note this is *video content*, not UI chrome — `docs/DESIGN.md`'s semantic UI
 * tokens do not apply here. The rule we do keep is the important one: one ink
 * colour carries all the structure, and a single accent per film marks things up.
 * No rainbow boards. (Per-ink-style colour packs — chalk on dark slate — are a
 * StylePack design decision, plan item 7.3, not a second table here.)
 */
import type { Tone } from './storyboard.js';

export type Palette = {
  paper: string;
  ink: string;
  /** Soft/muted ink — captions, secondary marks, "already explained". */
  inkSoft: string;
  grid: string;
  /**
   * Exactly one accent for the whole film. Cycling a hue per scene is how
   * competing tools end up with a rainbow board; the ink carries the structure
   * and the accent only ever marks things up.
   */
  accent: string;
  /**
   * The second marker, for the one job the accent cannot do: being told apart from
   * itself.
   *
   * Still not a palette to choose from. There is no third, and the pair is fixed for the
   * whole film exactly as the accent is — what it buys is the drawing where two things
   * have to be distinguished from each other and *both* are what the beat is about: the
   * ion going one way and the electron going the other, the before against the after.
   * One ink draws those as a tangle no arrangement fixes.
   *
   * Warm against the accent's cool, and that is the whole reason for the hue. Blue and
   * orange is the one pair that survives the common forms of colour blindness, so the
   * distinction the drawing rests on is still legible to the roughly one viewer in twelve
   * who cannot see red against green — and it stays legible in greyscale, because the two
   * differ in value as well as in hue.
   */
  contrast: string;
  /**
   * A wash for marking a region up without writing on it — the visuals lane's
   * highlight sweeps. Never structure, never text.
   */
  highlight: string;
};

const COLOR: Palette = {
  paper: '#fcfbf9',
  ink: '#1b232e',
  inkSoft: '#5a6472',
  grid: 'rgba(27,35,46,0.055)',
  accent: '#2f6fed',
  contrast: '#c2410c',
  highlight: '#f5c445',
};

const MONO: Palette = {
  paper: '#fcfbf9',
  ink: '#1b232e',
  inkSoft: '#646d7a',
  grid: 'rgba(27,35,46,0.05)',
  accent: '#39434f',
  // Mono has no hue to spend, so the pair separates by value instead. Lighter than the
  // accent rather than darker: the accent still has to read as the marked-up thing.
  contrast: '#8b93a0',
  // A wash and the second marker collapse together in mono — there is no hue left to
  // keep them apart, and a highlight darker than the thing it washes reads as a stain.
  highlight: '#8b93a0',
};

export type PaletteMode = 'mono' | 'color';

export function paletteFor(mode: PaletteMode): Palette {
  return mode === 'mono' ? MONO : COLOR;
}

/**
 * The ink a `Tone` names, on this board.
 *
 * The single place the IR's semantic names become colours. `muted` is the soft ink
 * the caption already uses, which is what makes "already explained" look like what
 * it is without inventing a fifth value.
 */
export function toneInk(pal: Palette, tone: Tone | undefined): string {
  switch (tone) {
    case 'accent':
      return pal.accent;
    case 'contrast':
      return pal.contrast;
    case 'muted':
      return pal.inkSoft;
    default:
      return pal.ink;
  }
}
