# Golpo AI — what their videos actually look like

> ## ⚠ The central claim of this document is FALSE. See `docs/HANDOFF-PARITY.md`.
>
> "What they do not draw at all: technical, structural, labelled diagrams" and "the space we
> have been trying to occupy is genuinely unoccupied" are both wrong. Given a STEM anatomy
> prompt, their system produces a labelled cutaway cross-section of the heart — chambers in
> red and blue, the signal as an orange lightning bolt, `AV NODE` on a leader, `PAUSE` on a
> wavy line across the junction — and it is better than ours. This document was written from
> two videos in their public gallery that happened to be text-and-metaphor, and it
> generalised from a sample of two.
>
> **The drawing lane's whole strategy was justified by that claim.** Everything below about
> titles, wiping, colour and density is still accurate and still worth acting on; the
> conclusion about what they cannot do is not.

Researched 2026-08-06. **This is a different document from `golpo-ux.md`**, which is a
product/IA/pricing teardown and says almost nothing about the videos. This one is about the
craft: what is on the screen, how a scene is built, and what they can and cannot draw.

## How this was obtained, so it can be redone

The gallery is a client-rendered Next.js app and WebFetch only ever sees the shell. The
data is one unauthenticated JSON endpoint:

    https://video.golpoai.com/api/videos/gallery?offset=<n>&limit=20

**120 videos, each with its full `request_payload`** — every generation setting they expose
— and a public S3 `video_url`. No auth, no account. Two were downloaded and read frame by
frame with `ffmpeg`:

    ffmpeg -i x.mp4 -vf "fps=1/30,scale=640:-1,tile=3x3" -frames:v 1 out.png

A contact sheet is the right tool here: nine frames of a five-minute film in one image
shows the _structure_ of the thing, which is what we were getting wrong.

Read: `sleep.mp4` (5:00, "Biological Maintenance", `image_style: custom`) and `apchem.mp4`
(5:17, AP Chem 8.3 weak acids, `image_style: neon`). Both 1536x864.

## Their generation settings, verbatim from the payloads

    image_style   marker | neon | editorial | custom | chalkboard | whiteboard | ...
    pen_style     none | stylus            pacing      normal | fast | faster
    use_color     true/false               video_type  long | short
    bg_music      none | ...               characters  (nullable)
    logo_url, language, video_voice ("custom_voice" = cloning), audio_only,
    skip_animation[], use_as_is[], direct_script, edited_script, script_mode

Worth noting we have no equivalent of `bg_music`, `pen_style`, or `pacing` as a user-facing
control, and their `image_style` list is much longer than our four `style` values.

## What a scene is, and this is the whole finding

**Every scene is a titled card, and the title is written first.**

    1. the title is handwritten letter by letter across the top
    2. it gets a hand-drawn double-underline flourish
    3. THEN the content is drawn beneath it
    4. the board WIPES, and the next scene starts again at step 1

Observed titles from one film: _Biological Maintenance_ · _2 Sleep Systems_ · _Deep Sleep_
· _Physical Impact_ · _Sleep By Age_ · _5 Ingredients for Perfect Sleep_ · _10-3-2-1-0
Rule_. From the other: _Weak Acid & Base Problems_ · _Strong Acids: 100% Dissociated_ ·
_Weak = Small Extent of Ionization_ · _The ICE Table Setup_.

That single pattern is most of what the user meant by "there is no buildup". You always
know what you are looking at, every scene announces itself, and the first four seconds of
the film are a title being written rather than a diagram appearing. **We have no titles at
all** — a beat's `idea` is a small caption, and the film opens straight into ink.

It is also the answer to why their boards look composed and ours looks sparse. A card holds
**two to four big things**, centred, with room around them. We accumulate onto one canvas
forever and measure 23% frame fill with elements too small to read when the camera pulls
back. `golpo-ux.md` §5.1 records "whiteboard wipes constantly" as a _weakness to beat_.
Having now watched it: **that judgement was wrong, or at least far too confident.** Wiping
is what buys them legibility. Persistence is a real idea, but it is not free, and we have
been paying its cost without ever measuring what it bought.

## What they draw well

1. **Handwriting.** Multicolour, one hue per phrase or per element, genuinely beautiful.
   It is the single most-present thing on screen in both films.
2. **Real mathematical and chemical notation.** Subscripts, superscripts, fractions with
   proper rules, square roots with vincula, the equilibrium arrow ⇌, `pH = -log(5.37...)`,
   `x = √(K_b × 0.250) = 1.06×10⁻…`, `% Ionization = (x/[...]) × 100`. Set as handwriting,
   not as typeset TeX pasted in.
