'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRightIcon,
  BrainIcon,
  KeyRoundIcon,
  LinkIcon,
  PencilLineIcon,
  SettingsIcon,
  SparklesIcon,
  UploadIcon,
} from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Kbd,
  Label,
  LabelError,
  LabelHint,
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  Separator,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Textarea,
  toast,
} from '@/components/ui';
import {
  acceptsTargetLength,
  errorMessage,
  generate,
  getCapabilities,
  keyStateFor,
  type Aspect,
  type Capabilities,
  type Depth,
  type GenerateInput,
  type InkStyle,
  type Palette,
} from '@/lib/api';
import {
  STUDIO_TOPIC_MAX,
  STUDIO_TOPIC_PARAM,
  takeStashedTopic,
} from '@/components/marketing/site-config';
import { cn } from '@/lib/utils';

import { FileDrop } from './file-drop';
import { clock, estimateSpokenSeconds, wordCount } from './format';
import {
  DEFAULT_VOICE,
  MAX_SOURCE_CHARS,
  MIN_SOURCE_CHARS,
  EXAMPLES,
  LANGUAGES,
  LOCAL_LANGUAGES,
  PALETTES,
  VOICE_GROUPS,
  findExample,
  isTextualFile,
  styleOptions,
  voiceLabel,
} from './options';
import { AspectGlyph, TileGroup } from './tile-group';

/**
 * The create surface: one input, three ways to fill it, and options that stay
 * folded away until they are asked for.
 *
 * The three modes are tabs rather than three stacked fields because only one of
 * them can be the source — a screen with a paste box *and* a URL box *and* a
 * dropzone all live makes the user work out which one wins.
 */

type Mode = 'text' | 'file' | 'url';

/**
 * Frame shapes, vertical first.
 *
 * Not a re-ordering for taste: short-form vertical is the distribution channel
 * for teaching, and the 45-second constraint improves the video by forcing one
 * idea, one visual, one payoff. A picker that lists it third, in a collapsed
 * "Options" panel, states the opposite. So this lives above the fold with the
 * other two beside it, and the shape choice sets the default depth.
 *
 * Declared here rather than in `options.ts` because the two tables below are
 * about *teaching*, not about what the pipeline's enums happen to be; the values
 * themselves are still exactly `StoryboardMeta['aspect']`.
 */
const FORMATS: { value: Aspect; label: string; hint: string; glyph: string }[] = [
  {
    value: '9:16',
    label: 'Short · vertical',
    hint: 'Shorts, Reels, TikTok. A tall canvas the camera walks down.',
    glyph: 'h-9 w-5',
  },
  {
    value: '16:9',
    label: 'Wide · landscape',
    hint: 'YouTube, slides, a doc. Room for a whole lesson to accumulate.',
    glyph: 'h-7 w-12',
  },
  { value: '1:1', label: 'Square', hint: 'Feeds and embeds.', glyph: 'h-8 w-8' },
];

/**
 * How thoroughly to teach.
 *
 * Phrased as pedagogy rather than as a duration slider, because the length is a
 * consequence of the choice and not the choice itself. `seconds` is the target
 * the lesson stage plans against — see `critiqueLesson(l, { maxSeconds })` in
 * `@inkcast/core`, which rejects a plan that overruns it by more than a quarter.
 */
const DEPTHS: { value: Depth; label: string; hint: string; seconds: number }[] = [
  {
    value: 'short',
    label: 'One idea',
    hint: '≈45s. A hook, a single idea, one payoff. Nothing else fits.',
    seconds: 45,
  },
  {
    value: 'standard',
    label: 'A lesson',
    hint: '≈90s. Hook, everyday anchor, a few steps, a worked example, recap.',
    seconds: 90,
  },
  {
    value: 'deep',
    label: 'Thorough',
    hint: '≈3 min. Every step justified from first principles, misconception named.',
    seconds: 180,
  },
];

/** The depth a freshly chosen frame implies. Vertical is short-form by nature. */
function depthForAspect(aspect: Aspect): Depth {
  return aspect === '9:16' ? 'short' : 'standard';
}

function depthOption(depth: Depth) {
  return DEPTHS.find((option) => option.value === depth) ?? DEPTHS[1]!;
}

