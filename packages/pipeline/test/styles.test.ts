/**
 * The renderer and the visuals stage read one colour table (audit S5-c, plan 2.2) and one
 * style pack (plan 7.3).
 *
 * The same shape as `cast.test.ts`'s CAST_POSES check: two packages consume one fact, and
 * this is the package that can see both sides. Until 2026-08-23 each kept a colour table
 * of its own and they had drifted — visuals' accent was a red (`#d7263d`) the film never
 * painted, and even the two blacks differed by a shade, so an equation's typeset fill
 * (recorded by visuals) was subtly not the ink of the text beside it (painted by the
 * renderer). Both now read `paletteFor` in `@inkcast/core`.
 *
 * 7.3 gave the file a second job of exactly the same kind. The *personality* was four
 * tables, not two: the rough.js hand here, the sketch engine's hand and pen sprite in the
 * renderer, the face in core, the pen weight in the camera. They are one JSON file now,
 * and the tests below run over `styleIds()` rather than a list of four — so a fifth pack
 * dropped into `styles/` is held to the same discipline the shipped four are, by a test
 * that has never heard of it.
 *
 * The field-name mapping is part of the contract: visuals' `secondary` is the board's
 * `contrast` (the second marker), its `muted` is the board's `inkSoft`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { paletteFor, styleIds, stylePackFor, stylePalette } from '@inkcast/core';
import { inkStyle, penArt } from '@inkcast/render';
import { inkStyleFor } from '@inkcast/visuals';

const MODES = ['color', 'mono'] as const;

test('every ink style letters with the colours the film is painted in', () => {
  for (const mode of MODES) {
    for (const name of styleIds()) {
      // The pack's own colours on a colour film that declares them, the board's table
      // otherwise — and never the pack's in mono, which is a mode rather than a taste.
      const pal = stylePalette(name, mode) ?? paletteFor(mode);
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
  // distinct from each other and from the ink, and there is no third. A pack cannot opt
  // out — `PackPalette` refuses to load one that tries — so this holds for every style.
  for (const mode of MODES) {
    for (const name of styleIds()) {
      const pal = stylePalette(name, mode) ?? paletteFor(mode);
      assert.notEqual(pal.accent, pal.ink, `${name}/${mode}: the accent must read as marked-up`);
      assert.notEqual(pal.accent, pal.contrast, `${name}/${mode}: the pair must be tellable apart`);
    }
  }
});

test('both drawing engines are handed the pack, and neither keeps a table of its own', () => {
  for (const name of styleIds()) {
    const pack = stylePackFor(name);

    // The visuals stage's rough.js hand.
    const geom = inkStyleFor({ style: name, palette: 'color' });
    assert.equal(geom.name, pack.id, `${name}: visuals must draw the pack it was given`);
    assert.equal(geom.roughness, pack.rough.roughness, `${name} rough.roughness`);
    assert.equal(geom.strokeWidth, pack.pen.width, `${name} pen.width`);
    assert.equal(geom.disableMultiStroke, !pack.rough.multiStroke, `${name} rough.multiStroke`);
    assert.equal(geom.fontFamily, pack.hand.fontFamily, `${name} hand.fontFamily`);

    // The renderer's sketch engine — a different engine's numbers, from the same file.
    const sketch = inkStyle(name);
    assert.equal(sketch.roughness, pack.sketch.roughness, `${name} sketch.roughness`);
    assert.equal(sketch.passes, pack.sketch.passes, `${name} sketch.passes`);
    assert.equal(sketch.opacity, pack.sketch.opacity, `${name} sketch.opacity`);

    // And the pen sprite, with the film's accent resolved into it.
    const accent = paletteFor('color').accent;
    const pen = penArt(name, accent);
    assert.equal(pen.unit, pack.pen.art.unit, `${name} pen art`);
    assert.equal(pen.parts.length, pack.pen.art.parts.length, `${name} pen parts`);
    for (const [i, part] of pen.parts.entries()) {
      const spec = pack.pen.art.parts[i];
      assert.ok(spec);
      // `accent` is the one colour name a pack may write that is not a colour.
      assert.equal(
        part.fill,
        spec.fill === 'accent' ? accent : spec.fill,
        `${name} part ${i} fill`,
      );
      assert.notEqual(part.fill, 'accent', `${name} part ${i}: the token must be resolved`);
      assert.notEqual(part.stroke, 'accent', `${name} part ${i}: the token must be resolved`);
    }
  }
});