3. **Rich illustrated metaphor vignettes.** A brain filing memories into a chest of
   drawers. An alarm clock with gears bursting out of it. A brain under a shower head. A
   tired face with wild hair. A baby in a crib. A heart with an ECG trace falling off a
   cliff. A seesaw weighing junk food. These are _drawings_, with interior detail, not
   compositions of rectangles and ellipses.
4. **Colour, liberally.** Every element gets its own hue. There is no "one ink carries the
   structure" discipline at all, and it does not read as a rainbow mess — because each
   element is spatially separate and the colour is per-object, not per-stroke.

## What they do not draw at all

**Technical, structural, labelled diagrams.** This is the important half.

The AP Chem film is, across five minutes, _almost entirely handwritten text and equations_.
There is one small decorative gear→box→brain motif under the opening title and essentially
nothing else pictorial. The sleep film is metaphor vignettes and lists. Neither film
contains a labelled cross-section, a mechanism, a pathway, a part-named structure, or
anything a learner would trace with a finger to follow how a thing works.

So the space we have been trying to occupy — _draw the mechanism, name its parts, and land
each part on the word that names it_ — **is genuinely unoccupied.** They have not solved it;
they have declined it.

> **This paragraph is the false one.** They have not declined it. Two gallery films are not
> a sample. See `HANDOFF-PARITY.md` — on a cardiac prompt they draw the mechanism, name its
> parts with leaders, and do it in colour at twice our legibility. What is still ours alone
> is that our parts are _addressable_: cued to the word that names them, highlightable
> later, movable. Their figure is a picture. Their `/guide` copy is honest about this: "clarity, precision, and
> educational usefulness over cinematic spectacle", "structural hierarchies — headers, bullet
> points, formulas".

That is the good news and it is also the trap. The space being open is worth nothing until
we can draw in it well, and right now a medical lesson gets a valentine ❤️ where the heart
should be. **A crude diagram is worse than their beautiful text**, because their text is at
least never embarrassing.

## The honest scoreboard

|                                  | Golpo                                 | Inkcast today                          |
| -------------------------------- | ------------------------------------- | -------------------------------------- |
| scene titles / orientation       | every scene, written first            | **none**                               |
| handwriting beauty               | excellent, multicolour                | good, one ink + one accent             |
| maths & chemistry notation       | fractions, roots, sub/superscripts, ⇌ | **Unicode in a `label`, nothing more** |
| illustrated objects              | rich, detailed, appealing             | 8 geometric primitives                 |
| technical labelled diagrams      | **does not attempt**                  | attempts, quality uneven               |
| board legibility                 | 2–4 big things, centred               | 23% fill, small, sprawling             |
| cue-accurate part-by-part reveal | not observed                          | **yes, 175/175 word-exact**            |
| persistent canvas                | no, wipes                             | yes — and unmeasured whether it helps  |
| open weights / free / local      | no, $39.99–$999.99/mo                 | yes                                    |

Two rows there are ours alone and worth defending. The rest is a list of things to fix.

## What to do, in the order it will be noticed

1. **A title per scene, written first, with an underline flourish.** Cheapest thing on this
   list and it fixes the loudest complaint. Also an opening title card for the film.
2. **Fewer, bigger things per scene.** Whether by wiping, or by framing one cell tightly
   enough that it reads as a card, the target is 2–4 legible objects, not 27 small marks.
   `fillcheck` should be a target now, not just a regression check.
3. **A `math` mark.** Already item 3 of the handoff and now clearly urgent: it is the thing
   they are best at and we cannot do at all. `EquationElement` already typesets TeX.
4. **Stop drawing the symbol of a thing.** A heart is not ❤️, a brain is not a cloud. Two
   levers — a brief rule, and the hybrid below.
5. **Hybrid organ/object drawing.** Measured this session on the same beat, same words: the
   diffusion model returns an anatomically correct heart with no conduction system in it;
   composed marks return a correct, fully labelled conduction system on a valentine. Each
   supplies exactly what the other lacks. An image for the _form_, marks for the _parts and
   their names_, is the drawing neither lane can make alone — and it is the one thing on
   this list Golpo could not copy, because their illustrations carry no addressable parts.
6. **Colour per object.** Our four-tone discipline is defensible for a two-flow diagram and
   too austere for a board of separate vignettes. Loosen it where objects are spatially
   separate.
