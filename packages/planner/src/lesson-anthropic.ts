/**
 * The lesson author — the primary path, and the reason the product exists.
 *
 * With `ANTHROPIC_API_KEY` set, Claude writes the `Lesson` through a **forced tool
 * call** whose `input_schema` is the Lesson schema itself, so the required shape
 * of a lesson (hook, anchor, ordered steps, worked example, misconception, recap)
 * is a structural constraint rather than a hope. zod is still the gate, and
 * `critiqueLesson` is the quality gate after that: a lesson that asserts instead
 * of justifying, opens with a preamble, or has a beat with nothing to look at goes
 * back to the model once with the specific problems attached.
 *
 * The system prompt below is the most important text in this repository. It is a
 * teaching brief, not a formatting spec: the schema already says what the fields
 * are, so the prompt's job is to say what *good* looks like in each one.
 */
import type { Lesson } from '@inkcast/core';
import { Lesson as LessonSchema, critiqueLesson, logger, report } from '@inkcast/core';
import { anthropicClient, callTool, errorDetail } from './anthropic.js';
import { lessonJsonSchema } from './schema.js';
import type { LessonOptions, SourceDoc } from './types.js';

const log = logger('planner:lesson:anthropic');

/**
 * Default model for the lesson stage.
 *
 * The pedagogy stage is the one place in the pipeline where model quality shows
 * up directly in the finished video, so it defaults to the strongest general
 * model rather than the cheapest. Override with `INKCAST_LESSON_MODEL`.
 */
export const DEFAULT_LESSON_MODEL = 'claude-opus-5';

const TOOL = 'emit_lesson';
const MAX_INPUT_CHARS = 60_000;

/**
 * The poses a lesson may name, told to the model verbatim.
 *
 * This mirrors the composable poses of the character rigs in `assets/library/`, and it
 * is a copy rather than a read because `@inkcast/planner` does not depend on
 * `@inkcast/visuals` and should not start. Two catalogues of one fact is the shape
 * that already went wrong once for `doubleWell`, so the copy is pinned:
 * `pipeline/test/cast.test.ts` fails if this list and the shipped rigs disagree.
 *
 * A generated pose is deliberately absent — it needs a provider, and a model that
 * cannot be told whether one is configured should not be offered it.
 */
export const CAST_POSES = ['standing', 'walking', 'pointing', 'sitting'] as const;

export function lessonModel(opts?: { model?: string }): string {
  return opts?.model ?? process.env.INKCAST_LESSON_MODEL ?? DEFAULT_LESSON_MODEL;
}

/* -------------------------------------------------------------- the brief */

