# Getting started with Inkcast

Welcome. In the next few minutes you will turn a document you already have into a
narrated, hand-drawn explainer video, entirely on your own machine. Nothing to
sign up for, no API key, no per-minute meter running in the background.

This document is also a demo: it is one of the example inputs shipped in
`examples/`, so the video you are watching was compiled from the very page that
explains how to make it.

## What Inkcast actually does

Think of it as a compiler, not a magic video model. Your text goes in the front,
and five stages hand work to each other:

1. **Ingest** reads your source — Markdown, plain text, a PDF, a Word document, a
   URL, or text piped in on stdin — and normalises it into clean prose with its
   headings intact.
2. **Plan** turns that prose into a storyboard: a sequence of beats, each with one
   idea, a line of narration, and a camera position on a large shared canvas.
3. **Narrate** speaks each beat and measures how long it took. Those real
   durations are what the animation is timed against, so nothing drifts out of
   sync.
4. **Draw** resolves every visual once — an icon, a diagram, a sketch — and stores
   it in an asset library keyed by name.
5. **Render** drives a headless browser frame by frame and muxes the result with
   ffmpeg into an mp4 you can post anywhere.

## Your first video

Install the workspace, fetch the browser the renderer drives, then cast a
document:

    pnpm install
    pnpm exec playwright install chromium
    pnpm cast examples/gradient-descent.md

The terminal shows one progress bar per stage and finishes by printing where your
mp4 landed, how long each stage took, and what the run cost. On the local path
that last number is exactly zero.

## The canvas is one board, not a deck of slides

Most tools in this category clear the whiteboard between scenes. It is the
fastest way to make a video that is impossible to follow: the viewer builds a
mental picture, then watches it get wiped every eight seconds.

Inkcast draws on **one large canvas** and moves a camera around it. A diagram
sketched in scene two is still there in scene six, which means later beats can
circle it, underline it, or point an arrow at it. Zooming out at the end shows the
whole argument in one shot — the thing you actually want people to remember.

## Every drawing is resolved exactly once

Each visual entity lives in an asset library with a stable id and a locked random
seed. When a scene refers to `rover`, it gets _the_ rover — the same lines, the
same wobble, every time it appears. Regenerating a character per scene is why
competing tools produce a subtly different mascot in every shot, and it is a
structural problem, not a prompting problem.

## Editing without starting over

You will not love the first draft, and you should not have to regenerate
everything to fix it. Say what you want changed in plain English:

    inkcast edit last "scene 3 narration: slow down and give a concrete example"
    inkcast rerender last

Only the scene you touched is re-voiced. Everything else is served from the cache,
so the loop takes seconds rather than minutes. The storyboard is JSON on disk, so
you can also open it in your editor and change it by hand.

## Where your work lives

Each run is a directory under `projects/`, holding the storyboard, the audio
clips, the resolved artwork, the cache, and the finished video. That directory is
the project. Delete it and the project is gone; copy it to another machine and it
still renders. `inkcast list` shows everything you have made, and a crashed run
resumes from the stage it died on rather than starting again.

## When you want more polish

The defaults are local and free. Every upgrade is opt-in through an environment
variable, and a missing key degrades to the local default with a warning instead
of an error:

- A cloud planner writes tighter scripts for long or messy source documents.
- A cloud voice sounds more natural and unlocks voice cloning.
- A cloud image model draws richer illustrations than the built-in icon set.

Pick per stage. You can upgrade the narration and keep everything else local, and
your bill stays a fraction of what a hosted tool charges per finished minute.

## What to try next

Cast a page you already own — a README, a design doc, a lecture handout. Try
`--aspect 9:16` for a vertical cut, `--style pencil` for a softer line, and
`--palette mono` for the classic black-marker look. Then open the storyboard and
see exactly how the video was described. Nothing about the pipeline is hidden.
