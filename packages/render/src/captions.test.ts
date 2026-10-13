/**
 * Captions, against a real film's measured timings.
 *
 * The synthetic half of this file pins the segmentation rules — clause breaks, the 42×2
 * budget, silence as punctuation, and the two alignment mismatches the voice stage's
 * normalisation creates ("Here's" → `heres`, "non-conducting" → `non` + `conducting`).
 * The other half loads `projects/cardiac8f` — ten scenes, 349 measured words — compiles
 * the same plan the renderer compiles, and checks the properties a player actually cares
 * about: timestamps that round-trip through the file, starts that only move forward, cues
 * that never overlap, and no cue outliving the beat it belongs to. Those four are the
 * failure modes that make a caption track worse than none, and none of them is visible in
 * a spot check of a couple of cues.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseStoryboard } from '@inkcast/core';
import { buildCues, captionScenes, toSrt, toVtt } from './captions.js';
import type { CaptionCue, CaptionScene } from './captions.js';
import { compilePlan } from './compile.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PROJECT = path.join(REPO, 'projects', 'cardiac8f');

const MAX_CHARS = 42;

/** A deliberately independent SRT reader: the emitter is not allowed to grade itself. */
type ParsedCue = { index: number; start: number; end: number; lines: string[] };

function parseTimestamp(s: string, msSep: ',' | '.'): number {
  const m = new RegExp(`^(\\d{2}):(\\d{2}):(\\d{2})\\${msSep}(\\d{3})$`).exec(s);
  assert.ok(m, `not a ${msSep === ',' ? 'SRT' : 'VTT'} timestamp: ${JSON.stringify(s)}`);
  const [, h, min, sec, ms] = m as unknown as [string, string, string, string, string];
  return Number(h) * 3600 + Number(min) * 60 + Number(sec) + Number(ms) / 1000;
}

function parseSrt(text: string): ParsedCue[] {
  assert.ok(!text.startsWith('﻿'), 'no BOM — some players choke on it');
  const blocks = text.trim().split(/\n\n+/);
  return blocks.map((block) => {
    const lines = block.split('\n');
    const idx = Number(lines[0]);
    assert.ok(Number.isInteger(idx), `cue number expected, got ${JSON.stringify(lines[0])}`);
    const arrow = (lines[1] ?? '').split(' --> ');
    assert.equal(arrow.length, 2, `timing line expected, got ${JSON.stringify(lines[1])}`);
    return {
      index: idx,
      start: parseTimestamp(arrow[0] as string, ','),
      end: parseTimestamp(arrow[1] as string, ','),
      lines: lines.slice(2),
    };
  });
}

function parseVtt(text: string): ParsedCue[] {
  const [header, ...rest] = text.split(/\n\n+/);
  assert.equal(header, 'WEBVTT', 'a WebVTT file starts with the WEBVTT signature');
  return rest
    .filter((b) => b.trim() !== '')
    .map((block) => {
      const lines = block.trim().split('\n');
      const arrow = (lines[1] ?? '').split(' --> ');
      assert.equal(arrow.length, 2, `timing line expected, got ${JSON.stringify(lines[1])}`);
      return {
        index: Number(lines[0]),
        start: parseTimestamp(arrow[0] as string, '.'),
        end: parseTimestamp(arrow[1] as string, '.'),
        lines: lines.slice(2),
      };
    });
}

/** Every invariant that has to hold for any input, checked in one place. */
function assertWellFormed(cues: readonly CaptionCue[], scenes: readonly CaptionScene[]): void {
  assert.ok(cues.length > 0, 'there should be cues at all');
  cues.forEach((c, i) => {
    assert.equal(c.index, i + 1, 'cue numbers are 1-based and contiguous');
    assert.ok(c.end > c.start, `cue ${c.index} has no duration`);
    assert.ok(
      c.lines.length >= 1 && c.lines.length <= 2,
      `cue ${c.index} has ${c.lines.length} lines`,
    );
    for (const line of c.lines) {
      assert.notEqual(line.trim(), '', `cue ${c.index} has a blank line`);
      // A lone word longer than the budget is allowed to overflow — splitting a word
      // across lines is the one thing a caption may never do.
      assert.ok(
        line.length <= MAX_CHARS || !line.includes(' '),
        `cue ${c.index} line ${line.length} chars: ${JSON.stringify(line)}`,
      );
    }
    const prev = cues[i - 1];
    if (prev) {
      assert.ok(c.start >= prev.end, `cue ${c.index} overlaps cue ${prev.index}`);
      assert.ok(c.start > prev.start, 'starts are strictly monotone');
    }
    const scene = scenes[c.scene] as CaptionScene;
    assert.ok(
      c.start >= scene.start - 1e-6 && c.end <= scene.end + 1e-6,
      `cue ${c.index} escapes scene ${c.scene} (${scene.start}–${scene.end}): ${c.start}–${c.end}`,
    );
  });
}

