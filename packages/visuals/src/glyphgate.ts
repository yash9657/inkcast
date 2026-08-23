/**
 * The glyph-coverage gate — the audit's one CRITICAL (S4-b), closed.
 *
 * Every string the handwriting lane will draw is checked, codepoint by
 * codepoint, against the resolved font's own cmap *before* anything is laid
 * out. Without this, a codepoint the font cannot draw was laid out at the
 * space glyph's width (`fontmetrics.ts`) and painted by the browser from a
 * fallback stack ending in `cursive` — tofu or a ransom-note face, silently.
 * That is the reference product's worst defect (D1: `α|0⟩` mangled through
 * the text path), and it was reachable here with no warning at any stage.
 *
 * What is deliberately NOT checked:
 *
 *  - **Equation `tex`.** The equation lane typesets through MathJax into glyph
 *    outlines and never touches the handwriting font. Its failure mode — no
 *    typeset geometry — is gated separately in `resolve.ts`, because falling
 *    back to TeX-as-handwriting is exactly the leak this gate exists to stop.
 *  - **Asset prompts.** A prompt is a generation instruction, not board text;
 *    the only path that letters one onto the board (the letter-card lane)
 *    takes the first three words, and gating whole prompts would fail runs on
 *    strings the film never draws.
 */
import type { Storyboard } from '@inkcast/core';
import type { FontMetrics } from './fontmetrics.js';

/** One uncovered codepoint, with everything needed to name it in an error. */
export type GlyphViolation = {
  sceneId: string;
  elementId: string;
  /** Which field of the element carries the string. */
  field: string;
  /** The full string, so the message shows the codepoint in context. */
  text: string;
  /** The uncovered character itself. */
  char: string;
  /** Its codepoint, for the U+XXXX in the message. */
  codePoint: number;
};

/** Every string the handwriting lane will letter onto the board. */
export function handwrittenStrings(
  sb: Storyboard,
): Array<{ sceneId: string; elementId: string; field: string; text: string }> {
  const out: Array<{ sceneId: string; elementId: string; field: string; text: string }> = [];
  for (const scene of sb.scenes) {
    for (const el of scene.elements) {
      const add = (field: string, text: string | undefined): void => {
        if (text?.trim()) out.push({ sceneId: scene.id, elementId: el.id, field, text });
      };
      switch (el.type) {
        case 'text':
          add('text', el.text);
          break;
        case 'arrow':
          add('label', el.label);
          break;
        case 'diagram':
          for (const n of el.nodes) add(`node "${n.id}" label`, n.label);
          for (const e of el.edges) add(`edge ${e.from}→${e.to} label`, e.label);
          break;
        case 'plot':
          add('xLabel', el.xLabel);
          add('yLabel', el.yLabel);
          for (const c of el.curves) add(`curve "${c.id}" label`, c.label);
          for (const [i, o] of el.overlays.entries()) {
            if ('label' in o) add(`overlay ${i} label`, o.label);
            if (o.kind === 'annotate') add(`overlay ${i} text`, o.text);
          }
          break;
        default:
          break;
      }
    }
  }
  return out;
}

/**
 * Check every handwritten string against the font's coverage.
 *
 * One violation per (string, codepoint) pair — a string with the same missing
 * character three times names it once, so the error message stays readable.
 */
export function glyphViolations(sb: Storyboard, font: FontMetrics): GlyphViolation[] {
  const out: GlyphViolation[] = [];
  for (const s of handwrittenStrings(sb)) {
    const seen = new Set<number>();
    for (const ch of s.text) {
      const cp = ch.codePointAt(0);
      if (cp === undefined || seen.has(cp)) continue;
      // Whitespace never draws a glyph; everything else must be covered.
      if (/\s/.test(ch)) continue;
      if (font.covers(cp)) continue;
      seen.add(cp);
      out.push({ ...s, char: ch, codePoint: cp });
    }
  }
  return out;
}

/** One violation as a human line: who, what, and exactly which codepoint. */
export function formatGlyphViolation(v: GlyphViolation): string {
  const u = `U+${v.codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
  return (
    `scene "${v.sceneId}" element "${v.elementId}" ${v.field}: ` +
    `"${v.text}" contains "${v.char}" (${u}), which the handwriting font has no glyph for` +
    (isMathy(v.codePoint)
      ? ' — mathematical notation belongs on the equation lane (`tex`), not the text path'
      : '')
  );
}

/** Rough "this looks like math" classifier, for the hint in the message only. */
function isMathy(cp: number): boolean {
  return (
    (cp >= 0x2200 && cp <= 0x22ff) || // mathematical operators
    (cp >= 0x27e8 && cp <= 0x27ef) || // angle brackets (bra-ket)
    (cp >= 0x2080 && cp <= 0x209f) || // subscripts
    (cp >= 0x2070 && cp <= 0x207f) || // superscripts
    (cp >= 0x0370 && cp <= 0x03ff) || // Greek
    (cp >= 0x1d400 && cp <= 0x1d7ff) // mathematical alphanumerics
  );
}
