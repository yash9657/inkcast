/**
 * The renderer and the visuals stage read one colour table (audit S5-c, plan 2.2).
 *
 * The same shape as `cast.test.ts`'s CAST_POSES check: two packages consume one fact,
 * and this is the package that can see both sides. Until 2026-08-23 each kept a colour
 * table of its own and they had drifted — visuals' accent was a red (`#d7263d`) the
 * film never painted, and even the two blacks differed by a shade, so an equation's
 * typeset fill (recorded by visuals) was subtly not the ink of the text beside it
 * (painted by the renderer). Both now read `paletteFor` in `@inkcast/core`; this test
 * is what fails if either side ever grows a colour of its own again.
 *
 * The field-name mapping is part of the contract: visuals' `secondary` is the board's
 * `contrast` (the second marker), its `muted` is the board's `inkSoft`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { paletteFor } from '@inkcast/core';
import { inkStyleFor } from '@inkcast/visuals';

const STYLES = ['marker', 'pencil', 'chalk', 'ink'] as const;
const MODES = ['color', 'mono'] as const;

test('every ink style letters with the colours the film is painted in', () => {
  for (const mode of MODES) {
    const pal = paletteFor(mode);
    for (const name of STYLES) {
      const style = inkStyleFor({ style: name, palette: mode });
      assert.equal(style.paper, pal.paper, `${name}/${mode} paper`);
      assert.equal(style.ink, pal.ink, `${name}/${mode} ink`);
      assert.equal(style.accent, pal.accent, `${name}/${mode} accent`);
      assert.equal(style.secondary, pal.contrast, `${name}/${mode} secondary/contrast`);
      assert.equal(style.muted, pal.inkSoft, `${name}/${mode} muted/inkSoft`);
      assert.equal(style.highlight, pal.highlight, `${name}/${mode} highlight`);
    }
  }
});

test('one accent for the whole film, in both modes', () => {
  // The discipline the table exists to keep: the accent and the second marker are
  // distinct from each other and from the ink, and there is no third.
  for (const mode of MODES) {
    const pal = paletteFor(mode);
    assert.notEqual(pal.accent, pal.ink, `${mode}: the accent must read as marked-up`);
    assert.notEqual(pal.accent, pal.contrast, `${mode}: the pair must be tellable apart`);
  }
});