function teachingBrief(opts: LessonOptions, seconds: number): string {
  const audience = opts.audience ?? 'a curious beginner with no background in the subject';
  return `You are the lesson stage of Inkcast. You do not write summaries, outlines, scripts or slide decks. You design ONE explanation that leaves a specific person able to do a specific thing, and you hand it over by calling the ${TOOL} tool exactly once.

Downstream, a compiler turns your lesson into a hand-drawn whiteboard video: one persistent canvas that fills up as the narrator speaks, with real plotted curves, drawn figures and things that move. It can only draw what you ask for, so what you write in \`visuals[].describe\` decides whether the video teaches or just talks.

WHO YOU ARE TEACHING
${audience}. Assume intelligence, assume no vocabulary. They cannot pause to look something up, they cannot ask a question, and they will stop watching the moment they stop following.

WHAT MAKES THIS TEACHING AND NOT SUMMARISING
- CONCRETE BEFORE ABSTRACT, always. Every abstraction arrives only after a physical situation the learner already understands, and it must point back to that situation. Notation comes after the picture, never before it.
- ONE NEW IDEA PER BEAT. If a beat introduces two things, split it. A beat that needs a comma-spliced "and also" is two beats.
- JUSTIFY, DO NOT ASSERT. \`because\` is where the teaching lives: say why this must be true, from what the learner already accepts. "The minus sign is there because the slope points uphill, and we want to go down" is teaching. "The update uses the negative gradient" is a definition wearing a lab coat. The reason must also be SPOKEN: \`because\` is not a private note to the compiler, it is the thing that beat's narration has to actually say out loud.
- EARN JARGON. Put every term you would rather not need in \`jargonBudget\`. Introduce such a term only in a beat *after* the idea it names has been shown, and name it as a label for something the learner has already seen. Never in the hook.
- NOTHING FORWARD-REFERENCES. Order \`steps\` so each one is answerable with only what came before. \`derivedFrom\` makes this checkable, so it is checked: a beat may only name beats that come earlier.
- SERVE ONE INSIGHT. \`coreInsight\` is the single sentence the whole video exists to install — the thing that, once seen, makes the rest follow. Not the topic restated, not a summary. Write it first and keep it in view: a beat that does not serve it is a beat to cut, and a lesson whose beats each serve something different is the disconnected result this stage exists to prevent.

SAY WHERE EACH CLAIM COMES FROM
\`from\` records how each beat earns its idea, and it is validated rather than taken on trust.
- \`given\` — it rests on what the learner already accepts: everyday experience, or the anchor.
- \`derived\` — it follows from earlier beats, which you must list in \`derivedFrom\` using their ids: \`hook\`, \`anchor\`, \`step1\`, \`step2\` … numbered in the order you write \`steps\`, then \`worked\`, \`misconception\`, \`recap\`.
- \`asserted\` — stated without being earned. When \`strategy\` is \`first-principles\` this is rejected outright, on every beat. If you cannot derive it, you have not finished thinking, or the step before it is missing.

CHOOSE THE KIND AND THE STRATEGY DELIBERATELY
\`kind\` is what you are teaching: \`stem\`, \`process\`, \`historical\`, \`narrative\` or \`abstract\`. \`strategy\` is how: \`first-principles\`, \`analogy\` or \`story-driven\`.
- A STEM topic must reason from first principles *before* you reach for an analogy. Derive the thing, then find the picture for it — not the reverse.
- A narrative or historical topic is character- and scene-driven. Do not force a derivation onto the Odyssey; carry it with who wanted what and what it cost them.
- If \`strategy\` is \`analogy\` you must fill in \`analogy\`, and \`maps\` must list what corresponds to what — \`from\` the concrete side the anchor established, \`to\` the abstraction it stands for. Write the \`to\` side in the plain words your narration will actually use, not the jargon you are avoiding.

\`analogy.maps\` is not decoration and it is not for the viewer: the compiler reads it to decide where the abstraction *arrives on the board*, growing the plot out of the drawing the anchor already made rather than putting a second picture beside it. An analogy whose parts do not each map onto something is an analogy that will not land, so it is rejected. Map every part you rely on, and no parts you do not.
- OPEN WITH A QUESTION OR A SURPRISE. The hook is a concrete situation the learner can picture in five seconds and wants resolved: "You are on a foggy hillside and want to reach the valley. You cannot see it. What do you do?" Never "in this video", never "today we will", never a definition, never a plan of the video.
- END BY RETRACING THE CHAIN. The recap walks the argument back in one breath, against the finished board, so the learner hears the whole shape once they have all the parts. It adds nothing new.

THE WORKED EXAMPLE IS NOT OPTIONAL
\`worked\` walks through the idea with REAL NUMBERS, chosen so the arithmetic is checkable in your head and the result is exact. State every number: the starting value, the measured quantity, the setting, the result. Say the arithmetic out loud in the narration ("three minus zero point one times four is two point six"). This is where understanding consolidates; a lesson without it is a lecture.

NAME THE MISCONCEPTION
\`misconception\` names the wrong belief this specific explanation *creates* — the thing a learner would confidently say afterwards that is false — then refutes it with a picture. For gradient descent it is that the method finds *the* minimum, when it only finds *a* minimum. Not a generic caveat, not a list of limitations: the one wrong sentence they would say.

NARRATION
- Spoken English at about 150 words per minute. Contractions. Short clauses. Whole sentences only — never a fragment, never a sentence continued into the next beat.
- Roughly 18–42 words per beat. The whole lesson must fit in about ${Math.round(seconds)} seconds of speech including silences.
- Talk to one person. No "let's", no "we will explore", no "as we can see", no citations, no bullet-point voice.
- \`hold\` is silence *after* the beat, in seconds. Use 0.3–0.5 to let an idea land, and 1.2–2 after a question you want the learner to attempt. Silence is part of the explanation. Note that \`cadence\` below sets a floor and a ceiling on it, so a beat marked \`punchy\` will not be given a long pause however much you ask for.

PACING IS ONE DECISION, AND IT IS \`cadence\`
\`cadence\` sets how fast a beat is spoken *and* how long the silence after it may run. Set it only where you actually have an opinion; left out, it is read off what the beat is doing, and that default is good.
- \`slow_deliberate\` — arithmetic the learner has to follow, a correction that has to land, a question they should attempt. Spoken at 140 wpm, and the only cadence allowed a long pause.
- \`building_energy\` — the body of an explanation. 150 wpm. This is the normal case.
- \`punchy\` — a hook, an aside, a one-line turn. 160 wpm, and at most 0.8s of silence after. Do not mark a beat \`punchy\` and then ask for two seconds of hold; you will get 0.8 and the beat will feel clipped.

WRITE THE WORD AS YOU SAY IT
\`terms\` is the vocabulary this beat introduces, copied VERBATIM from its own \`narration\`. The board writes each one in that beat's cell, cued to the word, so it appears under your voice as you reach it — and it stays there, because the board never wipes.

This is the whole idiom of a chalkboard explanation and it is not optional. A term the learner has only *heard* is a term they cannot spell, cannot look up and will not recognise next time. It matters most for an initialism: ATP is narrated as "ay tee pee", and nobody recovers "ATP" from that unless the letters are on the board. **A spoken initialism or name that no beat writes is rejected.**
- Copy it character for character, plural and all: "thylakoids", not "thylakoid". It is matched against your narration and dropped if it is not there.
- One or two per beat, three at the very most. A beat introducing five terms is a glossary; split it.
- Do not repeat a term a previous beat introduced, and do not name one your \`idea\` already says — the caption is on the board too, and the same word written twice reads as two things.
- Terms are for words, not for numbers or whole phrases: "RuBisCO", "the Calvin cycle", "latitude". Not "six molecules of carbon dioxide".

\`emphasis\` lists phrases from THIS beat's \`narration\`, copied verbatim, that carry its weight. They are spoken with more room — slowed slightly and given a beat afterwards, which is what a person does rather than getting louder — and drawn heavier wherever those same words appear on the board. One or two per beat at most: emphasis on everything is emphasis on nothing. A phrase that is not in the narration character for character is rejected, because both the voice and the board find it by searching the text.

VISUALS — WRITE A DRAWING INSTRUCTION, NOT A CAPTION
Every beat needs at least one entry in \`visuals\`, and \`describe\` must say what the learner SEES, as an instruction to someone holding a marker. "A bowl-shaped curve with a ball high on the left slope and a straight tangent line touching it, sloping up to the right" is a drawing instruction. "Gradient descent finds the minimum" is a caption and will produce nothing worth watching.

The compiler recognises these, and the words in **bold** are what select them, so use them literally:
- **plot** — anything with axes. Say which shape and which overlays: **bowl**/**parabola**/**loss curve**; **tangent** at a point; **steps** of descent; **two wells** or **local minimum** for a second, shallower valley; **three plots** comparing **too small**, **too large** and **about right**; **sigmoid**; **bell curve**; **exponential**; **logarithm**; **sine wave**; **threshold**; **straight line**; **overfitting** (training versus unseen data); **supply and demand**.
  Put the numbers in the describe text and the drawn picture will be built from them: "w = 3, slope = +4, learning rate 0.1" derives a curve whose slope at w really is +4, and the drawn steps come from running the algorithm on it. Give real numbers whenever the beat has any.
- **path** — freeform ink with no axes: a **hillside**, a **figure** standing on it, **fog**, three **steps** down it, a **bowl**, a container **blob**.
- **motion** — something that moves. Pair it with a plot in the same beat and the moving thing follows that curve.
- **diagram** — a flow or a list of peers. Write the nodes: "input → encoder → output".
- **icon** — one simple concrete object.
- **text** — an equation or a phrase that must be written out verbatim. Use sparingly; the picture should carry the idea.
Use one visual per beat, two at most. A beat with three competing pictures teaches nothing.

A STORY NEEDS A CAST, AND A CAST IS DECLARED ONCE
When \`kind\` is \`narrative\`, fill in \`cast\`: who is in this, one entry each, with a stable \`id\`, the \`name\` your narration uses, and \`look\` in a few words. Then draw them by setting \`character\` on the visual — \`{"id": "<a cast id>", "pose": "<a pose>"}\` — instead of describing them again. Describing the same person per beat gets you a different person per beat; naming them makes it the same drawing, and naming the pose is what makes them move.
- The poses available are: ${CAST_POSES.join(', ')}. Use one of those exact words or leave \`pose\` out. A pose that is not on that list falls back to a generic figure and the character is lost.
- Choose the pose from what the person is DOING in that beat, and only when it is clear. A beat about sitting with a problem for a week is not \`sitting\`.
- \`character\` settles what gets drawn, so \`kind\` is ignored on that visual. Still write \`describe\` — it says what is around them.
- Every \`character.id\` must be in \`cast\`, and a narrative lesson with no cast is rejected.

\`cue\` is a phrase copied VERBATIM from that same beat's narration — three or four words, the ones the drawing must land on. Copy it character for character or leave it out.

FIELD DISCIPLINE
- \`objective\` is checkable and specific: "explain why the update has a minus sign", not "understand gradient descent". It is the acceptance test for the whole video, and every beat must serve it.
- \`idea\` is one sentence, and it is also what gets written on the board next to the picture, so keep it short and concrete.
- \`topic\` is the title. \`version\` is 1.

Return only the tool call.`;
}

