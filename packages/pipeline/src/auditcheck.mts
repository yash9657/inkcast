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
  const metrics = read('packages/core/src/fontmetrics.ts');
  check(
    'S4-b: FontMetrics exposes covers() from the real cmap',
    /covers:\s*\(cp\)\s*=>\s*cmap\.has\(cp\)/.test(metrics),
    'coverage is being guessed instead of read from the font table',
  );
}

/* ---- A-4 (2.1): one advance table in the repo ---- */
{
  const elements = read('packages/planner/src/elements.ts');
  const drawGeom = read('packages/planner/src/draw-geom.ts');
  const drawAudit = read('packages/planner/src/draw-audit.ts');
  const renderCompile = read('packages/render/src/compile.ts');
  const prims = read('packages/render/src/prims.ts');
  // The declaration form, not the phrase — the history comments are allowed to name
  // the deleted constant; a `const` bringing it back is not.
  const handwritingAdvance = /const ADVANCE\s*=\s*0\./;
  check(
    'A-4: the chars × ADVANCE handwriting estimate stays deleted',
    ![elements, drawGeom, drawAudit, renderCompile, prims].some((s) => handwritingAdvance.test(s)),
    'a chars-times-a-constant advance estimator is back — the planner must measure with core fontmetrics',
  );
  check(
    'A-4: the planner measures with the real advance table',
    /handMetricsFor/.test(elements) && /handMeasure\(/.test(drawGeom),
    'planner text metrics stopped reading @inkcast/core fontmetrics',
  );
  check(
    'A-4: the renderer sizes its own labels with the same table',
    /ctx\.hand\.measure\(/.test(renderCompile) && !/\.length \* size \* 0\./.test(renderCompile),
    'render/compile.ts is estimating a label width as chars × size × k again',
  );
  check(
    'A-4: one TeX size estimator (texBox), used by both lanes',
    /export function texBox/.test(elements) &&
      /texBox\(/.test(read('packages/planner/src/drawing.ts')) &&
      !/texAsGlyphs/.test(elements),
    'the planner has grown a second equation-box estimator again',
  );
}

/* ---- S5-c (2.2): one colour table — the red accent stays deleted ---- */
{
  const visualsStyle = read('packages/visuals/src/style.ts');
  const renderPalette = read('packages/render/src/palette.ts');
  check(
    'S5-c: visuals and render read colours from @inkcast/core, not tables of their own',
    /paletteFor/.test(visualsStyle) &&
      /export \{ paletteFor, toneInk \} from '@inkcast\/core'/.test(renderPalette) &&
      !/#d7263d/i.test(visualsStyle) &&
      !/accent:\s*'#/.test(renderPalette),
    'a package has grown a colour table of its own again — the film and the visuals lane will drift apart',
  );
}

/* ---- S4-c/S4-d/S7-c (2.3): the board assertions run on every compiled plan ---- */
{
  const renderCompile = read('packages/render/src/compile.ts');
  const storyboard = read('packages/core/src/storyboard.ts');
  check(
    'S4-c/d, S7-c: compilePlan runs the board assertions through the gate',
    /inkOnInkViolations\(/.test(renderCompile) &&
      /offFrameViolations\(/.test(renderCompile) &&
      /overrunViolations\(/.test(renderCompile),
    'the board assertions are no longer wired into compilePlan — overlap, off-frame and overrun ship silently again',
  );
  check(
    'Box hygiene (2.3): coordinates are finite and extents positive in the schema',
    /x: z\.number\(\)\.finite\(\)/.test(storyboard) &&
      /w: z\.number\(\)\.finite\(\)\.positive\(\)/.test(storyboard),
    'a NaN coordinate or zero-sized box parses again and survives to a wrong frame',
  );
}

/* ---- S4-e/D3 (2.6): the fill floor is a gate, and degrade is recorded ---- */
{
  const renderCompile = read('packages/render/src/compile.ts');
  const state = read('packages/pipeline/src/state.ts');
  check(
    'S4-e: the fill floor blocks through the gate and lands in pipeline.json under degrade',
    /mostly whitespace/.test(renderCompile) &&
      /fillMean < 0\.18 \|\| vacant\.length > 0/.test(renderCompile) &&
      /render\?: \{ problems: string\[\] \}/.test(state),
    'the fill gate is gone, or a --degrade override no longer leaves a record',
  );
}

/* ---- S7-b (2.5): pan time is derived from pan distance ---- */
{
  const camera = read('packages/core/src/camera.ts');
  check(
    'S7-b: resolveFraming bounds pan speed (MAX_VIEWS_PER_SEC)',
    /MAX_VIEWS_PER_SEC/.test(camera) && /dist \/ viewW \/ MAX_VIEWS_PER_SEC/.test(camera),
    'a long walk fits inside a fixed transition window again — five screens in 0.95s',
  );
}

/* ---- S4-f (2.4): the legibility floor, at the corpus-derived number ---- */
{
  const boardcheck = read('packages/render/src/boardcheck.ts');
  check(
    'S4-f: MIN_GLYPH_PX exists and compilePlan sweeps roles against it',
    /MIN_GLYPH_PX = 10/.test(boardcheck) &&
      /glyphFloorViolations/.test(read('packages/render/src/compile.ts')),
    'the legibility floor is gone — a caption at the pull-out floor ships at single-digit pixels again',
  );
}

/* ---- S4-a gap (2.7): the browser reports what it really laid out ---- */
{
  const runtime = read('packages/render/src/page/runtime.js');
  const render = read('packages/render/src/render.ts');
  check(
    'S4-a: the realized-layout report exists and render sweeps it before frame 0',
    /realizedLayout/.test(runtime) && /realizedTextViolations/.test(render),
    'the shrink-to-fit is invisible to the solver again — browser wrap can clip without anything noticing',
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

/* ---- S3-c (3.2): the board graph has a critique, and the edit path runs it ---- */
{
  const storyboard = read('packages/core/src/storyboard.ts');
  const ops = read('packages/pipeline/src/ops.ts');
  const anthropic = read('packages/planner/src/anthropic.ts');
  check(
    'S3-c: critiqueStoryboard exists and checks every reference the board carries',
    /export function critiqueStoryboard/.test(storyboard) &&
      /morphs out of/.test(storyboard) &&
      /emphasises/.test(storyboard) &&
      /does not declare/.test(storyboard) &&
      /is cued to/.test(storyboard),
    'the board graph is unchecked again — a dangling morph or emphasis is a move the film silently does not make',
  );
  check(
    'S3-c: applyOps reports what the edit did to the graph',
    /critiqueStoryboard\(storyboard\)/.test(ops),
    'a hand edit can dangle a reference again with nothing said until the render log',
  );
  check(
    'S3-d: the planner mint is loud, not a debug line',
    /noteProblem\(opts, note\)/.test(anthropic) &&
      !/log\.debug\(`added missing asset/.test(anthropic),
    'ensureAssets invents an entity from an id again at a log level nobody reads',
  );
}

/* ---- S9-a/S9-b (3.1): QC is a stage, and it writes its verdict down ---- */
{
  const stages = read('packages/pipeline/src/progress.ts');
  const cast = read('packages/pipeline/src/cast.ts');
  const checkStage = read('packages/render/src/check.ts');
  check(
    'S9-a: `check` is a stage between visuals and render',
    /'visuals',\n\s*\/\/[\s\S]*?'check',\n\s*'render',/.test(stages) &&
      /const \{ check \} = await loadCheck\(\)/.test(cast),
    'the quality gate is no longer a stage — nothing stands between a wrong board and the encode',
  );
  check(
    'S9-b: the gate writes qc.json, and never calls a model to fix what it found',
    /QC_FILE = 'qc.json'/.test(checkStage) &&
      /qcReport\(/.test(checkStage) &&
      // Call sites, not words: the file names `ANTHROPIC_API_KEY` in the sentence that
      // explains why Tier 2 skipped, which is the opposite of calling a model.
      !/messages\.create|@anthropic-ai\/sdk/.test(checkStage),
    'the gate stopped recording its verdict, or has grown a repair loop (the S9.10 trap)',
  );
  check(
    'S9-b: the gate runs the realized-layout sweep, not only the arithmetic',
    /realizedTextViolations/.test(checkStage) && /chromiumAvailable/.test(checkStage),
    'the one check that measures reality instead of intent is back to costing a whole encode to discover',
  );
}

/* ---- X-e/X-d (3.4): every degradation is loud, and the record survives the run ---- */
{
  const icons = read('packages/visuals/src/resolve.ts');
  const critic = read('packages/planner/src/draw-critic.ts');
  const audit = read('packages/planner/src/draw-audit.ts');
  const cast = read('packages/pipeline/src/cast.ts');
  check(
    'X-e: a score-0 icon match is recorded, not just drawn',
    /resolved to no icon at all/.test(icons) && /noteProblem\(args\.opts/.test(icons),
    'a generic glyph stands in for an unmatched entity again with nothing said',
  );
  check(
    'X-e: the critic records the outcomes that leave a defect standing',
    /noteProblem\(\s*opts,/.test(critic) && /was rejected/.test(critic),
    'a rejected or impossible correction is back to being a log line inside a keyed run',
  );
  check(
    "S9-c/X-d: a project's drawing history is recomputed from lesson.json, not remembered",
    /export function lessonDrawingDefects/.test(audit) &&
      /id: 'drawing', findings: drawingDefects/.test(cast),
    "the drawing lane's standing defects are known once, on the day they were drawn",
  );
}

/* ---- X-c (3.5): the expensive half of a keyed run appears in the total ---- */
{
  const anthropic = read('packages/planner/src/anthropic.ts');
  const cost = read('packages/pipeline/src/cost.ts');
  const drawAnthropic = read('packages/planner/src/draw-anthropic.ts');
  const critic = read('packages/planner/src/draw-critic.ts');
  const underlay = read('packages/pipeline/src/draw-underlay.ts');
  check(
    'X-c: callTool can report the tokens the API counted',
    /usage\?: \{ input_tokens\?: number; output_tokens\?: number \}/.test(anthropic) &&
      /res\.usage\?\.input_tokens/.test(anthropic),
    'the provider counts the tokens for us and the pipeline has stopped reading them',
  );
  check(
    'X-c: the drawing author, the critic and the underlay all report what they spent',
    /lane: 'drawing'/.test(drawAnthropic) &&
      /lane: 'drawing-fix'/.test(critic) &&
      /lane: 'underlay'/.test(underlay) &&
      /!raster\.cached/.test(underlay),
    'a lane that costs money is invisible to the cost report again — or a cache hit is being billed',
  );
  check(
    'X-c: reported-token lines are priced as measured, not estimated',
    /estimated: false,/.test(cost) && /as reported by the API/.test(cost),
    'the one honest quantity in the report has been folded back into the guesses',
  );
}

/* ---- S9-b/S9-d (3.3): something finally looks at the pixels ---- */
{
  const tier2 = read('packages/render/src/tier2.ts');
  const checkStage = read('packages/render/src/check.ts');
  const ink = read('packages/render/src/ink.ts');
  const inkstat = read('packages/render/src/inkstat.mts');
  const vision = read('packages/pipeline/src/frame-vision.ts');
  check(
    'S9-d: the gate measures ink in pixels, at the corpus-derived floor',
    /MIN_INK_SHARE = 0\.01/.test(tier2) && /inkFloorViolations/.test(checkStage),
    'the ungameable half of the fill gate is gone — a board can pass by inflating a box again',
  );
  check(
    'A-4: one definition of what counts as ink, shared by the gate and the film scorer',
    /export function statFrame/.test(ink) &&
      /from '\.\/ink\.js'/.test(inkstat) &&
      !/const DARK_ENOUGH/.test(inkstat),
    'inkstat.mts has grown its own copy of the ink threshold — the bake-off instrument and the gate can now disagree',
  );
  check(
    'S9-b: the sampler looks before the ink leaves, so a wiping board is not photographed blank',
    /fadeAt - MAX_FADE/.test(tier2),
    'the Tier-2 sampler is back to sampling scene ends — every wipe-mode card reads as 0% ink',
  );
  check(
    'S9-b: the vision pass is injected, keyed, and asks the same five questions every time',
    /export type VisionPass/.test(tier2) &&
      !/messages\.create|@anthropic-ai\/sdk/.test(tier2) &&
      /VISION_VERSION/.test(vision) &&
      /report_frames/.test(vision),
    'the renderer has acquired a model provider, or the rubric is no longer fixed',
  );
}

/* ---- S2-c/S6-c (4.4): the normaliser's named gaps stay closed ---- */
{
  const speech = read('packages/core/src/speech.ts');
  check(
    'S2-c: the normaliser folds sub/superscripts, so a formula is not handed over raw',
    /export function foldScripts/.test(speech) && /₀-₉/.test(speech),
    'H₂O is back to reaching the engine as a glyph no rule here recognises',
  );
  check(
    'S2-c: LaTeX residue is stripped before the symbol table sees it',
    /export function stripLatex/.test(speech) &&
      /stripMarkdown\(stripLatex\(foldScripts\(input\)\)\)/.test(speech),
    'narration carrying \\frac{1}{2} or $x^2$ is spoken verbatim again — or the stages have been reordered past markdown emphasis',
  );
  check(
    'S6-c: bra-ket and stage directions are spoken as a person would',
    /ket \$1/.test(speech) && /the inner product of \$1 and \$2/.test(speech),
    'the ⟨⟩ handling is gone — |0⟩ reads as "zero" plus a raw bracket',
  );
  check(
    'A-4: one narration normaliser, and the voice stage does not own it',
    !/normalizeNarration\b[\s\S]*?function/.test(read('packages/voice/src/cue.ts')),
    'a second normaliser has appeared in the voice stage — the planner and the voice stage can now disagree about which word is word seven',
  );
}

if (failures.length) {
  console.error(`\n${failures.length} audit check(s) failed.`);
  process.exit(1);
}
console.log('\nall audit checks hold.');
