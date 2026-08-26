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
import { drawLesson } from './draw-anthropic.js';
import { resolvePreset } from './presets.js';
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

/**
 * The hybrid lane, offered to the lesson author only when an image provider is configured.
 *
 * Same rule as the `illustration` lane and for the same measured reason: an intent that
 * asks for something the run cannot provide gets a worse picture than one that never
 * asked. Without a key an `underlay` is ignored and the beat is drawn in marks alone.
 *
 * ## Why this reads the way it does, and the two attempts that failed first
 *
 * The first version (stage `lesson@9`) led with the trigger and then spent a paragraph on
 * everything the lane must not be used for, ending "if you are unsure, leave it out". It
 * was appended after the lane list, where a model has already chosen. On a full keyed
 * render of *the cardiac conduction system* — the lesson this lane was built for, with a
 * paid image key configured — the author wrote twelve `draw` intents and **not one
 * underlay**, and the film has the valentine in it exactly as before. A caution the model
 * obeys everywhere is not caution, it is an off switch.
 *
 * The second (`lesson@10`, then `@11` for `underlay.kind`) moved the block *into* the
 * `draw` bullet and led with the case rather than the exclusions. That was the right axis
 * and it still did not fire, and the reason is visible the moment you read the bullet in
 * order rather than reading the diff. The block was appended to the *end* of the bullet,
 * and the bullet's own opening promises "it can draw anything: a battery cut open, a
 * chloroplast…". So the brief made the claim and then took it back sixty words later: by
 * the time an author reaches "a composed drawing asked for a heart draws the valentine",
 * it has already been told the marks can do it, and the first answer is the one it keeps.
 * The advice was in the right bullet and behind the sentence that had already decided.
 *
 * So the split is now by *position inside the bullet*, not by presence in it. `LEAD` runs
 * before the promise and states the fork as the first decision — a real object starts from
 * a picture of it, every time — and it is also where the "draws anything" claim is made
 * honest, because a claim that needs a later correction is a claim that should have been
 * narrower. `KINDS` keeps the `figure`/`form` mechanics, which are legitimately a second
 * decision and only reached once the first has gone the picture's way.
 *
 * The lane still cannot be gated on a keyword table — that is the wrong axis, and this
 * file's own history says so — but a brief that asks a question the model can answer about
 * *the object* is not a keyword table.
 */
const UNDERLAY_LEAD = ` BEFORE YOU WRITE \`describe\`, DECIDE WHAT KIND OF THING THIS IS, because this is where that is decided and there is no later. Would a learner recognise this thing if they met the real one, and does its actual shape carry meaning? A heart, a kidney, a neuron, a bone, a leaf, a beetle, a violin, a jet engine, a lathe, a telescope, a cathedral — **yes, every time**, and every time means set \`underlay\` on that beat: \`{"kind": "figure" | "form", "prompt": "<the object, as a picture>"}\`. An image generator makes the object's form and the illustrator then composes its marks **while looking at that picture**, so the parts, the pathways and the names land on a real anatomical heart. This is the default for a real thing and not a flourish on top of one: a structural lesson about a real object carries an \`underlay\` on most of its beats, not on one of them. Marks alone cannot make the shape of something that has a true shape — asked for a heart the illustrator draws the valentine ❤️ from a text message, and no amount of detail in \`describe\` repairs that, because the failure is in what marks are, not in what you wrote. The other half is just as unable: an image model cannot spell, cannot name a part and cannot label a pathway, which is why neither half is offered alone.`;

