# Golpo AI — UX/IA teardown

Researched 2026-07-28 via WebFetch on the live site plus WebSearch corroboration
(Product Hunt reviews, OutlierKit review, YC company page, aitoolnet listing,
their own `/guide/*` articles). One gap up front: **`/playground` is a fully
client-rendered, auth-gated Next.js app** — WebFetch only ever returned the
`_next` shell + a loading spinner, never the actual form DOM, even after
retries with different prompts. Everything below about the create flow's
literal field/button copy is triangulated from their own `/guide/golpo-ai-complete-tutorial`
and `/guide/golpo-ai-redefining-video-creation-through-artificial-intelligence`
articles (which describe the flow in prose) plus third-party write-ups, **not**
observed DOM. Flag anything you build strictly from this as "inferred" if a
teammate later gets a real account and can screenshot it — treat this doc as
the best available reconstruction, not ground truth pixels.

Known facts handed down, not re-derived here: Next.js behind nginx, Supabase
auth, S3 uploads, Tailwind indigo-600/700 primary on slate neutrals,
system-ui font stack, `font-medium` used pervasively. Pricing $39.99–$999.99/mo,
color gated at $199.99/mo (Growth), frame-by-frame editing gated at $499.99/mo
(Business).

---

## 1. Information architecture

Marketing site and the product app are cleanly separated — nav bar only links
marketing pages, the app lives entirely under one auth-gated route.

```
/                                          landing
/about                                     "About Us"
/pricing                                   pricing + FAQ + comparison guide
/solutions                                 "All Solutions" hub
/solutions/youtube-channel                 vertical landing page per use case
/solutions/{enterprise-learning|marketing|educators|
            hr-onboarding|sales-enablement|
            internal-comms|content-creators}
/gallery                                   "Video Gallery" — example outputs
/faq
/api-docs                                  API marketing/docs root
/api-docs/endpoints/v1                     REST reference
/api-docs/python-sdk/v_1_0_0                Python SDK reference
/guide                                     SEO blog/guide index
/guide/{slug}                              individual long-form guide articles
                                            (comparison posts like
                                            "doodly-alternative-ai-whiteboard-video",
                                            tutorials, "payload-examples")
/release-notes
/privacy-policy
/terms-of-service
/playground                                the actual create app (auth wall)
```

**Landing → finished video, the click path:** hero "Start Free" → Supabase
auth (signup/login) → `/playground` → create-video form → generation runs
server-side → result view inside the same SPA route (video stays keyed to a
project in their dashboard/library) → download / share from there. There is
**no public, unauthenticated preview of the actual editor** anywhere in the
IA — the `/gallery` shows finished output, not the tool. Every serious
description of the product experience lives in prose on `/guide/*` pages
instead of being demonstrable pre-signup. That is a real IA weakness (see §5).

Solutions pages are one-per-audience programmatic-SEO landers (same pitch,
swapped headline/persona) rather than functionally different products —
worth noting as a cheap content-marketing pattern, not a UX pattern.

## 2. Create flow (`/playground`), reconstructed

Step by step, as described across their own tutorial guide and third-party
summaries:

1. **Input.** Paste a text prompt, or upload a source document — PDF, DOCX,
   PPTX — or (per their API docs) a pre-recorded audio script. No URL-import
   confirmed.