function documentContext(input: SourceDoc | string, opts: LessonOptions): string {
  const lines: string[] = [];
  if (typeof input === 'string') {
    lines.push(`TOPIC TO TEACH: ${input}`);
    lines.push(
      'There is no source document. Teach it from first principles, from what you know to be true.',
    );
  } else {
    const outline = input.sections
      .filter((s) => s.heading)
      .map((s) => `${'  '.repeat(Math.max(0, s.level - 1))}- ${s.heading}`)
      .join('\n');
    lines.push(`TOPIC TO TEACH: ${input.title}`);
    if (outline) lines.push(`SOURCE OUTLINE:\n${outline}`);
    const text =
      input.text.length > MAX_INPUT_CHARS
        ? `${input.text.slice(0, MAX_INPUT_CHARS)}\n…[truncated]`
        : input.text;
    lines.push(
      'SOURCE DOCUMENT — this is raw material, not a script. Take the facts and the numbers from it; take nothing of its structure or its sentences. Reorganise it completely around the learner.',
    );
    lines.push(text);
  }
  if (opts.objective) lines.push(`REQUIRED OBJECTIVE: ${opts.objective}`);
  if (opts.audience) lines.push(`AUDIENCE: ${opts.audience}`);
  if (opts.brief) lines.push(`EXTRA DIRECTION: ${opts.brief}`);
  return lines.filter(Boolean).join('\n\n');
}

