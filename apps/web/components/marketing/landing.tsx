import Link from 'next/link';
import { ArrowDownIcon, ArrowRightIcon, CheckIcon, FileTextIcon, PlusIcon } from 'lucide-react';
import { Button, GithubIcon } from '@/components/ui';
import { GpsShowcase } from './gps-showcase';
import { repoUrl, signInRequired, STUDIO_TOPIC_MAX, studioTopicHref } from './site-config';

const questions = [
  [
    'What can I turn into a video?',
    'Start with a topic, paste your notes, upload a PDF, Word document or text file, or add a link to a public web page. Inkcast uses that source to plan an explanation, draw the visuals and record the narration.',
  ],
  [
    'Do I need API keys?',
    'You can use local planning, Kokoro narration and built-in artwork without paid provider keys. For model-written lessons and diagrams, connect Fireworks or Anthropic. ElevenLabs adds more voice and language options. You choose the providers for each video.',
  ],
  [
    'Can I edit the result?',
    'Yes. Open your project to review the scenes and request changes in words. Your edits update the storyboard; re-render when you are ready to make a new video.',
  ],
  [
    'What does it cost?',
    'Local processing has no provider fees. When you connect a cloud provider, usage is billed directly to that provider account. Inkcast is open-source software, so you can also run it on your own hardware.',
  ],
  [
    'Can I host it myself?',
    'Yes. Inkcast is available under AGPL-3.0-only. The local path includes planning, speech and rendering without an account or cloud provider. Your projects are stored on your own machine.',
  ],
];