2. **Options exposed on the same screen**, before generation:
   - **Aspect ratio** — landscape 16:9 (YouTube) and vertical 9:16
     (TikTok/Reels/Shorts). No 1:1 confirmed.
   - **Language** — 50+ languages, described as giving "natural, localized
     intonation"; higher tiers can generate "up to 10 language variants" of
     the same video in one pass.
   - **Voice** — not a plain voice-name picker so much as **"Voice
     Instructions"**: a free-text box where you describe tone, pacing,
     accent, and emphasis in plain English and the narrator follows it.
     Business tier adds actual voice cloning (bring-your-own-voice) on top.
   - **Style/palette** — two separate style systems by product line:
     - _Golpo Canvas_ image styles: `chalkboard_white`, `neon`, `whiteboard`,
       `modern_minimal`, `playful`, `technical`, `editorial`, `marker`.
     - _Golpo Sketch_ modes: `classic`, `improved (beta)`, `advanced`, plus a
       separate pacing control. Higher paid tiers unlock more sketch styles
       piecemeal: Growth adds "Dry Erase, Professional Clean, Crayon,
       Infographics, Creative"; Business adds "Formal" and "Pen in Hand".
     - **Color vs. black-and-white is its own gate**, independent of style
       choice — mono is the default/cheap-tier output regardless of which
       style you pick, color only unlocks at Growth ($199.99/mo).
   - **Length** — plan-gated in seconds/minutes, not freely chosen (see §5,
     this is one of the flagged weaknesses).