const UNDERLAY_KINDS = `
  CHOOSE \`underlay.kind\`, because there are two ways to use a generated picture and they want opposite prompts.
  - \`"figure"\` — the picture IS the teaching diagram, in colour, and your marks only name a part or two around the outside. Write \`underlay.prompt\` as the whole figure: the view, the internal structures, the pathway, the state — "cutaway cross-section of a human heart showing all four chambers, the septum and the valves, the atrioventricular node a small nodule at the junction, orange arrows fanning down through both ventricle walls, chambers red and blue". Choose this when the beat needs to see INSIDE something, or when what teaches is the whole picture rather than a label on it: a cutaway, a cross-section, a system in colour, a stage of a process shown in situ. \`describe\` should then ask for very little — a name and a leader, no more — because everything else is already in the picture. A lesson about a real object should carry a \`figure\` on every beat where the learner has to see inside the thing — for a cutaway, a cross-section or a pathway through a structure, that is most of them.
  - \`"form"\` — the picture is the object's SHAPE and your marks carry the mechanism on top of it. Write \`underlay.prompt\` as the OBJECT and nothing else: "a human heart, anatomical, external front view, whole organ with great vessels". One centred subject, the view you want, no scene, no labels, no arrows — what an illustrator would draw before anyone wrote on it. \`describe\` then says what goes ON it, written as if the form is already there: "mark the SA node high in the right atrium, run the pathway down the septum". Choose this when the beat is about parts, pathways or relations that have to be placed exactly and named.
  **\`figure\` is the normal choice for anything you would have to cut open to teach, and \`form\` is the exception for beats whose whole job is placing and naming parts on an outline.** If you are unsure, choose \`figure\`: a picture that already shows the mechanism teaches even when the labels are sparse, and an outline with labels on it does not teach when the mechanism is inside.
  The answer is no to both for anything with no true form to draw: an abstraction, a process, a comparison, a timeline, a graph, a flow, a hierarchy, a schematic, "the concept of X". Leave \`underlay\` out there and let the composed drawing have the board to itself.
`;

/**
 * The brief, written to the format the film is actually being cut to.
 *
 * `seconds` was the only thing the brief knew about the format, and one number was not
 * enough. The measured failure is the whole of Phase 3: on the same lesson the film ran
 * 174s against a competitor's 59.5s, and the cause was not pace — 142–151 wpm, inside
 * the teaching band — but volume. **348 words where about 145 was needed.** A budget of
 * 330 words stated as one sentence in the middle of a long brief was read as a limit
 * nobody was near rather than as the shape of the film, and the model spread it over
 * fourteen beats because nothing said how many beats there were.
 *
 * So the brief now takes the preset, and states three numbers instead of one: the total
 * in words, the beat count, and what happens to the overflow. `resolvePreset` rather
 * than a passed-in `Preset` because that is what the caller has — `LessonOptions`
 * carries `preset`/`aspect`/`maxSeconds`, and the pipeline only fills `preset` when the
 * run asked for one by name, so resolving here gets the same shape `cast.ts` resolved
 * and not a second guess at it. `seconds` still wins for the word budget: it is the
 * target after `depth` and `--seconds` have had their say, which the preset's own
 * `maxSeconds` has not seen.
 */