export function Landing() {
  const canEdit = process.env.INKCAST_STORAGE !== 'blob';
  return (
    <>
      <section className="landing-opening page-container">
        <div className="landing-intro">
          <h1>
            A good idea.
            <br />
            <span className="text-primary">
              Beautifully
              <br className="hidden lg:block" /> explained.
            </span>
          </h1>
          <div className="landing-start">
            <p className="text-lg leading-relaxed text-muted-foreground">
              Turn what you know into a hand-drawn video.
              <br className="hidden xl:block" /> Bring the idea. Inkcast draws it out, talks it
              through, and makes it yours.
            </p>
            <form action="/studio" method="get" className="topic-composer">
              <label htmlFor="landing-topic" className="text-sm font-medium">
                What would you like to explain?
              </label>
              <textarea
                id="landing-topic"
                name="topic"
                maxLength={STUDIO_TOPIC_MAX}
                rows={2}
                required
                placeholder="Why do airplanes stay in the air?"
                className="focus-ring w-full resize-none bg-transparent text-md outline-none"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">An idea is all you need.</span>
                <Button type="submit">
                  Create a video <ArrowRightIcon aria-hidden />
                </Button>
              </div>
            </form>
            <p className="text-xs text-muted-foreground">
              {signInRequired
                ? 'Sign in to create. Your idea comes with you.'
                : 'Local creation available. No provider keys required.'}
            </p>
          </div>
        </div>
        <div className="landing-example" id="examples">
          <div className="example-source">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileTextIcon className="size-4" aria-hidden /> The question
            </div>
            <div className="source-note">
              <span className="text-xs text-muted-foreground">GPS, explained</span>
              <h2 className="mt-5 text-xl">How does GPS find my phone?</h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Follow a satellite signal from space to your phone, then see how timing turns into a
                position on a map.
              </p>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Ranges, clock corrections, and the story behind that little blue dot.
              </p>
            </div>
            <Link
              href={studioTopicHref('How does GPS find my phone?')}
              className="focus-ring mt-6 inline-flex items-center gap-2 text-sm font-medium"
            >
              Explain this topic <ArrowRightIcon className="size-4" aria-hidden />
            </Link>
          </div>
          <figure className="example-output">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-5 py-4 text-sm">
              <span id="gps-film-title" className="font-medium">
                How GPS finds your position
              </span>
              <span className="text-xs text-muted-foreground">2:47 · 1080p</span>
            </div>
            <GpsShowcase />
            <figcaption className="border-t border-border-subtle px-5 py-4 text-sm text-muted-foreground">
              A finished Inkcast film. Press play for the full narrated explanation.
            </figcaption>
          </figure>
        </div>
        <div className="landing-proof">
          <span>
            <CheckIcon aria-hidden /> Narration included
          </span>
          <span>
            <CheckIcon aria-hidden /> Three video formats
          </span>
          <span>
            <CheckIcon aria-hidden /> {canEdit ? 'Editable storyboards' : 'Download & share'}
          </span>
          <span>
            <CheckIcon aria-hidden /> Open source
          </span>
        </div>
      </section>

      <section id="how-it-works" className="landing-workflow page-container">
        <div className="section-heading">
          <h2>
            From a spark
            <br />
            to “I get it.”
          </h2>
          <p>
            Less time assembling a video.
            <br />
            More time getting your idea across.
          </p>
        </div>
        <ol className="workflow-steps">
          <li>
            <span className="step-number">1</span>
            <div>
              <h3>Bring something worth explaining.</h3>
              <p>
                A question, lecture notes, a document, a web page. Start wherever your idea already
                lives.
              </p>
            </div>
            <span className="step-detail">Text · Files · Links</span>
          </li>
          <li>
            <span className="step-number">2</span>
            <div>
              <h3>Give it a voice and a frame.</h3>
              <p>
                Choose a short explainer or a deeper lesson. Pick the format, drawing style and
                narration that fit.
              </p>
            </div>
            <span className="step-detail">Your creative choices</span>
          </li>
          <li>
            <span className="step-number">3</span>
            <div>
              <h3>Watch it come together.</h3>
              <p>
                Inkcast plans, narrates and draws. Watch the result, then download it or share a
                link.
              </p>
            </div>
            <span className="step-detail">A video you can keep</span>
          </li>
        </ol>
      </section>

      <section className="format-section">
        <div className="page-container">
          <div className="section-heading">
            <h2>
              Made to make
              <br />
              sense. Anywhere.
            </h2>
            <p>
              A lesson for the classroom.
              <br />
              An idea for the feed. Same creative freedom.
            </p>
          </div>
          <div className="format-gallery">
            <Link href="/studio?aspect=16%3A9" className="focus-ring format-example format-wide">
              <div className="format-board wide-board" aria-hidden>
                <span className="font-hand text-xl">A little less error.</span>
                <svg viewBox="0 0 360 130" className="w-full max-w-sm">
                  <path d="M28 12v100h310" fill="none" stroke="currentColor" strokeWidth="2" />
                  <path
                    d="M50 25Q160 170 312 34"
                    fill="none"
                    stroke="var(--ink-green)"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  <circle cx="95" cy="69" r="6" fill="var(--ink-green)" />
                  <circle cx="147" cy="93" r="6" fill="var(--ink-green)" />
                  <circle cx="195" cy="94" r="6" fill="var(--ink-green)" />
                </svg>
                <span className="font-hand text-sm">One step at a time.</span>
              </div>
              <div className="flex justify-between gap-4">
                <div>
                  <h3>Room for the whole idea</h3>
                  <p>YouTube, lessons and presentations</p>
                </div>
                <span>16:9</span>
              </div>
            </Link>
            <Link href="/studio?aspect=9%3A16" className="focus-ring format-example format-tall">
              <div className="format-board tall-board" aria-hidden>
                <span className="font-hand text-lg">
                  Start with
                  <br />a question.
                </span>
                <ArrowDownIcon className="my-4 size-8 text-ink-green" />
                <span className="rounded-lg border border-ink-green px-3 py-2 font-hand text-sm">
                  Follow the idea.
                </span>
                <ArrowDownIcon className="my-4 size-8 text-ink-green" />
                <span className="font-hand text-lg">Make it click.</span>
              </div>
              <div className="flex justify-between gap-4">
                <div>
                  <h3>A thought worth sharing</h3>
                  <p>Shorts, Reels and TikTok</p>
                </div>
                <span>9:16</span>
              </div>
            </Link>
            <Link href="/studio?aspect=1%3A1" className="focus-ring format-example format-square">
              <div className="format-board square-board" aria-hidden>
                <span className="font-hand text-lg">Connect the dots.</span>
                <svg viewBox="0 0 200 130" className="w-48">
                  <path
                    d="M44 70 100 28 156 70 100 110Z"
                    fill="none"
                    stroke="var(--ink-blue)"
                    strokeWidth="2"
                  />
                  {[
                    [44, 70],
                    [100, 28],
                    [156, 70],
                    [100, 110],
                  ].map(([x, y]) => (
                    <circle
                      key={`${x}-${y}`}
                      cx={x}
                      cy={y}
                      r="12"
                      fill="var(--paper)"
                      stroke="var(--ink-blue)"
                      strokeWidth="2"
                    />
                  ))}
                </svg>
              </div>
              <div className="flex justify-between gap-4">
                <div>
                  <h3>Fits right into the feed</h3>
                  <p>Posts, embeds and updates</p>
                </div>
                <span>1:1</span>
              </div>
            </Link>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            Illustrative frames. Choose your video format in the studio.
          </p>
        </div>
      </section>

      <section className="ownership-section page-container">
        <h2>
          Your words.
          <br />
          Your video.
          <br />
          <span className="text-primary">Your way.</span>
        </h2>
        <div className="ownership-copy">
          <h3>Creative control comes standard.</h3>
          <p>
            {canEdit
              ? 'Your first render is a starting point. Review each scene, make changes in plain language, and keep shaping the explanation until it says what you mean.'
              : 'Pick your format, drawing style and narration. Review the scenes in your finished video, then download the result or send a share link. Storyboard editing is available in the self-hosted studio.'}
          </p>
          <h3 className="mt-8">Open source. Open possibilities.</h3>
          <p>
            Use local planning and speech, connect your own providers, or host the whole studio
            yourself. Cloud usage is billed by the providers you choose.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button render={<Link href="/studio" />}>
              Open the studio <ArrowRightIcon aria-hidden />
            </Button>
            {repoUrl ? (
              <Button
                variant="outline"
                render={<a href={repoUrl} target="_blank" rel="noreferrer" />}
              >
                <GithubIcon aria-hidden /> View source
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <section id="faq" className="faq-section page-container">
        <div className="section-heading">
          <h2>A few good questions.</h2>
          <p>The practical things, before you start.</p>
        </div>
        <div className="faq-list">
          {questions.map(([question, answer]) => (
            <details key={question} className="group">
              <summary className="focus-ring">
                <h3>{question}</h3>
                <PlusIcon
                  className="size-5 shrink-0 transition-transform group-open:rotate-45"
                  aria-hidden
                />
              </summary>
              <p>
                {question === 'Can I edit the result?' && !canEdit
                  ? 'You can review every scene here. Editing and re-rendering are currently available in the self-hosted studio; on this site, start a new video with your revised source.'
                  : answer}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section className="closing-section page-container">
        <div>
          <h2>
            Something on your mind?
            <br />
            Let’s draw it out.
          </h2>
          <Button size="lg" render={<Link href="/studio" />}>
            Create your first video <ArrowRightIcon aria-hidden />
          </Button>
        </div>
      </section>
    </>
  );
}
