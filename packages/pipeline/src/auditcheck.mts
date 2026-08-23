/**
 * The audit, pinned as a harness — the mechanically re-checkable subset.
 *
 *     npx tsx packages/pipeline/src/auditcheck.mts
 *
 * `docs/AUDIT-FINDINGS.md` (2026-08-22, at 5f83bc4) was seven model passes over the
 * tree; most of its verdicts need judgement to re-derive. These do not: they are greps
 * and one-line assertions over source text, each pinning a fact the audit verified or a
 * fix `docs/PLAN-AUDIT-CLOSE.md` landed. The point of a harness over a report is that a
 * report describes one commit forever, and every fact below is one refactor away from
 * silently ceasing to be true.
 *
 * Each Phase 1–2 item of the plan adds its line here as it closes. Sub-second, no keys,
 * no browser. Exits 1 with every failed check named.
 *
 * Lives in `pipeline` for the same reason the other check tools do: it is the package
 * that can see every other package's source without acquiring a dependency on any of
 * them — these checks read files, not modules.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const failures: string[] = [];

function read(rel: string): string {
  return readFileSync(path.resolve(ROOT, rel), 'utf8');
}

function check(name: string, ok: boolean, why: string): void {
  if (ok) {
    console.log(`ok   ${name}`);
  } else {
    failures.push(name);
    console.error(`FAIL ${name} — ${why}`);
  }
}

/* ---- S5.1 routing purity: the planner's duplicate router stays deleted ---- */
{
  const compile = read('packages/planner/src/compile.ts');
  check(
    'S5.1: compileLesson never imports matchIcons',
    !/matchIcons/.test(compile),
    'the pre-resolution duplicate router is back in compile.ts — PIPELINE.md §5b deleted it',
  );
}

/* ---- A-5 determinism: nothing in the frame path reads a clock or rolls dice ---- */
{
  // Call sites, not words: the file's own header states the rule in prose.
  const runtime = read('packages/render/src/page/runtime.js');
  check(
    'A-5: runtime.js has no Math.random() / Date.now() / requestAnimationFrame()',
    !/Math\.random\(|Date\.now\(|requestAnimationFrame\(/.test(runtime),
    'the frame path acquired a source of nondeterminism — frame = f(inputs, t) is broken',
  );
}

/* ---- S3-a (1.2d): the lesson author cannot emit stage-owned fields ---- */
{
  const schema = read('packages/planner/src/schema.ts');
  check(
    "S3-a: 'marks' is STAGE_OWNED (the lesson author cannot bypass the drawing stage)",
    /STAGE_OWNED\s*=\s*\[[^\]]*'marks'/.test(schema),
    "prune 'marks' from the lesson tool schema — a model emitting marks skips the audit, repair and critic",
  );
}

/* ---- S5-b (1.2a): both drawing briefs advertise the ninth mark, math ---- */
{
  const brief = read('packages/planner/src/draw-anthropic.ts');
  const nines = brief.match(/THE MARKS, and there are only these nine:/g) ?? [];
  check(
    'S5-b: DRAW_BRIEF and UNDERLAY_BRIEF list nine marks, math among them',
    nines.length >= 2 && /- math \{/.test(brief) && !/only these eight/.test(brief),
    'a drawing author not told about `math` writes α|0⟩ as a label — the D1 defect',
  );
}

/* ---- S5-b (1.2b): the lesson brief no longer steers equations into text ---- */
{
  const brief = read('packages/planner/src/lesson-anthropic.ts');
  check(
    'S5-b: the text intent is not described as "an equation"',
    !/\*\*text\*\* — an equation/.test(brief) && /NEVER an equation/.test(brief),
    'lesson-anthropic.ts is steering math onto the handwriting path again',
  );
}

/* ---- S5-b (1.2c): makeText sniffs math and promotes it ---- */
{
  const elements = read('packages/planner/src/elements.ts');
  check(
    'S5-b: makeText carries the math sniffer',
    /export function sniffMath/.test(elements) && /sniffMath\(text\)/.test(elements),
    'the sniffer is gone — a mathematical string routed to text is lettered as tofu',
  );
}

/* ---- S4-b (1.1): the glyph gate exists and resolveVisuals runs it ---- */
{
  const resolve = read('packages/visuals/src/resolve.ts');
  const gate = read('packages/visuals/src/glyphgate.ts');
  check(
    'S4-b: resolveVisuals runs the glyph-coverage gate',
    /glyphViolations\(/.test(resolve) && /covers\(/.test(gate),
    'the CRITICAL finding is open again: uncovered codepoints lay out at the space width',
  );
}

/* ---- S4-b (1.1): the cmap miss no longer the only line of defence ---- */
{
  const metrics = read('packages/visuals/src/fontmetrics.ts');
  check(
    'S4-b: FontMetrics exposes covers() from the real cmap',
    /covers:\s*\(cp\)\s*=>\s*cmap\.has\(cp\)/.test(metrics),
    'coverage is being guessed instead of read from the font table',
  );
}

/* ---- S6-b (1.3): the aligner cannot return fake word timings ---- */
{
  const align = read('packages/voice/src/align.ts');
  check(
    'S6-b: mapToExpected reports its paired fraction and the aligner floors on it',
    /MIN_ALIGN_FRACTION/.test(align) && /fraction/.test(align),
    'a zero-match alignment ships plausible fake timings again (D8)',
  );
}

/* ---- S4-g (0.1): the strict gate exists and the pipeline threads it ---- */
{
  const gates = read('packages/core/src/gates.ts');
  const cast = read('packages/pipeline/src/cast.ts');
  check(
    'S4-g: GateMode exists and cast() defaults to strict',
    /export type GateMode/.test(gates) && /opts\.gates \?\? 'strict'/.test(cast),
    'the strict-by-default posture is gone — quality assertions are advisory again',
  );
}

/* ---- S9-c (1.4): the critic does not revise blind ---- */
{
  const critic = read('packages/planner/src/draw-critic.ts');
  check(
    'S9-c: a missing preview skips the correction instead of revising blind',
    /skipping the correction rather than revising blind/.test(critic),
    'the critic is fixing coordinates it cannot see, at a log level nobody reads',
  );
}

/* ---- A-6 (1.4): a dominant-visual cue miss is structured, not a log line ---- */
{
  const cue = read('packages/voice/src/cue.ts');
  check(
    'A-6: resolveSceneCues reports dominantMisses',
    /dominantMisses/.test(cue),
    'a missed cue on the main picture is back to being one scrolled-past warning (D5)',
  );
}

if (failures.length) {
  console.error(`\n${failures.length} audit check(s) failed.`);
  process.exit(1);
}
console.log('\nall audit checks hold.');