function teachingBrief(opts: LessonOptions, seconds: number): string {
  const audience = opts.audience ?? 'a curious beginner with no background in the subject';
  const shape = resolvePreset(opts);
  // The budget, in the only unit a language model can count: words — and at the rate
  // *this run* will actually be spoken at. `shape.wordsPerSecond` is the preset's own
  // field, which `resolvePreset` has already set from the voice provider
  // (`DELIVERED_LPS_BY_PROVIDER`) and which an explicit `--wps` overrides. Importing
  // the constant instead was how a keyed film came to be briefed at the local
  // engine's rate and then delivered 13% faster than the budget it was written to.
  const words = Math.round(seconds * shape.wordsPerSecond);
  const beats = shape.maxBeats;
  /** Spread evenly. Stated because "165 words" alone does not say how thin that is. */
  const perBeat = Math.floor(words / beats);
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

NAME EVERY CARD
\`title\` is what the beat's card is *called* — at most six words, and a **name rather than a sentence**. "Free fall". "Air resistance". "The tug of war". It is written at the top of the board in the largest hand in the film and it is the first thing a viewer reads, so it has to be a handle they can carry, not a claim they have to parse.

The difference from \`idea\`, which is the thing most often got wrong: \`idea\` is a *claim* ("Falling is a tug of war between bigger pull and bigger inertia"), and a title is the *subject* of that claim ("A tug of war"). Do not write the first six words of the idea. Do not write a full sentence and trust it to be cut — a sentence cut to six words promises nouns the board never writes, which is where "Falling is a tug of war between bigger pull" came from on a real film.

No trailing punctuation, no "Step 3:", no restating the topic on every card.

NARRATION
- Spoken English at about 150 words per minute. Contractions. Short clauses. Whole sentences only — never a fragment, never a sentence continued into the next beat.
- Talk to one person. No "let's", no "we will explore", no "as we can see", no citations, no bullet-point voice.
- \`hold\` is silence *after* the beat, in seconds. Use 0.3–0.5 to let an idea land, and 1.2–2 after a question you want the learner to attempt. Silence is part of the explanation. Note that \`cadence\` below sets a floor and a ceiling on it, so a beat marked \`punchy\` will not be given a long pause however much you ask for.${
    shape.maxHold === undefined
      ? ''
      : ` This format caps every pause at ${shape.maxHold}s on top of that, so a longer number is not refused, it is simply reduced — a measured film at this length spent 15.4% of its runtime in silence, and that is time the explanation needed. Ask for a pause where the learner has something to do in it, and nowhere else.`
  }

WRITE IT AS PLAIN AS IT WILL GO. THIS IS THE DIFFERENCE BETWEEN A VIDEO THAT TEACHES AND ONE THAT IS ENDURED.
This is heard once, aloud, with no way to rewind and nothing on the page to re-read. A listener who has to hold a clause in their head to find out how it ends has stopped thinking about the subject and started decoding the sentence — and the harder the concept, the less of them is left over for that. So the rule runs the other way round from how it feels: **the more difficult the idea, the simpler the language carrying it must be.** Elaborate phrasing on a hard idea is not rigour, it is two problems handed over at once.
- **Everyday words.** If a nine-year-old would not have the word, either use a simpler one or spend a sentence earning it. "Pushes back" over "exerts a counterforce". "Gets weaker with distance" over "attenuates". You are not simplifying the idea — the idea stays exactly as hard as it is — you are refusing to make it harder.
- **One clause carries one thing.** Say it, then say the next thing. Sentences that fork mid-way ("which, because the field is stronger there, means…") are where a listener drops the thread. Two plain sentences always beat one careful one.
- **Front the subject.** "The gap blocks electrons" is heard; "what the gap does to electrons is block them" is parsed. Active voice, real actor first, ordinary verb.
- **Short sentences, and vary them.** Aim under fifteen words, most nearer eight. A very short sentence after two longer ones is how a spoken explanation lands a point — the narrator reads punctuation as timing, so this is also how you control the pace.
- **Say the number, not the notation.** "Three minus zero point one times four" — write it the way it is spoken, because it will be spoken exactly the way it is written.
- **No throat-clearing.** Not "it is important to note that", not "essentially", not "in other words" — if the first phrasing needed a second one, delete the first. Every wasted word is spent from a budget that costs you a beat when it runs out.

Read each beat back as if saying it out loud to one person who is interested and has never met the subject. If you would not say it that way to them, it is not narration yet.

THE BUDGET, AND IT IS THE HARDEST CONSTRAINT IN THIS BRIEF
**${words} words for the whole lesson, across AT MOST ${beats} BEATS.** Both numbers are real: ${words} words is ${Math.round(seconds)} seconds at the pace this narrator actually delivers, gaps and all, and ${beats} beats is what this format lays out. Spread evenly that is about ${perBeat} words a beat — roughly ${Math.max(2, Math.round(perBeat / 9))} short spoken sentences. Count them as you write; do not estimate.
- **A beat that says more than its share is cut, and it is cut at a sentence boundary.** Nothing gentler happens and there is no negotiation: whole sentences are kept from the start of the beat and the rest is thrown away, so the last thing you wrote in a long beat is the thing nobody hears. If the reason lives in your closing sentence, the reason is what you lose. Write the beat short and the cut never comes.
- **A lesson with more than ${beats} beats does not get compressed, it gets a beat DELETED** — and only a beat nothing else derives from may go, so overrunning costs you your own last step. Plan the beat count before you write the first one.
- This budget is not a target to fill. A ${Math.round(seconds)}-second explanation that lands beats a two-minute one that wanders, and the shorter one is *harder to write*: it is the same argument with every sentence that was not carrying anything taken out. Cut the throat-clearing, not the reasoning.

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

The compiler recognises these, and the words in **bold** are what select them, so use them literally. **\`draw\` is the normal choice** — read it first and reach for another kind only when that kind is plainly better:
- **draw** — a composed drawing, made of boxes, ellipses, freehand strokes, arrows, hatching, scattered dots and written labels, placed one by one by an illustrator who reads your \`describe\` and nothing else.${opts.illustrations ? UNDERLAY_LEAD : ''} It can compose anything you can build out of marks: a battery cut open, a chloroplast, a wire looping through a bulb, a ship heading for the rocks, two things side by side with an arrow between them. It is free, it is drawn in the same hand as the rest of the board, and it can spell — so it labels its own parts. Write \`describe\` as the picture you want, in the detail you would use telling a person what to put on a whiteboard: what the parts are, where they sit relative to each other, what crosses what, what is inside what. Say the RELATION, because the relation is what teaches: "two flat stacks facing each other across a narrow gap, a plus charge crossing the gap freely, an electron turned back at it and going the long way round through a wire and a bulb" is a drawing instruction. "A battery" is not.
${opts.illustrations ? UNDERLAY_KINDS : ''}- **plot** — anything with axes. Say which shape and which overlays: **bowl**/**parabola**/**loss curve**; **tangent** at a point; **steps** of descent; **two wells** or **local minimum** for a second, shallower valley; **three plots** comparing **too small**, **too large** and **about right**; **sigmoid**; **bell curve**; **exponential**; **logarithm**; **sine wave**; **threshold**; **straight line**; **overfitting** (training versus unseen data); **supply and demand**.
  Those named shapes are the ones it knows how to build; a plot that names none of them, and no quantity varying against anything, is not drawn as axes at all — it is handed to whichever lane can draw what you described. Put the numbers in the describe text and the drawn picture will be built from them: "w = 3, slope = +4, learning rate 0.1" derives a curve whose slope at w really is +4, and the drawn steps come from running the algorithm on it. Give real numbers whenever the beat has any.
- **path** — freeform ink with no axes, and it can draw EXACTLY SIX THINGS: a **hillside**, a **bowl** (a valley, a basin), a container **blob**, a stick **figure**, **fog**, and **steps** down a slope. That list is not an example, it is the whole implementation. There is no seventh shape: this lane cannot draw a battery, a ship, a cell, a wire, a stack of layers or a cross-section of anything, and asking it for one gets you the drawing of that thing from another lane at best. Use \`path\` when the picture in your head really is terrain, a container, a person, fog or a walk downhill. Otherwise do not.
- **motion** — something that moves. Pair it with a plot in the same beat and the moving thing follows that curve.
- **diagram** — a flow or a list of peers. Write the nodes: "input → encoder → output".
- **code** — a source listing, set in monospace and syntax-highlighted, revealing line by line as you speak. Put the lines themselves in \`code\` and the language id in \`lang\` (\`python\`, \`typescript\`, \`sql\`, …); \`describe\` then says what the learner should notice about it ("the two lines that walk the bucket"). This lane sets what you write, character for character — it does not write code from a description, so a **code** visual with an empty \`code\` field draws something else instead. Keep it short: **at most eight lines and sixty columns**, because the board fits a listing by shrinking it and a twenty-line function ends up too small to read. Cut to the lines that carry the point, and use \`…\` for what you cut.
- **icon** — one simple concrete object that a symbol set would already have: a clock, a leaf, a battery, an arrow. Drawn from a curated library or matched against a standard icon set, so it is instant and free — and generic. Do not reach for it to draw something specific.
${
  opts.illustrations
    ? '- **illustration** — a text-to-image model, for the few subjects a composed drawing is genuinely worse at: a living thing, a person, a real place, anything whose *likeness* is the point ("a barn owl in flight", "the Parthenon"). An image generator IS configured for this run. It is the narrow lane, not the wide one, and it has hard limits worth knowing before you choose it: it **cannot spell** — asking for a word inside the picture ("labelled X", "marked plus") returns scribble — it **cannot draw a relation** — "a plus crossing the gap while an electron is turned back" came back as two empty rectangles — and it **cannot draw a change**, so "the same thing before and after" comes back as one muddled frame. If the beat is about structure, parts, or how things relate, use **draw** instead: it can do all three. Describe one centred subject, no scene, no background.'
    : '- (there is no image generator configured for this run. That costs you almost nothing: **draw** needs no image model, and it is the better lane for anything structural anyway. Reach for it wherever you would have asked for a picture.)'
}
- **text** — a short phrase that must be written out verbatim, in plain words. Use sparingly; the picture should carry the idea. NEVER an equation: text is handwriting, and handwriting cannot typeset a fraction, a Greek letter, a subscript or |0⟩. Notation belongs in a **draw** visual — put the equation in \`describe\` and the illustrator sets it as real typeset mathematics on the board.
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

/**
 * `sourceRef`, told to the author only when there is a document to point at.
 *
 * The audit's S0-b finding in one sentence: the ingested document is on disk and after
 * this stage nothing can trace a single claim back into it, because the lesson has no
 * field that names where a fact came from. `from`/`derivedFrom` answer "which earlier
 * beat", never "which paragraph".
 *
 * The heading is the whole contract. It is the one identifier the author can already see
 * (in `SOURCE OUTLINE`, immediately above this), it needs no minting at ingest, and it is
 * checked — `critiqueLesson` matches it against the document's real headings and reports a
 * ref that names none. So the failure mode of an author that copies carelessly is a
 * critique problem it is asked to fix, not a plausible-looking citation nobody can test.
 */
const SOURCE_REF_RULE = `SAY WHERE EACH FACT CAME FROM
Set \`sourceRef\` on every beat whose claim you took from this document: the heading of the section it came from, copied VERBATIM from the SOURCE OUTLINE above. It is checked against the document's real headings, so a heading you paraphrased or invented is reported as a problem — copy it character for character or leave the field out.
- Leave it out on a beat that is yours rather than the document's: an everyday anchor you supplied, a hook you wrote, the recap. Do not reach for the nearest heading to fill the field; an unsourced beat is honest and a wrong citation is not.
- One heading, not a list. If a beat draws on two sections, name the one its central claim comes from — and consider whether it is really two beats.
- This is not for the viewer and it is never spoken. It is how a later check can hold a claim up against the sentence it came from.`;

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
    // Plan 5.2 / audit S0-b. Said here rather than in the teaching brief on purpose: the
    // brief is one system prompt shared with every bare-topic run, and a field an author
    // *cannot* fill is a field it will fill wrongly. This block only exists when a
    // document does, and it sits directly under the outline whose headings are the only
    // legal values — so the thing being copied is on screen beside the instruction to
    // copy it.
    if (outline) lines.push(SOURCE_REF_RULE);
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

    // The document's headings, so a `sourceRef` is checked in the same loop that would
    // ask for a revision (plan 5.2). Nothing to check on a bare topic — and nothing was
    // asked for there either, since `SOURCE_REF_RULE` only appears with an outline.
    const problems = critiqueLesson(lesson, {
      maxSeconds,
      ...(typeof input === 'string' ? {} : { sections: input.sections.map((s) => s.heading) }),
    });
    if (!best || problems.length < best.problems.length) best = { lesson, problems };
    if (!problems.length) {
      log.info(`${model} wrote a lesson that passes critique`, {
        beats: 3 + lesson.steps.length,
        objective: lesson.objective,
      });
      await drawLesson(lesson, opts);
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
  // A lesson that never passed critique still gets its pictures: the beats are what they
  // are by this point, and a flawed argument drawn well is a better video than a flawed
  // argument drawn as a hillside.
  if (best?.lesson) await drawLesson(best.lesson, opts);
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
- "is captioned … the same as" — two cells would write one string, and the recap would draw that step twice. Each \`idea\` is that beat's own single new idea; if two beats really have the same one, they are one beat.
- "does not name the one insight it exists to install" — write \`coreInsight\` as one sentence, and check every beat serves it.
- "names no correspondences" — fill in \`analogy.maps\`: each \`from\` a concrete part of the anchor, each \`to\` what it stands for.
- "says it teaches by analogy but does not record one" — either record the analogy, or change \`strategy\` to what you actually did.
- "cites source section … which is not a heading in the document" — \`sourceRef\` is a heading from the SOURCE OUTLINE, copied character for character. Fix the spelling or drop the field; do not substitute a heading that is merely close.
- "names no misconception" — add the \`misconception\` beat: the one sentence a learner would confidently say afterwards that is false, and the picture that refutes it. A caveat about limitations is not this.
- "plots axes before this lesson has drawn anything concrete" — move the graph later, or give an earlier beat a \`draw\` or \`path\` visual of the real situation the graph is *of*. Notation and axes come after the picture, never before it.

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