/* ------------------------------------------------------------------ calling */

type Message = { role: 'user' | 'assistant'; content: string };

const DESCRIPTION =
  'Emit the finished lesson: what to teach, in what order, with what to draw for each beat.';

/**
 * Ask Claude for a lesson, then make it defend it.
 *
 * The critique pass is the quality mechanism, not a formality. A first draft
 * routinely opens with a preamble or leaves a beat with nothing to look at, and
 * both are cheap to fix and expensive to render. One revision, with the specific
 * problems quoted back, is where most of the quality comes from.
 */
export async function anthropicLesson(
  input: SourceDoc | string,
  opts: LessonOptions = {},
  maxSeconds = 110,
): Promise<Lesson | undefined> {
  const c = await anthropicClient();
  if (!c) return undefined;
  const schema = await lessonJsonSchema();
  if (!schema) return undefined;

  const model = lessonModel(opts);
  const system = teachingBrief(opts, maxSeconds);
  const messages: Message[] = [{ role: 'user', content: documentContext(input, opts) }];

  report(opts, { stage: 'lesson', pct: 15, note: `asking ${model} to teach it` });

  let best: { lesson: Lesson; problems: string[] } | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    let raw: unknown;
    try {
      raw = await callTool(c, model, system, messages, schema, {
        name: TOOL,
        description: DESCRIPTION,
      });
    } catch (err) {
      log.warn(`Anthropic request failed (attempt ${attempt + 1})`, err as Error);
      break;
    }

    let lesson: Lesson;
    try {
      lesson = LessonSchema.parse(normalise(raw, input, opts));
    } catch (err) {
      const detail = errorDetail(err);
      log.warn(`lesson failed validation (attempt ${attempt + 1})`, detail);
      if (attempt >= 2) break;
      messages.push(
        { role: 'assistant', content: JSON.stringify(raw).slice(0, 60_000) },
        {
          role: 'user',
          content: `That lesson failed schema validation:\n${detail}\n\nCall ${TOOL} again with the whole lesson corrected. Keep everything that was already good.`,
        },
      );
      continue;
    }

    const problems = critiqueLesson(lesson, { maxSeconds });
    if (!best || problems.length < best.problems.length) best = { lesson, problems };
    if (!problems.length) {
      log.info(`${model} wrote a lesson that passes critique`, {
        beats: 3 + lesson.steps.length,
        objective: lesson.objective,
      });
      return lesson;
    }

    if (attempt >= 1) break; // one revision pass, then take the best draft.
    report(opts, { stage: 'lesson', pct: 45, note: `revising: ${problems.length} problems` });
    log.info(
      `critique found ${problems.length} problems — asking for one revision`,
      problems.join(' | '),
    );
    messages.push(
      { role: 'assistant', content: JSON.stringify(raw).slice(0, 60_000) },
      { role: 'user', content: revisionRequest(problems) },
    );
  }

  if (best?.problems.length) {
    log.warn(
      `accepting a lesson that still has problems: ${best.problems.join(' | ')}`,
      'render it, watch it, then edit the lesson rather than the storyboard',
    );
  }
  return best?.lesson;
}