3. **Submit → generation.** Described in the guide as producing "synchronized
   videos with voiceovers in under 10 minutes," but a support question on
   Product Hunt ("processing may exceed 15 minutes... re-tweaking the
   prompt") shows the real p99 is worse than the marketing number and their
   own fallback advice is to _resubmit_, not to show useful partial progress.
   No evidence of a staged progress UI (e.g., "outlining → drawing →
   narrating → rendering"); it reads as a single opaque spinner/percentage.
4. **Result screen.** Lives inside the same authenticated SPA route as a
   "video" record in the user's library. Offers: inline playback, download
   (gated — see §5), and further editing depending on tier:
   - Growth+: "Edit script before creating video" (pre-render, text-only).
   - Business: "Edit video frame by frame using prompt" — a natural-language
     patch to an already-rendered video, their most expensive control point.
   - No confirmed one-click "share" URL generation (their public gallery
     entries look curated/hand-picked, not user-generated share links).
5. **Library/dashboard.** Confirmed unreliable: a Product Hunt user reported
   "How to get back to my video? I refreshed the page and the video
   disappeared" — i.e. no dependable persistence/recovery of generated work
   across a reload.

## 3. Component inventory (as built by them)

- **Nav bar** — logo left, flat text links (About Us, Solutions, Gallery,
  Pricing, FAQ, API, Guides), single primary CTA button, no mega-menu.
- **Hero** — headline + subheadline + two links (an inline "how to..." text
  link and the primary "start free" button); no embedded demo video/GIF in
  what's fetchable, which is a missed show-don't-tell opportunity.
- **Social proof** — essentially none on the landing page itself (no logo
  wall, no testimonial carousel, no stats bar). What little exists (one 5★
  Product Hunt review, a YC badge) lives off-site.
- **Feature grid** — not a distinct visual block on the landing page per se;
  feature claims are pushed into the long-form `/guide` articles instead of
  scannable cards on the homepage.
- **Pricing table** — 7 named subscription tiers (Free, Starter, Creator,
  Growth, Business "Most Popular", Scale, Enterprise) + a separate
  pay-as-you-go credit-pack table (3 volume breakpoints) + a separate
  API-only usage table ($1 = 1 credit, 2 credits/minute of video, $200
  minimum). Each tier additionally sells 1–5 named add-ons a la carte
  (extra credits, "Multilingual," "Script Validation," "Logo Upload,"
  "Video Instruction," "Storyboarding," "8 & 10 Min Videos," "API"). That's
  three parallel pricing systems plus a long add-on menu on one page.
- **Upload dropzone** — text prompt box + file upload (PDF/DOCX/PPTX);
  exact widget chrome not observable, but functionally a two-mode input
  (write vs. upload), not three (no separate URL-import field confirmed).
- **Progress indicator** — appears to be a single spinner/percentage, not a
  staged, named-step indicator; no evidence of granular status text.
- **Video player** — standard inline HTML5-style player inside the SPA;
  no confirmed scrubbing-to-scene or scene-thumbnail rail.
- **Library/grid** — a dashboard of past generations, but demonstrably
  fragile (loses state on refresh per the PH complaint above).
- **Share page** — no confirmed dedicated public share route distinct from
  the gallery; sharing appears to mean "download and post elsewhere."

## 4. Copy and tone

Verbatim quotes:

- Hero headline: **"#1 AI Explainer Video Maker & Document to Video
  Converter"**
- Subheadline: **"Transform documents and prompts into professional
  whiteboard explainer videos in minutes. The no-code AI video generator for
  training, marketing, and education."**
- `<title>`: **"Golpo AI – Whiteboard Video Generator | Convert Documents
  into Videos"**
- Tagline used elsewhere: **"AI-powered whiteboard video generator. Convert
  documents into engaging videos in minutes."**
- Primary CTA: **"Start Free"**
- Self-description in the guide article: **"an AI-powered video creation
  platform that converts written content — including documents, PDFs,
  presentations, and even text prompts — into whiteboard-style explainer
  videos,"** prioritizing **"clarity, precision, and educational usefulness
  over cinematic spectacle."**
- Claimed engine behavior: their **"text-to-visual engine"** identifies
  **"structural hierarchies — such as headers, bullet points, and
  formulas — and constructs logical visual sequences,"** and **"converts
  equations, variable names, and graphs into animations that unfold
  logically."**
- Output-quality claims: **"Perfect spelling and formatting"**, narration
  with **"natural, localized intonation"** across 50+ languages.
- Positioning line vs. competitors: **"whiteboard-first philosophy"**,
  translating ideas **"step by step"** rather than for "cinematic spectacle."
- Speed claim: **"transforms hours of manual editing into a 10-minute
  automated process."**
- Founder framing: **"Shraman and Shreyas Kar, Stanford AI researchers"** —
  academic-credibility positioning, not just "we're a startup."
- Footer: **"© 2026 Golpo AI - Red Tree Inc. All rights reserved."**

**Tone pattern:** confident superlative headline ("#1 …"), then immediately
practical/no-code framing, then education-and-training use cases foregrounded
over "content creator" ones. Feature copy leans on adjectives of fidelity and
correctness ("perfect," "logical," "consistent design," "natural") more than
on excitement or spectacle — they know their category comparison point is
accuracy, not flash. Verbs used for the pipeline: "convert," "transform,"
"generate," "translate" — never "draw," "animate," or "write," which is a
noticeably different vocabulary register from what a hand-crafted-feeling
tool would use, and a gap Inkcast's copy should fill.

## 5. Concrete UX weaknesses to beat

Given (do not re-derive, ship the fix):

1. **Whiteboard wipes constantly** — every scene appears to clear the board,
   so viewers lose spatial context scene to scene. This is exactly the
   failure mode `packages/core/src/storyboard.ts`'s persistent `canvas` +
   `persist: true` default was built to prevent.
2. **Drawn objects change appearance between scenes** — no entity reuse; the
   same character/diagram is regenerated (and drifts) every time it
   reappears. Inkcast's `assets[]` library keyed by stable `id` + locked
   `seed` is the direct structural fix — resolve once, reference by
   `assetId` forever after.
3. **Text renders as simultaneously-revealed outlines**, not written
   stroke-by-stroke — it reads as a shape fading/tracing in all at once
   rather than a hand actually writing. Inkcast's `Enter.style: 'write'` (vs.
   `'draw' | 'fade' | 'pop' | 'grow'`) needs to be a genuine per-glyph/stroke
   reveal in the renderer, not another outline-trace effect wearing the name.
4. **The download paywall is bypassable in devtools** — gating is evidently
   enforced client-side (a UI flag hides the button / a locally-computed
   check blocks the click) rather than the server refusing to serve the
   asset to an unentitled session. Any gate we ever build (even a "sign in to
   download" affordance) must be enforced by the endpoint that serves the
   file, never by hiding a button.
5. **Length limits contradict the marketing.** The brand promise is video
   creation "in minutes," but the cheapest paid tier (Starter, $39.99/mo)
   caps output at **30 seconds**, and Creator ($99.99/mo) is oddly capped
   _shorter_ at "15 sec videos available" per their own pricing copy — a
   tier you pay more for that produces less. Longer-form (4/10/15 min) is
   walled behind Growth/Business/Enterprise and beta-flagged even there.

Additional weaknesses found during this research:

6. **A maze of pricing surfaces.** Three parallel systems (7-tier
   subscription ladder, a separate pay-as-you-go credit table, a separate
   API-only usage meter) plus 1–5 named a-la-carte add-ons per tier (extra
   credits, Multilingual, Script Validation, Logo Upload, Video Instruction,
   Storyboarding, "8 & 10 Min Videos," API). A buyer cannot answer "what will
   my video cost" without cross-referencing several tables.
7. **Confusing unit economics.** "1 credit = 1 minute" except audio-only
   output is "10% credit requirement," and the API prices in raw dollars
   ("$1 = 1 credit") while also charging "2 credits · $2.00" for a 1-minute
   video — three unit systems ($, credits, minutes) doing the job of one.
8. **Core quality problems aren't solved even at the top tier.** "Character
   consistency" — the exact defect flagged in complaint #2 above — is still
   listed as **"(Beta)"** on the $999.99/mo Scale plan. Customers paying the
   most are still beta-testing the thing that should have been fixed
   structurally.
9. **No durable state.** A reported bug: refreshing the page makes an
   already-generated video disappear from view, with no recovery path
   described. There's no evidence the create app treats a generation as a
   durable, resumable project the way a project directory on disk would.
10. **Feature-gating maze, not a value ladder.** Color output, frame-by-frame
    editing, script editing, logo upload, and voice cloning are each locked
    behind different, non-adjacent tiers ($199.99 / $499.99 / Growth /
    Business respectively) — a user has to memorize which capability lives
    at which price point rather than a plan meaning something coherent
    ("more length" vs. "more control" vs. "more seats" are all tangled
    together).
11. **The product itself is invisible pre-signup.** `/playground` is
    entirely behind Supabase auth and client-rendered, so nothing about the
    actual editing experience is crawlable, screenshot-able, linkable, or
    demoable without creating an account first — even a page-fetch tool
    sees only a loading spinner. That kills organic/SEO discovery of the
    product itself (their `/guide` articles have to do all the explaining
    in prose instead) and kills virality (no one can share a working link
    into the tool).
12. **No public share/remix link.** There's no confirmed route where a
    finished video (or its source) can be shared as a clean public page;
    the implied path is "download and repost," which is friction compared
    to a one-click public share URL.
13. **Learning curve for the expensive controls.** Third-party review
    explicitly flags a "learning curve for advanced customizations" for the
    frame-by-frame prompt editor — the one feature gated to the
    second-most-expensive tier is also reported as hard to use once you get
    there.
14. **Generation time contradicts the "minutes" promise under load.** A
    support question shows real-world generation exceeding 15 minutes with
    "re-tweak the prompt" as the offered workaround — i.e. failure is
    handled by asking the user to gamble on a different prompt rather than
    showing real progress or letting them wait confidently.
15. **Vocabulary avoids the craft.** Their own copy never says "draw,"
    "sketch," "hand," or "write" about the actual visual process — it says
    "convert," "generate," "translate." For a whiteboard-style product this
    undersells the one thing that should be delightful.

## 6. Recommendations

**Keep, for familiarity** (these are reasonable IA/UX conventions users of
this product category already expect — deviating here would just be
friction, not delight):

- Single hero input that accepts _either_ a pasted prompt _or_ an uploaded
  document — don't force users to pick a mode before they've typed anything.
- Marketing site and the create app as separate route spaces, with the app
  behind one clear "Start" CTA.
- Aspect ratio presets exposed up front as a small, visual picker (16:9 /
  9:16 — we should add 1:1 too, since `StoryboardMeta.aspect` already
  supports it and Golpo doesn't).
- A plain-English "describe the voice/tone you want" affordance — this is a
  genuinely good pattern; keep the idea, not their gating of it.
- Long-form SEO guide content as a _separate_ content channel from the
  product UI — reasonable content-marketing structure worth mirroring later,
  just not at the expense of the product itself being demoable.
- Per-audience "solutions" landing pages as a cheap way to speak to
  different buyers — low priority, but a known-working pattern.

**Diverge — where we should feel dramatically better, and why our
architecture already lets us:**

1. **Never wipe the board.** Build the marketing hero around an actual
   looping demo clip that visibly shows the camera panning across one
   growing canvas instead of cutting between blank slides — Golpo has
   nothing to show here (§2/§3), so a 6-second autoplay proof beats a
   paragraph of their prose every time. This falls straight out of
   `Storyboard.canvas` + `Enter`/`persist` — it's not a UI trick, it's the
   IR.
2. **Write, don't outline-reveal.** Ship `Enter.style: 'write'` as a real
   per-stroke/per-glyph reveal in the renderer, and put a literal
   side-by-side comparison ("their text" vs. "our text") on the landing
   page — this is a concrete, demonstrable claim, unlike Golpo's abstract
   "perfect spelling and formatting" copy.
3. **One entity, one look, forever.** Market `assets[]`-with-`seed` reuse
   explicitly as "the rover stays the rover" — this is the fix to the
   competitor's own Scale-tier "(Beta)" character-consistency admission
   (§5.8), so we should say so by name in comparison copy once DESIGN.md
   exists to style it.
4. **Server-enforced entitlements, always.** If Inkcast ever adds any hosted
   gate (rate limit, optional cloud rendering), the check must live in the
   endpoint that serves the artifact, never a client-side flag — direct
   fix for §5.4/weakness #4.
5. **No feature-gating maze.** Because Inkcast's default path needs zero API
   keys, every capability Golpo paywalls piecemeal — color palette,
   frame-accurate editing, multi-language re-voicing, custom ink style — is
   available to every user on day one. Editing in particular should not be
   a premium "prompt the frame" gimmick: per `CONTRACT.md`, "a
   natural-language edit is just an LLM patching this JSON, and a re-render
   is a pure function of it" — build the result screen's "Edit" affordance
   around that truth and make it free and central, not an upsell.
6. **Durable projects, not disappearing videos.** Every generation is a
   project directory on disk (`packages/core/src/project.ts`) with a
   resumable, hash-checked cache; the web app should hydrate its library
   from that on every load so a refresh can never lose a finished video —
   direct fix for §5.9.
7. **Honest, simple pricing surface if/when we have one.** Never replicate
   three parallel pricing systems plus a per-tier add-on menu (§5.6/5.7).
   One dimension (compute/time), one unit, no hidden second meter.
8. **A staged, honest progress indicator.** Map `onProgress` stages
   (`ingest → plan → voice → visuals → render`, per `CONTRACT.md`) directly
   to named steps with real percentages and `note` text in the UI, instead
   of Golpo's opaque spinner that silently fails past ~15 minutes (§5.14).
9. **Public by default.** Because this is open source and local-first,
   generated results and even a demo of the create flow itself should be
   viewable without an account wherever privacy allows — a real public share
   route (video + title + "made with Inkcast" + a link to fork the
   storyboard JSON), directly countering §5.11/5.12's invisible,
   unshareable product.
10. **Say "draw," "sketch," "write."** Let the copy use the vocabulary of
    the craft (draw, sketch, ink, write, hand) instead of Golpo's
    convert/generate/translate register (§5.15) — it's free differentiation
    that also happens to be true, since we're actually animating strokes
    rather than fading in outlines.
