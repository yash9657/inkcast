# Examples

Real source documents to cast, and one storyboard to render directly.

| File                          | Kind                     | Good for showing                                                                                                                                      |
| ----------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gradient-descent.md`         | Technical concept        | Formulas, a build-up that later scenes annotate. The smoke test in `docs/CONTRACT.md`.                                                                |
| `product-onboarding.md`       | Product / onboarding doc | Numbered steps, commands, and a document that explains the tool that compiled it.                                                                     |
| `photosynthesis.md`           | Educational topic        | A process with two stages and a supply chain — the camera has somewhere to go.                                                                        |
| `storyboard-handwritten.json` | Storyboard IR            | Rendering without the planner: four cameras touring one canvas, an asset library, and an emphasis that underlines a title drawn three scenes earlier. |

## Casting a document

```bash
pnpm cast examples/gradient-descent.md
pnpm cast examples/photosynthesis.md --aspect 9:16 --style pencil
pnpm cast examples/product-onboarding.md --palette mono --out ~/Desktop
```

## Rendering the hand-written storyboard

`storyboard-handwritten.json` parses against `packages/core/src/storyboard.ts`
with no planner involved, which makes it the fastest way to test the voice,
visuals and render stages on their own:

```bash
mkdir -p projects/handwritten
cp examples/storyboard-handwritten.json projects/handwritten/storyboard.json
inkcast rerender handwritten
inkcast preview handwritten
```

`rerender` narrates the scenes, resolves the two assets, and renders the video;
nothing is planned, so what you see is exactly what the JSON says.