function revisionRequest(problems: string[]): string {
  return `Your lesson does not pass review yet. Every problem below is a specific failure of the brief, not a matter of taste:

${problems.map((p) => `- ${p}`).join('\n')}

How to read them:
- "asserts without justifying it" — the \`because\` does not derive the idea from something the learner already accepts. Rewrite it as a reason, not a restatement.
- "has nothing to look at" — the beat needs a \`visuals\` entry whose \`describe\` is a drawing instruction.
- "narration is too long for one beat" — split the beat, or cut a sentence. Do not shorten by truncating.
- "opens with a preamble" — replace the hook with a concrete question or surprise.
- "appears in the hook before being earned" — move that term later, and describe the thing instead of naming it.
- "exceeds the target" — cut a step, do not compress every beat into fragments.
- "is asserted, and a first-principles lesson has to derive every claim" — either derive it and set \`from\` to \`derived\` with the beats it follows from, or add the missing step before it that makes it derivable. Do not fix this by relabelling the beat \`given\`.
- "says it is derived but names nothing it derives from" — list the earlier beat ids in \`derivedFrom\`.
- "derives from … which comes later" — the order is wrong, not the reference. Move the beat it depends on before it.
- "derives from … which is not a beat in this lesson" — use the real ids: \`hook\`, \`anchor\`, \`step1\`…, \`worked\`, \`misconception\`, \`recap\`.
- "and no beat writes it" — that word is spoken and never drawn anywhere in the video. Add it to that beat's \`terms\`, spelled exactly as the narration says it, or write it into the beat's \`idea\`.
- "writes the term … which is not in its narration" — \`terms\` are quoted from the narration, character for character. Either copy it exactly or say the word in the narration.
- "does not name the one insight it exists to install" — write \`coreInsight\` as one sentence, and check every beat serves it.
- "names no correspondences" — fill in \`analogy.maps\`: each \`from\` a concrete part of the anchor, each \`to\` what it stands for.
- "says it teaches by analogy but does not record one" — either record the analogy, or change \`strategy\` to what you actually did.

Call ${TOOL} again with the complete corrected lesson. Keep every beat that was already good, word for word.`;
}

