/**
 * Real Inkcast output shown in the film. Lesson text is quoted from
 * projects/demo-sky/lesson.json (Fireworks-authored); the clips are that project's
 * render, the 9:16 short in projects/demo-short, and a plain-English edit of demo-sky.
 */
export const LESSON = {
  topic: 'Why is the sky blue?',
  hook: 'Blue at noon, orange at sunset. The air hasn’t changed, so what has?',
  worked: 'Blue ≈ 450 nm, red ≈ 650 nm. Blue is redirected about 4× as strongly.',
  misconception: 'It isn’t the ocean reflecting. Deserts far from any sea have blue skies too.',
};

export const CLIPS = {
  sky: {
    src: 'clips/sky.mp4',
    /** Seconds into the render where the hook scene starts drawing. */
    from: 0,
    choose: 40,
    /** Narration words of that scene with their times, from audio/scene-000.timing.json. */
    words: [
      { w: 'at', at: 0 },
      { w: 'noon', at: 0.4 },
      { w: 'the', at: 1.04 },
      { w: 'sky', at: 1.1 },
      { w: 'looks', at: 1.48 },
      { w: 'blue', at: 1.9 },
      { w: 'yet', at: 2.84 },
      { w: 'at', at: 3.02 },
      { w: 'sunset', at: 3.3 },
      { w: 'the', at: 4.02 },
      { w: 'same', at: 4.28 },
      { w: 'sky', at: 4.74 },
    ],
  },
  short: { src: 'clips/short.mp4', from: 2 },
  edit: {
    instruction: 'Retitle the opening “Same sky, two colours”',
    before: 'clips/edit-before.png',
    after: 'clips/edit-after.png',
  },
};