function scene(text: string, start: number, dur: number, hold = 0): CaptionScene {
  return { start, end: start + dur + hold, speechEnd: start + dur, text };
}

test('cues group into readable clauses instead of one word at a time', () => {
  const text =
    'Now, if that ripple ran straight on into the lower chambers, both pumps would squeeze together. Nothing would move.';
  const s = scene(text, 0, 12);
  const cues = buildCues([s]);
  assertWellFormed(cues, [s]);
  // 116 characters cannot be one cue and must not be sixteen.
  assert.ok(cues.length >= 2 && cues.length <= 4, `expected 2–4 cues, got ${cues.length}`);
  const flat = cues.flatMap((c) => c.lines).join(' ');
  assert.equal(flat.replace(/\s+/g, ' '), text, 'every word survives, in order');
  // The break lands where the sentence breathes, not mid-phrase.
  assert.ok(
    cues.slice(0, -1).every((c) => /[,;:—.!?]$/.test(c.lines.join(' ').trim())),
    `cues should end on punctuation: ${JSON.stringify(cues.map((c) => c.lines.join(' ')))}`,
  );
});

test('a long silence inside a beat ends the cue', () => {
  const words = [
    { word: 'squeeze', start: 0, end: 0.5 },
    { word: 'both', start: 0.5, end: 0.9 },
    // Two seconds of nothing: the next words belong to their own cue even though the
    // text would happily fit in one.
    { word: 'nothing', start: 2.9, end: 3.4 },
    { word: 'moves', start: 3.4, end: 3.9 },
  ];
  const s: CaptionScene = {
    start: 10,
    end: 14.2,
    speechEnd: 13.9,
    text: 'Squeeze both nothing moves',
    words,
  };
  const cues = buildCues([s]);
  assertWellFormed(cues, [s]);
  assert.equal(cues.length, 2, 'the pause is a punctuation mark');
  assert.deepEqual(cues[0]?.lines, ['Squeeze both']);
  assert.ok(
    cues[1] && cues[1].start >= 12.8,
    `second cue should wait for the words: ${cues[1]?.start}`,
  );
});

test('alignment survives the voice stage normalising the words', () => {
  // The aligner records "Here's" as one word and "non-conducting" as two; the display
  // text keeps the apostrophe and the hyphen. Both mismatches are real, from
  // projects/cardiac8f and projects/f70a4904eb30.
  const s: CaptionScene = {
    start: 0,
    end: 4,
    speechEnd: 3.6,
    text: "Here's the non-conducting ring.",
    words: [
      { word: 'heres', start: 0, end: 0.6 },
      { word: 'the', start: 0.6, end: 0.9 },
      { word: 'non', start: 0.9, end: 1.4 },
      { word: 'conducting', start: 1.4, end: 2.6 },
      { word: 'ring', start: 2.6, end: 3.6 },
    ],
  };
  const cues = buildCues([s]);
  assertWellFormed(cues, [s]);
  assert.equal(cues.length, 1);
  assert.deepEqual(cues[0]?.lines, ["Here's the non-conducting ring."]);
  assert.equal(cues[0]?.start, 0);
  // The cue ends when the last word does, not when the hyphenated pair started.
  assert.ok(Math.abs((cues[0]?.end ?? 0) - 3.6) < 1e-9, `ends at ${cues[0]?.end}`);
});

test('with no word timings a cue still lands inside its own beat', () => {
  const a = scene('Two bags of water, stacked. The top one drains into the bottom one.', 0, 8, 0.5);
  const b = scene('Squeeze both at the same moment and nothing goes anywhere at all.', 8.5, 7, 0.5);
  const cues = buildCues([a, b]);
  assertWellFormed(cues, [a, b]);
  assert.ok(cues.length >= 3, `expected several cues, got ${cues.length}`);
  assert.ok(
    cues.some((c) => c.scene === 0) && cues.some((c) => c.scene === 1),
    'both beats are captioned',
  );
});

test('a two-line cue breaks where the sentence breaks', () => {
  // Greedy fill put "thick" at the end of line one and left "fog." to open line two, on
  // projects/final-916. Both halves fit either way, so the sentence boundary wins.
  const s = scene('You are on a hillside in thick fog. You want the valley floor.', 0, 5);
  const cues = buildCues([s]);
  assertWellFormed(cues, [s]);
  assert.deepEqual(cues[0]?.lines, [
    'You are on a hillside in thick fog.',
    'You want the valley floor.',
  ]);
});

