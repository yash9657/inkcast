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

/* ---- S6-a/A-6 (4.1/4.2): a reveal lands on a word, not on a search ---- */
{
  const storyboardIr = read('packages/core/src/storyboard.ts');
  const compile = read('packages/planner/src/compile.ts');
  const cue = read('packages/voice/src/cue.ts');
  const narrate = read('packages/voice/src/narrate.ts');
  const ops = read('packages/pipeline/src/ops.ts');
  check(
    'S6-a: the IR carries the cue word index, and the compiler writes it',
    /cueWord: z\.number\(\)\.int\(\)\.min\(0\)\.optional\(\)/.test(storyboardIr) &&
      /cueWordIndex\(scene\.narration, cue\)/.test(compile),
    'PIPELINE.md step 8 has been un-shipped — reveals are back to being found by phrase search',
  );
  check(
    'S6-a: the voice stage prefers the index and verifies it against its own cue',
    /via: 'index'/.test(cue) && /brokenIndices/.test(cue) && /cueTokens\(cue\)\[0\]/.test(cue),
    'the index is trusted blind or ignored — a stale index must be named, not silently obeyed',
  );
  check(
    'A-6: an unusable index is gated, and a searched cue is recorded',
    /for \(const broken of brokenIndices\)/.test(narrate) &&
      /gate\(opts\.gates, broken/.test(narrate) &&
      /searchedCues/.test(narrate),
    'a mis-anchored reveal is back to being a log line nobody reads',
  );
  check(
    'S6-a: editing narration re-takes the indices it invalidates',
    /function recueScene/.test(ops) && /recueScene\(scene, applied\)/.test(ops),
    'set-narration leaves indices that resolve and no longer mean anything',
  );
}

/* ---- S0-c/S6-d (4.3): length is measured against the plan every run ---- */
{
  const drift = read('packages/core/src/drift.ts');
  const cast = read('packages/pipeline/src/cast.ts');
  const state = read('packages/pipeline/src/state.ts');
  const lesson = read('packages/core/src/lesson.ts');
  check(
    'S0-c: the film is measured against its budget, at the critique’s own tolerance',
    /BUDGET_TOLERANCE = 1\.25/.test(drift) && /opts\.maxSeconds \* 1\.25/.test(lesson),
    'the gate and the lesson critique no longer agree about what "over budget" means',
  );
  check(
    'S6-d: DELIVERED_LPS is compared against what the run delivered, not remembered',
    /measureDrift\(sb, \{/.test(cast) &&
      /expectedWps: design\.presetShape\.wordsPerSecond/.test(cast) &&
      /expectedLps: design\.presetShape\.wordsPerSecond \* LETTERS_PER_WORD/.test(cast) &&
      /PACE_TOLERANCE = 0\.1/.test(drift),
    'the calibration behind every length decision is back to being a comment that says re-measure me',
  );
  // The rule `drift.ts`'s own header states — a comparison between two conventions is not
  // a measurement — turned into something that fails. The estimate and the check must count
  // with the *same function*, not with two that happen to agree today: they live in
  // different packages, and the last time this repo let two of those drift apart it cost
  // the `text.ts`/`speech.ts` split a re-pin. Pinned because `spokenLetters` is one line
  // and re-implementing it locally would be the obvious shortcut.
  check(
    'S6-d: the estimate and the drift check count in the same unit, from one function',
    /spokenLetters\(b\.step\.narration\)/.test(read('packages/planner/src/presets.ts')) &&
      /spokenLetters\(s\.narration\)/.test(drift) &&
      /export function spokenLetters/.test(read('packages/core/src/speech.ts')),
    'the length estimate and the check on it count differently — the advisory now measures nothing',
  );
  check(
    'S0-c: both numbers reach the record, not just the log',
    /id: 'duration'/.test(cast) && /id: 'pace-calibration'/.test(cast) && /drift\?: \{/.test(state),
    'the drift numbers are a log line again — a run cannot be compared with the one before it',
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

/* ---- S0-a (5.1): a bare-topic run says so, rather than looking like a sourced one ---- */
{
  const state = read('packages/pipeline/src/state.ts');
  const cast = read('packages/pipeline/src/cast.ts');
  check(
    'S0-a: `grounding` is a recorded fact with three honest values',
    /export type Grounding = 'document' \| 'parametric' \| 'supplied'/.test(state) &&
      /grounding\?: Grounding/.test(state),
    'the project record no longer distinguishes a film built from a document from one taught out of the model’s memory',
  );
  check(
    'S0-a: it is read off what reached the author, not off the flags',
    /supplied \? 'supplied' : doc \? 'document' : 'parametric'/.test(cast) &&
      /grounding: design\.grounding/.test(cast),
    '`kind: topic` and `kind: text` are both things a user typed and only one of them grounds anything — derive it from the doc',
  );
  check(
    'S0-a: the studio says it too',
    /function GroundingNote/.test(read('apps/web/components/studio/result-view.tsx')),
    'the honesty exists in pipeline.json and nowhere a viewer looks',
  );
}

/* ---- S0-b (5.2): a claim can point back at the document it came from ---- */
{
  const lesson = read('packages/core/src/lesson.ts');
  check(
    'S0-b: LessonStep carries sourceRef, and it is checked against real headings',
    /sourceRef: z\.string\(\)\.optional\(\)/.test(lesson) &&
      /cites source section/.test(lesson) &&
      /sections\?: readonly string\[\]/.test(lesson),
    'the link between a claim and its source is severed at the lesson boundary again — audit S0-b',
  );
  check(
    'S0-b: absent sections mean "cannot check", never "nothing is valid"',
    /sections !== undefined && step\.sourceRef !== undefined/.test(lesson),
    'a lesson edited without its document in hand would now fail every ref it cannot verify',
  );
  check(
    'S0-b: the author is asked for refs only when there is a document to point at',
    /if \(outline\) lines\.push\(SOURCE_REF_RULE\)/.test(
      read('packages/planner/src/lesson-anthropic.ts'),
    ),
    'a bare-topic author is being shown a field it cannot fill, which is how it gets filled wrongly',
  );
}

/* ---- S1-c/S1-d (5.3): the two pedagogy rules, and the budget saying what it cut ---- */
{
  const lesson = read('packages/core/src/lesson.ts');
  const presets = read('packages/planner/src/presets.ts');
  check(
    'S1-c: a STEM or first-principles lesson must name its misconception',
    /l\.kind === 'stem' \|\| l\.strategy === 'first-principles'\) && !l\.misconception/.test(
      lesson,
    ),
    'the refutation is optional again — the beat whose job is to overwrite a wrong belief can vanish unremarked',
  );
  check(
    'S1-c: every beat the budget deletes is recorded, not logged',
    /noteProblem\(\s*opts,/.test(presets) && /was cut to fit the/.test(presets),
    "adaptLesson's cuts are back to being a log.debug — the most consequential thing it does lives for one terminal session",
  );
  check(
    'S1-d: concrete before abstract is checked outside the analogy lane',
    /function isAbstractBeat/.test(lesson) &&
      /function isConcreteBeat/.test(lesson) &&
      /l\.strategy !== 'analogy'/.test(lesson),
    'a graph can arrive before anything real is drawn again, everywhere `findReuse` does not reach',
  );
}

/* ---- S1-b (5.4): the DAG gets an opinion, and it stays out of the critique ---- */
{
  const lesson = read('packages/core/src/lesson.ts');
  const cast = read('packages/pipeline/src/cast.ts');
  check(
    'S1-b: the order advisory is its own function, not a critique rule',
    /export function lessonOrderAdvisories/.test(lesson) &&
      !/lessonOrderAdvisories\(/.test(
        lesson.slice(
          lesson.indexOf('export function critiqueLesson'),
          lesson.indexOf('export function lessonOrderAdvisories'),
        ),
      ),
    'the advisory has been folded into critique — which feeds the author a demand to reorder a lesson whose order is the design',
  );
  check(
    'S1-b: it reaches qc.json as a warning',
    /id: 'lesson-order', findings: design\.orderAdvisories, severity: 'warn'/.test(cast),
    'the second opinion is a log line again, or it has stopped being advisory',
  );
}

/* ---- A-1 (5.5): the sidecar keeps no copy of the storyboard's timing ---- */
{
  const manifest = read('packages/visuals/src/manifest.ts');
  const resolve = read('packages/visuals/src/resolve.ts');
  const keys = read('packages/pipeline/src/keys.ts');
  check(
    'A-1: ElementVisual carries no enterAt / enterDuration / persist',
    !/^\s*(enterAt|enterDuration|persist)\??:/m.test(manifest) &&
      !/enterAt: el\.enter\.at/.test(resolve) &&
      // At least 3, not exactly 3. The bump is what made the removal safe — an older
      // sidecar is refused rather than half-read — and version 3 is the one that did it.
      // Pinning the literal made this a version tracker instead of a fact check, and it
      // failed the day the code lane's own layout bumped it to 4.
      Number(/MANIFEST_VERSION = (\d+)/.exec(manifest)?.[1] ?? 0) >= 3,
    'the sidecar is duplicating timing the visuals fingerprint deliberately excludes — stale on every re-voice, read by nothing',
  );
  check(
    'A-1: `--force` announces a storyboard it is about to clobber',
    /export function compiledFingerprint/.test(keys) &&
      /had been edited since it was compiled/.test(read('packages/pipeline/src/cast.ts')),
    'the two-altitude clobber is silent again — a hand-edited board is recompiled away with nothing said',
  );
}

/* ---- A-2/S3-b (5.6): model coordinates do not survive a re-layout ---- */
{
  const layout = read('packages/planner/src/layout.ts');
  const ops = read('packages/pipeline/src/ops.ts');
  check(
    'A-2: re-layout re-anchors arrows, path points and motion trajectories',
    /function inferArrowAnchors/.test(layout) &&
      /function reanchorGeometry/.test(layout) &&
      /el\.motion\.path = el\.motion\.path\.map\(sceneMap\)/.test(layout),
    'the document route is leaking coordinates again: the packer moves the boxes and the arrow between them stays where the model imagined it',
  );
  check(
    'A-2: the set-camera op offers intents, never coordinates',
    /framing\?: 'tighter' \| 'wider'/.test(ops) &&
      !/zoom: \{ type: 'number' \}/.test(ops) &&
      /function clampCamera/.test(ops),
    'a raw x/y/zoom is applied verbatim again — one camera in the film that nothing checked against its own board',
  );
}

/* ---- S5-a (6.1): the four gaps are named, reported, and not a gate ---- */
{
  const lanes = read('packages/core/src/lanes.ts');
  const cast = read('packages/pipeline/src/cast.ts');
  check(
    'S5-a: the unserved lanes are named where three packages can read them',
    /export function unservedLanes/.test(lanes) &&
      // Three, not the original four: `code` came out when 6.2 built that lane. The
      // expiry check below is what forced it out, and is what will force the next one.
      ['chemistry', 'circuits', 'geography'].every((l) =>
        new RegExp(`^\\s{2}${l}: \\{`, 'm').test(lanes),
      ),
    'a topic class this pipeline cannot draw has stopped being declared — the fallback for it is a confidently wrong picture and nothing says so',
  );
  check(
    'S5-a: a gap reaches qc.json, and as a warning',
    /id: 'lane-coverage', findings: laneGapLines\(design\.laneGaps\), severity: 'warn'/.test(cast),
    'the guard is a log line again, or it has become a gate — it is a fact about this pipeline, not about that board',
  );
  check(
    'S5-a: the guard warns, it does not refuse to draw',
    !/\bgate\(/.test(lanes) && !/throw /.test(lanes),
    'the lane guard blocks now: trading a wrong picture for a missing one is 6.2/6.3’s decision, made with frames in front of you',
  );
  // The table's own expiry date. Each lane names the packages that would end it, so the
  // day one is installed the entry has to come out — otherwise the studio goes on
  // apologising for a lane that exists. Reads `package.json` files, not modules.
  //
  // **Every name it matched was unmatchable until 6.3** (see `UNSERVED`'s comment): the
  // npm package is `@rdkit/rdkit` rather than `rdkit`, `schemdraw` is Python, and a map
  // lane installs `topojson-client`. A tripwire nobody can trip is worse than none,
  // because it is *recorded* as the thing that means you cannot forget. Names are checked
  // against the registry now, and the scoped-package case is why the pattern below is not
  // simply `"name":`.
  {
    const manifests =
      ['package.json', 'packages/visuals/package.json', 'packages/planner/package.json', 'packages/render/package.json', 'packages/core/package.json'] // prettier-ignore
        .map((f) => read(f))
        .join('\n');
    const named = [...lanes.matchAll(/ends: \[([^\]]*)\]/g)]
      .flatMap((m) => [...m[1]!.matchAll(/'([^']+)'/g)].map((q) => q[1]!))
      .filter((v, i, all) => all.indexOf(v) === i);
    check(
      'S5-a: every package that would end a lane is one that could really be installed',
      named.length > 0 && named.every((dep) => /^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(dep)),
      `${named.join(', ')} — a lane names an expiry package that is not a valid npm name, so its tripwire can never fire`,
    );
    const built = named.filter((dep) =>
      new RegExp(`"${dep.replace(/[/@.]/g, '\\$&')}"\\s*:`).test(manifests),
    );
    check(
      'S5-a: no lane is declared unserved after its renderer has been installed',
      built.length === 0,
      `${built.join(', ')} is a dependency now — that lane exists, so delete it from UNSERVED and stop warning about it`,
    );
  }
  // Circuits is the lane no library ends: it needs curated symbols, so the asset library
  // is its tripwire. `docs/LANE-CIRCUITS.md` argues that; this is what enforces it.
  check(
    'S5-a: circuits stays unserved only while the symbol set really is missing',
    /circuits: \{ needs: .*ends: \[\] \}/.test(lanes) &&
      !/symbols\/circuit\//.test(read('assets/library/library.json')),
    'the circuit symbols are in the library now — that lane can be built, so it stops being a gap the guard apologises for',
  );
}

/* ---- S5-a (6.3): the lane order is measured, argued, and re-runnable ---- */
{
  const demand = read('packages/pipeline/src/lanedemand.mts');
  check(
    'S5-a: the demand signal 6.3 chooses by is an instrument, not a memory',
    /unservedLanes\(/.test(demand) && /fixture/.test(demand),
    'the lane demand signal is back to being reconstructed by hand from fifty project directories — which is how a demand-driven plan becomes a taste-driven one',
  );
  check(
    'S5-a: each unserved lane has its one-page doc, written before any code',
    ['CHEMISTRY', 'CIRCUITS', 'GEOGRAPHY'].every((l) => read(`docs/LANE-${l}.md`).length > 500),
    'a lane doc is missing — the plan requires one per lane before its code, because each lane is a dependency choice as much as a feature',
  );
  check(
    'S5-a: the waiver for shipping no lane is written down (W8)',
    /\*\*W8 — S5-a/.test(read('docs/AUDIT-FINDINGS.md')),
    '6.3 ships three lane docs and no lane, and the argument for that has to be a named waiver the re-audit can read — not an absence',
  );
}

/* ---- S5-a (6.2): the code lane sets source, and never letters it ---- */
{
  const code = read('packages/visuals/src/code.ts');
  const grid = read('packages/core/src/codegrid.ts');
  const font = read('packages/core/src/fontmetrics.ts');
  const compile = read('packages/render/src/compile.ts');
  const resolve = read('packages/visuals/src/resolve.ts');
  const planner = read('packages/planner/src/compile.ts');
  const brief = read('packages/planner/src/lesson-anthropic.ts');

  check(
    'S5-a: code is set from real glyph outlines, crisp, in document order',
    /ink: 'crisp'/.test(code) && /mono\.outline\(/.test(code) && /outline\(codePoint/.test(font),
    'the code lane has stopped reading letterforms out of the face — a listing the browser substituted a glyph into is a different program (D1, in monospace)',
  );
  check(
    'S5-a: one code grid, measured by both stages',
    /export function codeGrid/.test(grid) &&
      /export function codeBox/.test(grid) &&
      /codeGrid\(/.test(code) &&
      /codeBox\(/.test(read('packages/planner/src/elements.ts')),
    'the planner and the visuals stage count a listing’s columns separately again — the A-4 defect, one lane over',
  );
  check(
    'S5-a: highlighting spends the film’s palette, not a theme’s',
    /toneInk\(ctx\.pal, part\.tone\)/.test(compile) && /tone: Tone/.test(code),
    'a listing is drawn in colours the visuals stage chose — the 2.2 remap means they reach no pixel, and a dozen hues would be the rainbow board the palette forbids',
  );
  check(
    'S5-a: a listing that will not set is gated, never handwritten quietly',
    /code \$\{el\.id\} could not be set/.test(resolve) &&
      /has no set geometry/.test(compile) &&
      /gate\(/.test(compile),
    'the code lane falls back to the handwriting font without stopping — that fallback is the whole defect the lane was built to end',
  );
  check(
    'S5-a: code never funnels through makeText',
    /export function makeCode/.test(read('packages/planner/src/elements.ts')) &&
      /return buildCode\(listing, describe, ctx\)/.test(planner),
    'a listing routed through makeText meets sniffMath, whose TeX test fires on a Windows path, a shell variable and most regexes — code would be typeset as mathematics',
  );
  check(
    'S5-a: the lesson brief advertises the code lane and its field',
    // The brief is a template literal, so its own backticks are escaped in the source.
    /- \*\*code\*\* —/.test(brief) && /\\`code\\`/.test(brief) && /\\`lang\\`/.test(brief),
    'a lane the author is not told about is a lane that never runs (the S5-b rule, applied to 6.2)',
  );
}

/* ---- S5-e / S5.6 (6.4): a raster earns its place on the board ---- */
{
  const image = read('packages/visuals/src/image.ts');
  const png = read('packages/visuals/src/png.ts');
  const resolve = read('packages/visuals/src/resolve.ts');

  // The trap the pose lane learned first: caching a rejection makes it permanent, and the
  // retry then pays to enshrine the miss. Checked as an *ordering* fact in the source,
  // because both spellings compile and only one is right.
  {
    const loop = image.slice(image.indexOf('for (let attempt = 1; attempt <= 2; attempt++)'));
    const verdictAt = loop.indexOf('if (verdict.ok) {');
    const stashAt = loop.indexOf('stash(abs, png');
    check(
      'S5-e: only an accepted generation is ever written to a cache',
      verdictAt > 0 && stashAt > verdictAt,
      'a rejected raster is being cached — the retry above then costs money to reject it once and keep it forever',
    );
  }
  check(
    'S5-e: one retry and no more',
    /attempt <= 2; attempt\+\+/.test(image),
    'the illustration lane loops on a provider now — a model that missed twice will miss a third time, and a render is waiting (`resolveGeneratedPose`’s rule)',
  );
  check(
    'S5-e: a cached raster is judged too, not trusted for being old',
    /judge\(own, /.test(image) && /judge\(machine, /.test(image),
    'the caches predate the gate and hold the audit’s own evidence (a blank page reading “Salèylic acisH.”) — a gate that trusts them never fires on the corpus we have',
  );
  check(
    'S5-e: a rejection reaches the run’s record, not only the log',
    /args\.onProblem\?\.\(note\)/.test(image) &&
      /onProblem: \(note\) => noteProblem\(/.test(resolve),
    'a rejected generation was paid for; if it only reaches the log it shows up in the bill and nowhere a reader looks (plan 3.4’s rail)',
  );
  check(
    'S5-e: the gate and the draw measure the same ink',
    /const SPECK_AREA_SHARE/.test(image) &&
      (image.match(/SPECK_AREA_SHARE/g) ?? []).length >= 3 &&
      (image.match(/MAX_TRACED_PATHS/g) ?? []).length >= 3,
    'the gate scores a trace the reveal will not draw — the A-4 defect again: two measurements of one thing',
  );
  check(
    'S5.6: a figure’s ground is read from real pixels, and abstains when it cannot be',
    /export function groundWhiteness/.test(png) &&
      /return ABSTAIN/.test(image) &&
      /if \(white === undefined\) return ABSTAIN/.test(image),
    'the ground check condemns what it cannot see — a missing decode path would turn every unusual PNG into a lane outage',
  );
  check(
    'S5-e: the gate does not claim to be the identity check it is not',
    /accepts a confident drawing of the wrong thing/.test(image),
    'the gate’s header has stopped saying what it cannot do — it passes the hallucinated benzene ring at 0.91, and the next reader has to be told that before they trust it',
  );
}

/* ---- S5-d (6.5): the figure cache key names the model that draws it ---- */
{
  const image = read('packages/visuals/src/image.ts');
  const resolve = read('packages/visuals/src/resolve.ts');

  check(
    'S5-d: a figure’s model is one of its cache key’s inputs',
    /export function figureModelToken/.test(image) &&
      /const token = kind === 'figure' \? figureModelToken\(model\) : ''/.test(image) &&
      /illustrationKey\(args\.id, args\.prompt, kind, aspect, model\)/.test(image),
    'an INKCAST_FIGURE_MODEL switch silently serves the old model’s raster again — a figure is shown as it arrived, so the model is the picture',
  );
  check(
    'S5-d: the built-in endpoints keep contributing nothing',
    /const DEFAULT_FIGURE_MODELS = new Set\(Object\.values\(MODELS\)\.map\(\(m\) => m\.figure\)\)/.test(
      image,
    ),
    'the default model is in the key now, so every figure raster in every machine cache invalidates for bytes that would be identical — the square token’s mistake, made twice',
  );
  check(
    'S5-d: a form raster’s key still ignores the model',
    /kind === 'figure' \? figureModelOverride\(\) : undefined/.test(image),
    'a form raster is binarised and re-traced, so the model does not survive into the board — invalidating those pays twice for the same ink',
  );
  check(
    'S5-d: the project’s own asset key moves with the figure model too',
    /const figureFP = figureModelToken\(figureModelOverride\(\)\)/.test(resolve) &&
      /asset\.kind === 'figure' \? figureFP : ''/.test(resolve),
    'a re-cast finds the asset fresh in the manifest and never reaches the raster tier, so the switch appears to do nothing and the film keeps the old picture',
  );
  check(
    'S5-d: a key-caused miss says which file it declined to serve',
    /was not served/.test(image) && /INKCAST_FIGURE_MODEL=\$\{model\}/.test(image),
    'switching the model re-bills a subject the cache visibly holds, with nothing in the run saying why (plan 6.5’s done-bar is “misses *and says why*”)',
  );
}

/* ---- S7-a (7.2): the plan is inspectable on demand, and only on demand ---- */
{
  const emit = read('packages/render/src/emitplan.ts');
  const cast = read('packages/pipeline/src/cast.ts');
  const rows = read('packages/render/src/planrows.ts');
  const tool = read('packages/render/src/planhash.mts');

  check(
    'S7-a: the emitted plan says nothing reads it back',
    /Nothing reads it back/.test(emit) && /_note/.test(emit),
    'the audit’s whole objection to persisting the plan was that a derived copy can drift — the file has to tell the next person who edits it that it changes no pixel',
  );
  check(
    'S7-a: nothing in the tree reads plan.json',
    !/readFile[^\n]*PLAN_FILE|readFileSync[^\n]*plan\.json|require\([^\n]*plan\.json/.test(
      [
        emit,
        cast,
        read('packages/render/src/render.ts'),
        read('packages/render/src/check.ts'),
      ].join('\n'),
    ),
    'plan.json has become an input — that is the drift-capable derived copy S7-a argued against, and the plan is a pure function of storyboard.json',
  );
  {
    // Ordering, in the source: the emission has to happen before the render cache is
    // consulted, or `--emit-plan` writes nothing on exactly the runs where the video is
    // already current — which is the common case on a re-cast.
    const emitAt = cast.indexOf('planPath = await emitPlan(sb!, run.dir)');
    const keyAt = cast.indexOf('const renderKey = renderFingerprint(sb)');
    check(
      'S7-a: --emit-plan runs outside the render cache',
      emitAt > 0 && keyAt > emitAt,
      'the flag is inside the branch that a cached render skips, so it silently writes nothing whenever the mp4 is up to date',
    );
  }
  check(
    'S7-a: the plan is compiled quietly, and cannot fail a run',
    /gates: 'degrade'/.test(emit) && /quiet: true/.test(emit),
    'asking to see the plan can now throw, or prints every board advisory a second time — the run’s real gate already fired in check()',
  );
  check(
    'S7-a: planhash keeps timing opt-in, in a mode of its own',
    /--timing/.test(tool) &&
      /export function timed/.test(rows) &&
      /if \(opts\.timing\)/.test(rows) &&
      !/'start'|'dur'/.test(
        rows.slice(rows.indexOf('export function drawn'), rows.indexOf('export function timed')),
      ),
    'timing has leaked into the default hash — `enter.at` is rewritten on every re-narration, so that tool would report a diff on every run and answer no geometry question',
  );
}

/* ---- S10-b (7.1): a segment is reusable, and says what it is made of ---- */
{
  const segs = read('packages/render/src/segments.ts');
  const render = read('packages/render/src/render.ts');
  check(
    'S10-b: segments are cut on scene boundaries, not on worker slices',
    /export function planSegments\(plan: RenderPlan/.test(segs) &&
      /sceneStartFrame/.test(segs) &&
      !/Math\.min\(workers/.test(segs) &&
      !/Math\.min\(workers/.test(render),
    'the cut is back to equal worker slices — a segment straddles two scenes again and nothing about it can be cached',
  );
  check(
    'S10-b: a segment’s key carries the board it inherits, not just its own scene',
    /export function itemsInSegment/.test(segs) &&
      /item\.persist \? Infinity : item\.sceneEnd/.test(segs) &&
      /itemsInSegment\(plan, seg\)/.test(segs.slice(segs.indexOf('export function segmentKey'))),
    'the accumulated prior board state has dropped out of the key — a tail edit would reuse segments whose pixels moved',
  );
  check(
    'S10-b: encoder settings are in the key, and a segment is named only once complete',
    /enc,/.test(segs.slice(segs.indexOf('export function segmentKey'))) &&
      /`\.part-/.test(render) &&
      /await rename\(tmp, out\)/.test(render),
    'either a differently-configured encoder can serve a cached segment (not byte-identical), or a killed render leaves a truncated mp4 where the next run reads a finished one',
  );
  check(
    'S10-b: the segment directory survives a successful render',
    /keepSegments/.test(render) && !/rm\(segDir, \{ recursive: true/.test(render),
    'the cache is deleted on success again, so only a failed render leaves anything to reuse',
  );
}

/* ---- X-f (7.3): a style is a JSON file, and nothing keeps a table of four ---- */
{
  const packLoader = read('packages/core/src/stylepack.ts');
  const visualsStyle = read('packages/visuals/src/style.ts');
  const renderPalette = read('packages/render/src/palette.ts');
  const renderFont = read('packages/render/src/font.ts');
  const camera = read('packages/core/src/camera.ts');
  const fontmetrics = read('packages/core/src/fontmetrics.ts');
  const storyboard = read('packages/core/src/storyboard.ts');
  const shipped = ['marker', 'pencil', 'chalk', 'ink'];

  check(
    'X-f: the four shipped personalities are files in styles/',
    shipped.every((id) => {
      const pack = JSON.parse(read(`styles/${id}.json`)) as { id: string; pen?: unknown };
      return pack.id === id && !!pack.pen;
    }),
    'a shipped style pack is missing, misfiled or has lost its pen — the loader refuses an id that disagrees with its filename, so the run would fail at parse',
  );
  check(
    'X-f: no package keeps an ink table of its own any more',
    !/marker: \{/.test(visualsStyle) &&
      !/marker: \{/.test(renderPalette) &&
      !/marker: \{/.test(renderFont) &&
      !/marker: 1\.0/.test(camera) &&
      !/HAND_FONTS/.test(fontmetrics) &&
      [visualsStyle, renderPalette, renderFont, camera, fontmetrics].every((f) =>
        /stylePackFor|handFontFor|knownHandStems|stylePacks/.test(f),
      ),
    'one of the five tables this item collapsed has grown back — a fifth style would need TypeScript again, and the pen the page draws could drift from the face the planner measured with',
  );
  check(
    'X-f: meta.style is validated against styles/, not against a union of four',
    /isStyleId/.test(storyboard) && !/z\.enum\(\['marker'/.test(storyboard),
    'the IR enumerates four style names again, so a pack in styles/ cannot be named by a film',
  );
  check(
    'X-f: the fixed-accent discipline is enforced by the loader’s schema',
    /accent: Colour/.test(packLoader) &&
      /accent must differ from the ink/.test(packLoader) &&
      /tellable apart/.test(packLoader) &&
      !/accents:\s*z\./.test(packLoader),
    'a pack can declare a list of accents again — which is the rainbow board core/src/palette.ts exists to prevent',
  );
  check(
    'X-f: a dark-surface pack is refused until the alpha work exists (S5.6)',
    /MIN_PAPER_LUMA/.test(packLoader) && /multiply/.test(packLoader),
    'a pack may now paint a slate board, where every generated figure multiplies into the surface and disappears — 6.4 detects that ground, it does not remove it',
  );
  check(
    'X-f: an edited pack invalidates what it drew',
    /styleKey\(/.test(read('packages/pipeline/src/keys.ts')) && /styleKey\(/.test(visualsStyle),
    'a cache key carries the style *name* again — editing styles/marker.json would serve yesterday’s ink from the cache',
  );
}

if (failures.length) {
  console.error(`\n${failures.length} audit check(s) failed.`);
  process.exit(1);
}
console.log('\nall audit checks hold.');
