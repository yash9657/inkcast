# Style packs, illustration modes, and narrative scenes

Written against a reference target: a colour ink-and-hatching historical
illustration — five characters in one composition, consistent line weight and
palette across all of them, gesture and gaze relating them to each other, period
props, and a speech bubble. Illustration-grade, not icon-grade.

Our current `meta.style` is four ink personalities (marker, pencil, chalk, ink)
hardcoded in the visuals package. That is not a style system. This document
specifies one, plus the two things the reference image needs that we cannot do at
all: rich raster illustration and dialogue.

## 1. Illustration modes (architectural, decide before building styles)

**Do not vectorize rich illustration.** Cross-hatching, colour fill and fine
detail vectorise into thousands of near-duplicate paths: heavier than the source,
muddier than the source, and impossible to reveal as meaningful strokes. Resolve
per asset:

- `vector` — simple line art → vtracer → real stroke-by-stroke drawing. Correct for
  diagrams, objects, icons, single-subject sketches. Fully controllable, small.
- `raster-reveal` — keep the PNG and sweep a hand-drawn reveal mask across it,
  with the pen sprite riding the mask edge. Correct for anything with hatching,
  shading, colour fill, or several subjects. Reads as "being drawn" without
  pretending to be vector.

The mask matters: a straight left-to-right wipe looks mechanical. Sweep along a
gentle diagonal with a slightly irregular, roughened edge, and vary the direction
per asset so a scene with several illustrations does not feel machine-stamped.

Choose the mode from the asset's `detail` hint (`simple` → vector, `rich` →
raster-reveal), defaulting by style pack: Technical and Modern Minimal prefer
vector; Editorial and Playful prefer raster-reveal.

## 2. StylePack — a declarative, user-extensible style

A style is not a stroke width. It is a coordinated bundle of surface, palette,
ink, type, and generation prompt. Define it as data in core, ship the built-ins as
JSON, and let users drop their own into `styles/` — a designer should be able to
add a house style without touching TypeScript. That extensibility is an
open-source advantage a closed competitor gating 8 styles behind $199/mo cannot
match.

```ts
StylePack = {
  id, name, description,

  surface: {
    kind: 'chalkboard' | 'paper' | 'white' | 'grid' | 'blueprint',
    background: string,            // OKLCH
    texture?: 'chalk-dust' | 'paper-grain' | 'none',
    grid?: { spacing, color, opacity },
    vignette?: number,
  },

  ink: {
    primary: string,               // stroke colour
    weight: number,                // base stroke width in canvas units
    roughness: number,             // rough.js roughness
    bowing: number,                // rough.js bowing
    opacity: number,
    hatching: boolean,             // cross-hatch fills rather than flat
    lineCap: 'round' | 'butt',
  },

  palette: {
    mode: 'mono' | 'color',
    accents: string[],             // indexed by Curve.accent / element accent
    fill: 'none' | 'flat' | 'wash',
  },

  type: {
    display: string,               // font family for titles
    body: string,
    weight: number,
    tracking: number,
    scale: number,                 // multiplier on the renderer's type scale
  },

  // Handed to the text-to-image provider so generated illustrations match the
  // drawn geometry. Without this, generated art and hand-drawn shapes look like
  // two different products.
  generation: {
    stylePrompt: string,
    negativePrompt: string,
    preferredMode: 'vector' | 'raster-reveal',
  },

  pen?: PenId,                     // default pen-in-hand sprite
}
```

### The eight built-ins

Match the categories a user expects, and pick deliberately different surfaces so
they are visibly distinct rather than eight tints of the same thing.