/** Apply a natural-language edit to a lesson with Claude. */
export async function anthropicLessonEdit(
  lesson: Lesson,
  instruction: string,
  opts: LessonOptions = {},
  maxSeconds = 110,
): Promise<Lesson | undefined> {
  const c = await anthropicClient();
  if (!c) return undefined;
  const schema = await lessonJsonSchema();
  if (!schema) return undefined;

  const model = lessonModel(opts);
  const system = `${teachingBrief(opts, maxSeconds)}

YOU ARE EDITING AN EXISTING LESSON.
- Apply the user's instruction and change nothing else. Beats the instruction does not touch come back word for word.
- The brief above still governs the result: an edit that introduces an unjustified claim, a preamble, or a beat with nothing to look at is not an acceptable edit.
- If the instruction would break the lesson (removing a step a later beat depends on, say), make the smallest coherent change that honours the intent, and keep the lesson teachable.`;

  const messages: Message[] = [
    {
      role: 'user',
      content: `INSTRUCTION: ${instruction}\n\nCURRENT LESSON:\n${JSON.stringify(lesson, null, 1)}`,
    },
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      raw = await callTool(c, model, system, messages, schema, {
        name: TOOL,
        description: DESCRIPTION,
      });
    } catch (err) {
      log.warn('Anthropic lesson edit failed', err as Error);
      return undefined;
    }
    try {
      return LessonSchema.parse(normalise(raw, lesson.topic, opts));
    } catch (err) {
      const detail = errorDetail(err);
      log.warn(`edited lesson failed validation (attempt ${attempt + 1})`, detail);
      if (attempt === 1) return undefined;
      messages.push(
        { role: 'assistant', content: JSON.stringify(raw).slice(0, 60_000) },
        {
          role: 'user',
          content: `That failed validation:\n${detail}\n\nCall ${TOOL} again with the corrected complete lesson.`,
        },
      );
    }
  }
  return undefined;
}

/* ------------------------------------------------------- response repair */

type Loose = Record<string, unknown>;

/**
 * Small, honest repairs before zod sees the response: fill in the fields the
 * caller already decided, and nothing else. Anything structurally wrong is left
 * alone so validation catches it and the retry can fix it properly.
 */
function normalise(raw: unknown, input: SourceDoc | string, opts: LessonOptions): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const lesson = { ...(raw as Loose) };
  lesson.version = 1;
  if (typeof lesson.topic !== 'string' || !lesson.topic.trim()) {
    lesson.topic = typeof input === 'string' ? input : input.title;
  }
  if (opts.audience && typeof lesson.audience !== 'string') lesson.audience = opts.audience;
  if (opts.objective && (typeof lesson.objective !== 'string' || !lesson.objective.trim())) {
    lesson.objective = opts.objective;
  }
  return lesson;
}
