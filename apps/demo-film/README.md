# Inkcast demo film

The 40-second product demo on the landing page (`apps/web/public/showcase/inkcast-demo.*`),
made in Remotion. The concept is one sheet of paper and one ink line: the camera follows
the line from idea to idea, each part is drawn as the narrator reaches it, and it ends by
pulling back to show the whole board.

Everything inside the frames is real Inkcast output:

| Clip                     | Made with                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `clips/sky.mp4`          | `inkcast teach "Why is the sky blue?" --depth quick --objective "explain Rayleigh scattering without maths" --project demo-sky` (Fireworks) |
| `clips/short.mp4`        | `inkcast teach "How does compound interest grow?" --short --depth quick --style chalk --project demo-short --degrade`                       |
| `clips/edit-*.png`       | frame 8 s of `demo-sky` before and after `inkcast edit` (heading → "Same sky, two colours") + `inkcast rerender`                            |
| `clips/poster-frame.png` | frame 40 s of `demo-sky`                                                                                                                    |

`public/clips/` is git-ignored; copy those renders from `projects/` to rebuild.
The lesson text on the sticky notes is quoted from `projects/demo-sky/lesson.json`.

## Audio

- Narration: one ElevenLabs take (voice Jessica, `eleven_multilingual_v2`) with character
  timestamps, kept in `narration.alignment.json` and `public/audio/narration_raw.mp3`.
  `python3 scripts/narration.py` cuts it into lines, places them, and writes
  `src/words.json` (every visual cue is a spoken word) and `public/captions.en.vtt`.
- Music and effects: `python3 scripts/sound.py`, original numpy/scipy synthesis.

## Render

```bash
pnpm --filter @inkcast/demo-film render   # film, poster and captions into apps/web/public/showcase
pnpm --filter @inkcast/demo-film studio   # preview and scrub
```