| id | surface | ink | palette | type | notes |
| --- | --- | --- | --- | --- | --- |
| `chalkboard-mono` | dark slate + chalk dust | white, soft, high roughness | mono | rounded hand | the classroom default |
| `chalkboard-color` | dark slate + chalk dust | white base | warm chalk accents | rounded hand | social-friendly |
| `modern-minimal` | white | thin, near-zero roughness | one restrained accent | geometric sans | investor-facing; vector mode |
| `technical` | faint blueprint grid | thin uniform, cyan | cool accents | mono labels | schematics, systems |
| `editorial` | cream paper grain | ink pen, hatching on | muted, washed fill | serif display | **the reference image's family** |
| `whiteboard` | white | marker, medium roughness | bright primaries | marker hand | the familiar default |
| `playful` | warm tint | thick round, high bowing | saturated | rounded bold | kids, short-form |
| `sharpie` | off-white | very thick black, raw | near-mono, one spot colour | condensed hand | raw and confident |

Every style must be legible in both 16:9 and 9:16 and must pass a contrast check
against its own surface — a style that fails accessibility is a bug, not a look.

## 3. Pen-in-hand

We already draw a marker sprite riding the stroke tip, so this generalises rather
than needing new machinery. Make it a `PenId` — `none | pen | stylus | marker |
brush | chalk` — where each is a vendored SVG sprite plus a config: the offset
from the sprite's tip to its anchor, a rotation offset, and whether to draw a hand.
The renderer already computes position and tangent via `getPointAtLength`; it just
needs to select the sprite and lift it between strokes.

Hands are the hard part and the reason to be careful: a hand sprite that never
changes grip looks worse than no hand. Ship pen/stylus/marker tips first, treat a
drawn hand as a later addition, and let `none` stay a first-class choice.

## 4. Speech bubbles and dialogue

The reference image's line — "You're out of a job, kid." — carries the whole
scene, and we have no way to express it. Add a `bubble` element:

```ts
BubbleElement = {
  type: 'bubble',
  text: string,
  targetId?: string,          // element the tail points at
  tailFrom?: Point,           // or an explicit origin
  shape: 'speech' | 'thought' | 'shout' | 'caption',
  at: Box,
}
```

Hand-drawn outline via rough.js, tail computed toward the target's bounding box,
text wrapped by real measurement inside the bubble, entering with the `write`
style so the words appear as speech. Dialogue is how narrative subjects teach —
history, literature, ethics — and it also gives short-form content its hook.

## 5. Composed narrative scenes

The reference image is five entities in deliberate spatial relationship. Two rules:

- **Compose, never generate wholesale.** One prompt for a whole tableau yields an
  unanimatable blob that cannot be revealed per entity, annotated, or re-framed.
  Generate each entity as its own asset and place them.
- **Spatial intent belongs in the lesson.** A `VisualIntent` for a narrative beat
  must be able to say "Odoacer at left, pointing right; Romulus seated at right,
  smaller; two guards behind left" and have the compiler resolve that into
  positions, scales, facing directions and z-order. Add `facing: 'left' | 'right'`
  (satisfied by the existing `flipX`) and a relative placement grammar so the
  planner does not have to invent canvas coordinates.

Combined with the character rig in LESSON-ENGINE.md (`baseId` + `pose` +
reference-image conditioning), that is what makes a recurring cast possible.

## 6. Honest limits

- Output quality is bounded by the text-to-image model and the style prompt. A
  strong `stylePrompt` on a current flux-class model gets close to the reference
  for line-and-wash historical illustration; it will not match a professional
  illustrator, and we should not claim it does.
- Rich illustration needs a provider key. With no key, styles still apply fully to
  geometry, type, plots and diagrams — the surface, palette and ink all work — but
  characters fall back to archetype sprites. Say that plainly in the UI.
- Raster-reveal assets cannot be recoloured per style after generation, so an
  asset is cached per (style, prompt) pair, not per prompt alone.

## 7. Build order

1. `StylePack` in core + the eight built-ins as JSON + loader for user styles.
2. Thread the pack through visuals (geometry, plots, type) and the renderer
   (surface, texture, palette). This alone delivers the eight styles for
   everything except generated illustration.
3. `PenId` sprites, generalising the existing marker.
4. `bubble` element.
5. `raster-reveal` illustration mode with the roughened diagonal sweep.
6. Composition grammar + character rig.