test('empty narration produces no cues rather than an empty file', () => {
  assert.deepEqual(buildCues([scene('', 0, 2)]), []);
  assert.deepEqual(buildCues([]), []);
});

test('SRT and VTT round-trip the timestamps they were built from', () => {
  const s = scene(
    'A ring of tough, non-conducting tissue separates top from bottom, and the wave dies there.',
    3.25,
    9.5,
    0.65,
  );
  const cues = buildCues([s]);
  assertWellFormed(cues, [s]);

  const srt = parseSrt(toSrt(cues));
  assert.equal(srt.length, cues.length);
  srt.forEach((p, i) => {
    const c = cues[i] as CaptionCue;
    assert.equal(p.index, c.index);
    // Millisecond precision is all the format has, so that is the tolerance.
    assert.ok(Math.abs(p.start - c.start) <= 0.0005, `start ${p.start} vs ${c.start}`);
    assert.ok(Math.abs(p.end - c.end) <= 0.0005, `end ${p.end} vs ${c.end}`);
    assert.deepEqual(p.lines, c.lines);
  });

  const vtt = parseVtt(toVtt(cues));
  assert.deepEqual(
    vtt.map((c) => [c.start, c.end, c.lines]),
    srt.map((c) => [c.start, c.end, c.lines]),
    'the two files describe the same track',
  );
});

test('VTT escapes the three characters that would become markup', () => {
  const s = scene('Compare a < b & b > c today.', 0, 3);
  const cues = buildCues([s]);
  const vtt = toVtt(cues);
  assert.ok(vtt.includes('&lt;') && vtt.includes('&amp;') && vtt.includes('&gt;'));
  assert.ok(!/[^&]<[a-z]/i.test(vtt), 'nothing in the text can be read as a tag');
  // SRT is not markup; the text goes out as written.
  assert.ok(toSrt(cues).includes('a < b & b > c'));
});

const HAS_PROJECT = existsSync(path.join(PROJECT, 'storyboard.json'));

test(
  'projects/cardiac8f: measured word timings become a well-formed caption track',
  { skip: HAS_PROJECT ? false : `${PROJECT} is not in this checkout` },
  async () => {
    const sb = parseStoryboard(
      JSON.parse(readFileSync(path.join(PROJECT, 'storyboard.json'), 'utf8')),
    );
    const plan = compilePlan(sb, PROJECT);
    const scenes = await captionScenes(sb, plan, PROJECT);
    assert.equal(scenes.length, sb.scenes.length, 'every narrated beat is a caption source');
    assert.ok(
      scenes.every((s) => s.words && s.words.length > 0),
      'this project has measured word timings for every scene',
    );

    const cues = buildCues(scenes);
    assertWellFormed(cues, scenes);

    // The track covers the film: it starts with it and ends inside it.
    const last = cues[cues.length - 1] as CaptionCue;
    assert.ok((cues[0] as CaptionCue).start < 1.5, 'the first cue arrives with the first words');
    assert.ok(last.end <= plan.duration + 1e-6, 'and nothing outlasts the video');

    // Not one word per cue, and not a wall of text either: the whole narration is
    // ~349 words, so anything near that count means the packer is not packing.
    const words = sb.scenes.reduce((n, s) => n + s.narration.split(/\s+/).length, 0);
    assert.ok(
      cues.length < words / 4 && cues.length > words / 14,
      `${cues.length} cues for ${words} words is not a readable rate`,
    );

    // Every word of the narration is present, in order, exactly once.
    const spoken = sb.scenes
      .map((s) => s.narration)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    assert.equal(
      cues
        .flatMap((c) => c.lines)
        .join(' ')
        .replace(/\s+/g, ' '),
      spoken,
    );

    // And it round-trips through both files.
    const srt = parseSrt(toSrt(cues));
    assert.equal(srt.length, cues.length);
    srt.forEach((p, i) => {
      const c = cues[i] as CaptionCue;
      assert.ok(Math.abs(p.start - c.start) <= 0.0005 && Math.abs(p.end - c.end) <= 0.0005);
      assert.ok(p.end > p.start, `cue ${p.index} has no duration on disk`);
      if (i > 0) assert.ok(p.start >= (srt[i - 1] as ParsedCue).end, 'no overlap on disk either');
    });
    assert.equal(parseVtt(toVtt(cues)).length, cues.length);
  },
);
