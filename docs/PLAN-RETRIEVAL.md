# Decision doc — retrieval for bare topics

Written 2026-08-24 as the second half of `docs/PLAN-AUDIT-CLOSE.md` item 5.1. The first
half shipped in the same session: a run now records `grounding: 'document' | 'parametric' |
'supplied'` in `pipeline.json`, the CLI prints it, and the studio says it out loud on a
parametric film. This document is the decision the plan deliberately refused to let that
honesty wait for.

**Status: proposed, not approved. No code.** The plan's done-bar for 5.1 is "(a) ships; (b)
has a decision doc and, if approved, an adapter with the standard no-key degradation." What
follows is (b) up to the word "approved".

---

## What the gap actually is

`ingest()` accepts `{text, filePath, url}` — one document or nothing. For a bare topic the
lesson author is told, verbatim:

> There is no source document. Teach it from first principles, from what you know to be
> true.

Everything the film then asserts is the model's recollection. That is not a defect in the
common case: "gradient descent", "how day and night happen", "why the sky is blue" are all
things a strong model knows better than a hastily retrieved page would. The audit says so
itself — MISSING, and "deliberate and internally honest".

The gap is narrower than "no retrieval", and worth stating precisely, because it decides
what a retrieval lane would have to be good at:

1. **Post-cutoff facts.** A topic whose truth changed after the model's training data ends
   is unsupported _and undetectable_. Nothing in the pipeline can tell "the current record
   is 9.58 seconds" from "the current record was 9.58 seconds when I last looked".
2. **Niche specificity.** A lesson about one company's API, one town's geography, one
   paper's result. The model will produce something fluent and possibly wrong, and the
   pedagogy critique — which polices structure, not facts — will pass it.
3. **Numbers.** `worked` is required to carry real arithmetic. A recalled constant is the
   single highest-risk claim in any film, because it is the one a viewer will repeat.

Retrieval is worth having for (1) and (3) and is marginal for the topics people actually
type. That asymmetry is the whole reason this is a decision doc rather than a task.

## The three decisions

### 1. Which retrieval

| Option                                                          | What it costs                                                                               | What it buys                                                           | Verdict          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------- |
| **Anthropic web search tool** (server-side, on the lesson call) | one flag on a call this pipeline already makes; no new provider, no new key, no new adapter | the model retrieves what it decides it needs, mid-reasoning, and cites | **proposed**     |
| A search API (Brave / Exa / Tavily) + fetch + `buildDoc`        | a new key, a new adapter, a no-key path, rate limits, a fetch-and-strip lane we would own   | full control of what gets stored; works with a non-Anthropic planner   | rejected for now |
| A crawl-and-embed store                                         | weeks, and a second system to keep true                                                     | nothing this product needs                                             | rejected         |

The middle option is the one the plan's phrasing implies ("a `SEARCH_API_KEY` lane that
populates `SourceDoc`"), and it is the wrong shape for this codebase. It puts a retrieval
_policy_ in the planner — how many results, which to fetch, how to rank, when to stop —
which is exactly the kind of judgement this repo has repeatedly been better off delegating
to the model than encoding in a heuristic (`matchIcons`, the six freeform shapes, the
analogy regex; see `Mark`'s own docstring on enumeration). It also adds a second key to a
product whose degradation story is already four lanes long.

The server-side search tool inverts that: the lesson call gains a tool, the model chooses
its own queries while it is deciding what to teach, and what comes back is already scoped
to the claim it was reaching for. Cost is per search, on top of a call we make once per
film.

**Consequence to accept:** this makes grounded bare topics an Anthropic-only capability. A
future non-Anthropic planner would be `parametric` and would say so. That is consistent
with how every other keyed lane here behaves.

### 2. What gets stored

A retrieved lesson must be **indistinguishable downstream from a document-route one**, or
5.2 has to be built twice. So:

- Write a real `source.json` — a `SourceDoc` whose `sections` are one per retrieved
  source, `heading` being the source's title, `text` the excerpt the model actually used,
  and `origin: { kind: 'search', ref: <url> }`.
- `grounding` becomes `'retrieved'` — a fourth value, not `'document'`. Whoever reads the
  record must be able to tell "the user handed us a document" from "we went and found
  some", because the trust in those two is not the same. `Grounding` in
  `packages/pipeline/src/state.ts` is where the fourth value goes, and the studio's note
  needs a fourth sentence.
- `sourceRef` (5.2) then works unchanged: a beat names the heading of the source it came
  from, `critiqueLesson` checks it against the section list, and a claim can be traced to a
  URL with no new mechanism. **This is the payoff, and it is why 5.2 landing first was the
  right order.**
- Cache on the retrieved bundle, not on the topic string. `cacheKey('lesson', …)` already
  folds in the lesson input; a retrieved `SourceDoc` must be part of it or the second cast
  of the same topic silently reuses last week's facts — which is the failure retrieval was
  added to prevent, wearing a cache entry as a disguise.

### 3. What it costs, and who turns it on

Off by default. `INKCAST_RETRIEVE=1` (or `--retrieve`) turns it on for bare topics only —
never when a document was supplied, because a user who handed over a document has said what
the source is. Metered through `costOf` as a `CostLine` like every other billable call
(plan 3.5's rule: every model call is a cost line, and a search is one).

No key, or the flag unset: today's behaviour exactly, `grounding: 'parametric'`, said out
loud. Standard degradation posture, no new shape.

## Why not now

Three reasons, in order of weight:

1. **The honesty is the load-bearing half and it has shipped.** A parametric film that says
   it is parametric is not a defect; a parametric film that looks sourced is. The audit's
   own remediation offers this as the minimum ("or at minimum flag bare-topic lessons as
   ungrounded in the project record"), and that is done.
2. **Nothing measures whether retrieval would improve a film.** Every number this repo
   trusts was measured — `MIN_INK_SHARE`, `MIN_GLYPH_PX`, the fill floor, `DELIVERED_WPS`.
   There is no instrument for factual accuracy, so "retrieval makes the videos better" is
   currently a belief. **Tier 3** — verifying claims against a source — is the instrument,
   and it cannot exist before a source does, which makes the sequence retrieval → Tier 3 →
   evidence, with the evidence arriving last. Building the lane first and the measurement
   never is how a feature becomes permanent without ever being justified.
3. **Phase 6 has the stronger claim on the same week.** 6.1 (the honest guard for
   chemistry, circuits, maps, code) converts _confidently wrong pictures_ into _honestly
   limited ones_, on topics the pipeline demonstrably cannot draw. That is a larger class
   of visible defect than recalled-vs-retrieved prose.

## The bar for approving it

Not a date — a signal, so this does not get built because it was written down:

- A real lesson whose facts are wrong in a way retrieval would have caught. One is enough,
  and the `grounding: 'parametric'` field is now what makes it findable: every film on disk
  says which kind it is.
- Or a user asking for a topic the model provably cannot know (post-cutoff, or private).

When one arrives: implement §2 exactly as written above, add `'retrieved'` to `Grounding`,
and open Tier 3 as the follow-on item. Until then, `parametric` and honest.

## Coverage

This closes the `(b)` half of plan item 5.1 as a **written decision**, per the plan's own
done-bar. `S0-a` in `docs/AUDIT-FINDINGS.md` is closed by the `(a)` half plus this
document: the finding is recorded, the honesty ships, and the retrieval lane is deferred
with the reasoning and the trigger written down where the next auditor will find them.