export function CreateForm() {
  const router = useRouter();
  const params = useSearchParams();
  // `/studio?example=gradient-descent` arrives from the library's empty state,
  // so a link can hand the box its starting content.
  const preset = findExample(params.get('example'));
  /**
   * `/studio?topic=explain%20photosynthesis` arrives from the landing page's try
   * strip, which is a plain GET form aimed straight at this route.
   *
   * This is the other end of the contract stated in `site-config.ts`, and it was
   * an open loop until now: `STUDIO_TOPIC_PARAM` shipped with the strip so the
   * link would resolve, but nothing read it, so a visitor who typed a sentence on
   * the landing page arrived at an empty box. Capped by the same
   * `STUDIO_TOPIC_MAX` the strip enforces, because a query string is not a
   * container for a document and the textarea below is.
   *
   * A `?topic=` and a `?example=` in the same URL cannot both win. The example
   * does, because it names a whole bundled document with a title, and a topic is
   * one line — the more specific instruction is the one to honour.
   */
  const arriving = params.get(STUDIO_TOPIC_PARAM)?.trim().slice(0, STUDIO_TOPIC_MAX) || undefined;

  const [mode, setMode] = React.useState<Mode>('text');
  const [text, setText] = React.useState(preset?.text ?? arriving ?? '');
  const [url, setUrl] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [title, setTitle] = React.useState(preset?.title ?? '');

  /**
   * The last line of defence for a topic typed before a sign-in.
   *
   * On the hosted deployment `/studio?topic=…` can bounce through Clerk, and a
   * sign-up that finishes via an emailed link finishes in whatever tab the mail
   * client opened — where the query string never existed. The wall stashed the
   * sentence in `sessionStorage` on the way out; this claims it once, on mount,
   * and only when the URL asked for nothing and the box is still empty. On a
   * self-hosted box there is no wall, so there is never anything stashed and this
   * effect reads `null` and stops.
   */
  const claimedStash = React.useRef(false);
  React.useEffect(() => {
    if (claimedStash.current) return;
    claimedStash.current = true;
    if (preset || arriving) return;
    const stashed = takeStashedTopic();
    if (!stashed) return;
    setText((current) => (current.trim() === '' ? stashed : current));
  }, [preset, arriving]);

  const [aspect, setAspect] = React.useState<Aspect>('16:9');
  const [depth, setDepth] = React.useState<Depth>(depthForAspect('16:9'));
  /**
   * Once the depth has been chosen by hand, changing the frame stops overriding
   * it. A default that keeps reasserting itself over an explicit choice is a bug,
   * however sensible the default is.
   */
  const [depthChosen, setDepthChosen] = React.useState(false);
  const [style, setStyle] = React.useState<InkStyle>('marker');
  const [palette, setPalette] = React.useState<Palette>('color');
  const [language, setLanguage] = React.useState('en');
  const [voice, setVoice] = React.useState<string>(DEFAULT_VOICE);

  const [showOptions, setShowOptions] = React.useState(false);
  const [attempted, setAttempted] = React.useState(false);
  const [problem, setProblem] = React.useState<string | undefined>(undefined);
  /** A rejected upload is its own message: validation must not overwrite it. */
  const [rejection, setRejection] = React.useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = React.useState(false);

  const textRef = React.useRef<HTMLTextAreaElement>(null);

  /**
   * What this machine can do, asked once on mount.
   *
   * Two jobs. It decides whether the planner banner warns or reassures, and it
   * carries `accepts` — the `meta` fields this build's generate endpoint
   * validates — which is what lets the depth choice be sent without risking a 400
   * against a server whose schema has not learned about it yet. A failure is
   * swallowed: the form must work whether or not this answers, so an unknown
   * capability shows no banner rather than a scary one.
   */
  const [caps, setCaps] = React.useState<Capabilities | undefined>(undefined);
  React.useEffect(() => {
    const controller = new AbortController();
    getCapabilities(controller.signal)
      .then((value) => setCaps(value))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const words = wordCount(text);
  const estimate = estimateSpokenSeconds(text);
  const chosenDepth = depthOption(depth);
  const lengthHonoured = acceptsTargetLength(caps?.accepts);
  // The packs this box can actually draw with, which is a question only the box can
  // answer (plan 9.4). Falls back to the shipped four until `/api/providers` replies.
  const inkStyles = React.useMemo(() => styleOptions(caps?.styles ?? []), [caps?.styles]);

  const validate = React.useCallback((): string | undefined => {
    if (mode === 'text') {
      const length = text.trim().length;
      if (length === 0) return 'Paste the document or notes you want drawn.';
      if (length < MIN_SOURCE_CHARS) {
        return `That is only ${length} characters. The planner needs at least ${MIN_SOURCE_CHARS} — a sentence or two — to find any structure.`;
      }
      if (length > MAX_SOURCE_CHARS) {
        return `That is ${length.toLocaleString()} characters. The limit is ${MAX_SOURCE_CHARS.toLocaleString()} — trim it, or point at a file instead.`;
      }
      return undefined;
    }
    if (mode === 'url') {
      const raw = url.trim();
      if (!raw) return 'Paste the address of a page to read.';
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        return 'That is not a full address. It needs to start with http:// or https://.';
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'Only http and https addresses can be read.';
      }
      return undefined;
    }
    if (!file) return 'Choose a pdf, docx, md or txt file.';
    return undefined;
  }, [mode, text, url, file]);

  // Re-validate live once the user has tried to submit, so the message clears
  // itself as soon as the input is good rather than waiting for another attempt.
  React.useEffect(() => {
    if (attempted) setProblem(validate());
  }, [attempted, validate]);

  const shownError = rejection ?? (attempted ? problem : undefined);

  async function submit() {
    setAttempted(true);
    setRejection(undefined);
    const found = validate();
    setProblem(found);
    if (found) return;

    setSubmitting(true);
    try {
      const input: GenerateInput = {
        aspect,
        language,
        voice,
        style,
        palette,
        depth,
        targetSeconds: chosenDepth.seconds,
        // Only fields the server advertised are actually sent. See `generate()`.
        ...(caps ? { accepts: caps.accepts } : {}),
      };
      const trimmedTitle = title.trim();
      if (trimmedTitle) input.title = trimmedTitle;

      if (mode === 'text') {
        input.text = text;
      } else if (mode === 'url') {
        input.url = url.trim();
      } else if (file) {
        if (isTextualFile(file.name)) {
          // The browser can read this itself, so it goes up as plain text and
          // the server needs no upload handling at all.
          input.text = await file.text();
          if (!input.title) input.title = file.name.replace(/\.[^.]+$/, '');
        } else {
          input.file = file;
        }
      }

      const projectId = await generate(input);
      toast.success('Started drawing', {
        description: 'Progress streams live. Leaving the page will not lose the render.',
      });
      router.push(`/project/${projectId}?generating=1`);
    } catch (err) {
      setSubmitting(false);
      toast.error('Could not start the render', { description: errorMessage(err) });
    }
  }

  const localVoice = LOCAL_LANGUAGES.has(language);
  const languageLabel = LANGUAGES.find((l) => l.value === language)?.label ?? language;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-6"
    >
      <PlannerNotice caps={caps} />

      <Card className="gap-4 py-4">
        <CardContent className="px-4">
          <Tabs
            value={mode}
            onValueChange={(value: unknown) => {
              setMode(value as Mode);
              setProblem(undefined);
              setRejection(undefined);
              setAttempted(false);
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <TabsList>
                <TabsTab value="text">
                  <PencilLineIcon aria-hidden />
                  Paste
                </TabsTab>
                <TabsTab value="file">
                  <UploadIcon aria-hidden />
                  Upload
                </TabsTab>
                <TabsTab value="url">
                  <LinkIcon aria-hidden />
                  Link
                </TabsTab>
              </TabsList>

              {mode === 'text' && words > 0 ? (
                <p className="tabular text-xs text-muted-foreground">
                  {words} words · ≈{clock(estimate)} spoken
                </p>
              ) : null}
            </div>

            <TabsPanel value="text">
              <Label htmlFor="source-text" className="sr-only">
                Document or notes
              </Label>
              <Textarea
                id="source-text"
                ref={textRef}
                rows={9}
                value={text}
                spellCheck={false}
                aria-invalid={shownError ? true : undefined}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void submit();
                  }
                }}
                placeholder={
                  'Paste a document, a set of notes, a README, a lecture outline…\n\nHeadings, lists and formulas all survive — the planner reads structure, so keep it.'
                }
                className="max-h-96 text-md"
              />

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <SparklesIcon className="size-3.5" aria-hidden />
                  Try one
                </span>
                {EXAMPLES.map((example) => (
                  <Button
                    key={example.label}
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      setText(example.text);
                      setTitle(example.title);
                      setProblem(undefined);
                      setRejection(undefined);
                      textRef.current?.focus();
                    }}
                  >
                    {example.label}
                  </Button>
                ))}
              </div>
            </TabsPanel>

            <TabsPanel value="file">
              <FileDrop
                file={file}
                disabled={submitting}
                onFileChange={(next) => {
                  setFile(next);
                  setProblem(undefined);
                  setRejection(undefined);
                  if (next && !title.trim()) setTitle(next.name.replace(/\.[^.]+$/, ''));
                }}
                onReject={setRejection}
              />
              <LabelHint className="mt-3">
                A pdf or docx is read on the server. Markdown and text files are read right here in
                the browser and sent as text.
              </LabelHint>
            </TabsPanel>

            <TabsPanel value="url">
              <Label htmlFor="source-url">Page address</Label>
              <Input
                id="source-url"
                type="url"
                inputMode="url"
                value={url}
                autoComplete="url"
                placeholder="https://example.com/an-article"
                onChange={(event) => setUrl(event.target.value)}
                className="mt-2"
              />
              <LabelHint className="mt-2">
                The page is fetched and stripped to its readable text. It has to be reachable from
                this machine.
              </LabelHint>
            </TabsPanel>
          </Tabs>

          {shownError ? <LabelError className="mt-3">{shownError}</LabelError> : null}
        </CardContent>
      </Card>

      {/* ------------------------------------------------- format and depth */}

      <Card className="gap-6">
        <CardContent className="flex flex-col gap-6">
          <TileGroup
            name="format"
            legend="Format"
            hint="Vertical is a first-class target with its own pacing, not a cropped landscape."
            value={aspect}
            onValueChange={(next) => {
              setAspect(next);
              // The frame implies a length until the user says otherwise.
              if (!depthChosen) setDepth(depthForAspect(next));
            }}
            options={FORMATS.map((option) => ({
              value: option.value,
              label: option.label,
              hint: option.hint,
              visual: <AspectGlyph glyph={option.glyph} />,
            }))}
            className="grid-cols-1 sm:grid-cols-3"
          />

          <Separator />

          <TileGroup
            name="depth"
            legend="Teaching depth"
            hint="How much is explained, and therefore how long it runs."
            value={depth}
            onValueChange={(next) => {
              setDepth(next);
              setDepthChosen(true);
            }}
            options={DEPTHS.map((option) => ({
              value: option.value,
              label: option.label,
              hint: option.hint,
            }))}
            className="grid-cols-1 sm:grid-cols-3"
          />

          <LabelHint>
            {lengthHonoured ? (
              <>
                The planner aims for {clock(chosenDepth.seconds)} and is rejected if it overruns by
                more than a quarter.
              </>
            ) : (
              <>
                This studio build plans from the length of the source rather than a target, so depth
                is recorded with the project and the runtime follows the document.
              </>
            )}
          </LabelHint>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------- options */}

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={showOptions}
            aria-controls="create-options"
            onClick={() => setShowOptions((open) => !open)}
          >
            <SettingsIcon aria-hidden />
            {showOptions ? 'Hide options' : 'Options'}
          </Button>

          {showOptions ? null : (
            <p className="tabular min-w-0 text-xs text-muted-foreground">
              {languageLabel} · {voiceLabel(voice)} ·{' '}
              {inkStyles.find((s) => s.value === style)?.label} ·{' '}
              {PALETTES.find((p) => p.value === palette)?.label}
            </p>
          )}
        </div>

        {showOptions ? (
          <Card id="create-options" className="animate-in fade-in gap-6 duration-brisk ease-out">
            <CardContent className="flex flex-col gap-6">
              {/* Frame and depth are not here: they changed what the video *is*,
                  so they were promoted above rather than folded away. */}
              <TileGroup
                name="style"
                legend="Ink"
                hint="How the hand draws: stroke weight, texture, wobble."
                value={style}
                onValueChange={setStyle}
                options={inkStyles.map((option) => ({
                  value: option.value,
                  label: option.label,
                  hint: option.hint,
                }))}
                className="grid-cols-2 sm:grid-cols-4"
              />

              <TileGroup
                name="palette"
                legend="Colour"
                value={palette}
                onValueChange={setPalette}
                options={PALETTES.map((option) => ({
                  value: option.value,
                  label: option.label,
                  hint: option.hint,
                }))}
                className="grid-cols-2"
              />

              <Separator />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="language">Language</Label>
                  <Select
                    value={language}
                    onValueChange={(value: unknown) => setLanguage(String(value))}
                  >
                    <SelectTrigger id="language" aria-label="Narration language">
                      <span className="truncate">{languageLabel}</span>
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {localVoice ? (
                    <LabelHint>Narration is measured, so timing reflows per language.</LabelHint>
                  ) : (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs leading-relaxed text-warning">
                      <Badge variant="warning">Needs a key</Badge>
                      The local voice speaks English only. {languageLabel} narration needs
                      ELEVENLABS_API_KEY; without it the run falls back to English.
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="voice">Voice</Label>
                  <Select value={voice} onValueChange={(value: unknown) => setVoice(String(value))}>
                    <SelectTrigger id="voice" aria-label="Narration voice">
                      <span className="truncate">{voiceLabel(voice)}</span>
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {VOICE_GROUPS.map((group) => (
                        <SelectGroup key={group.group}>
                          <SelectGroupLabel>{group.group}</SelectGroupLabel>
                          {group.voices.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  <LabelHint>Runs locally with Kokoro. No key, no per-minute bill.</LabelHint>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  placeholder="Taken from the document if you leave this empty"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* ----------------------------------------------------------- submit */}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          Five stages, on this machine: read the source, plan one growing canvas, narrate and
          measure it, draw every entity once, then ink the frames.{' '}
          {mode === 'text' && words > 0 ? (
            <span className="text-foreground">≈{clock(estimate)} of video.</span>
          ) : null}
        </p>

        <Button type="submit" size="lg" disabled={submitting} className="shrink-0">
          {submitting ? 'Starting…' : 'Draw it'}
          {submitting ? null : <ArrowRightIcon aria-hidden />}
        </Button>
      </div>

      <p
        className={cn(
          'flex items-center justify-end gap-1.5 text-2xs text-muted-foreground',
          'max-sm:hidden',
        )}
      >
        <Kbd>⌘</Kbd>
        <Kbd>↵</Kbd>
        to start from the paste box
      </p>
    </form>
  );
}

/**
 * The one thing worth interrupting the form for: whether a lesson planner is
 * available at all.
 *
 * It is a banner rather than a line of helper text because the difference is not
 * a preference — with no Anthropic key the video summarises the document instead
 * of teaching it, and someone who renders three of those before finding the
 * setting will conclude the product is bad rather than unconfigured.
 *
 * While `caps` is undefined nothing is rendered. A banner that appears and then
 * disappears is worse than one that arrives late, and the studio's whole promise
 * is that it works with no keys — so the absence of an answer must never read as
 * an error.
 */
function PlannerNotice({ caps }: { caps: Capabilities | undefined }) {
  if (!caps) return null;

  const anthropic = keyStateFor(caps, 'anthropic');
  const planning = caps.planner.name === 'anthropic';

  if (planning) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <BrainIcon className="size-3.5 shrink-0" aria-hidden />
        Planning the lesson with {caps.planner.model ?? 'Claude'}.
        <Link
          href="/settings"
          className="focus-ring rounded-xs text-primary underline-offset-4 outline-none hover:underline"
        >
          Keys
        </Link>
      </p>
    );
  }

  return (
    <Card className="gap-3 border-warning/40 bg-warning/6 py-4">
      <CardContent className="flex flex-col gap-3 px-4">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          <Badge variant="warning">
            <KeyRoundIcon aria-hidden />
            Limited output
          </Badge>
          No Anthropic key, so this will summarise rather than teach.
        </p>
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          The local planner splits your document into beats and narrates them in order. It is free,
          instant and deterministic, and it cannot build an idea: no hook, no everyday anchor, no
          worked example, no misconception named and refuted. Everything else — the drawing, the
          narration, the timing — works exactly as it will with a key.
          {anthropic?.unreadable
            ? ' A key is saved but can no longer be decrypted; paste it again.'
            : ''}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          render={<Link href="/settings" />}
        >
          <KeyRoundIcon aria-hidden />
          Add a key
          <ArrowRightIcon aria-hidden />
        </Button>
      </CardContent>
    </Card>
  );
}
