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
  LightbulbIcon,
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
  errorMessage,
  generate,
  getCapabilities,
  keyStateFor,
  type Aspect,
  type Capabilities,
  type FilmFormat,
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
import { ProviderChoices } from './provider-choices';
import { defaultSelection, selectedVoice, type ProviderSelection } from '@/lib/provider-selection';
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

type Mode = 'text' | 'file' | 'url';

const FORMATS: { value: Aspect; label: string; hint: string; glyph: string }[] = [
  {
    value: '9:16',
    label: 'Vertical',
    hint: '9:16 · Shorts, Reels, TikTok',
    glyph: 'h-9 w-5',
  },
  {
    value: '16:9',
    label: 'Landscape',
    hint: '16:9 · YouTube, lessons, slides',
    glyph: 'h-7 w-12',
  },
  { value: '1:1', label: 'Square', hint: '1:1 · Feeds and embeds.', glyph: 'h-8 w-8' },
];

const FILM_FORMATS: { value: FilmFormat; label: string; hint: string; seconds: number }[] = [
  {
    value: 'explainer',
    label: 'Explainer',
    hint: 'About 75 seconds. One idea, clearly explained.',
    seconds: 75,
  },
  {
    value: 'deepdive',
    label: 'Deep dive',
    hint: 'About 2½ minutes. More context and detail.',
    seconds: 150,
  },
];

function formatOption(format: FilmFormat) {
  return FILM_FORMATS.find((option) => option.value === format) ?? FILM_FORMATS[0]!;
}

export function CreateForm() {
  const router = useRouter();
  const params = useSearchParams();
  // `/studio?example=gradient-descent` arrives from the library's empty state,
  // so a link can hand the box its starting content.
  const preset = findExample(params.get('example'));

  const arriving = params.get(STUDIO_TOPIC_PARAM)?.trim().slice(0, STUDIO_TOPIC_MAX) || undefined;

  const [mode, setMode] = React.useState<Mode>('text');
  const [text, setText] = React.useState(preset?.text ?? arriving ?? '');
  const [url, setUrl] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [title, setTitle] = React.useState(preset?.title ?? '');

  const claimedStash = React.useRef(false);
  React.useEffect(() => {
    if (claimedStash.current) return;
    claimedStash.current = true;
    if (preset || arriving) return;
    const stashed = takeStashedTopic();
    if (!stashed) return;
    setText((current) => (current.trim() === '' ? stashed : current));
  }, [preset, arriving]);

  const [aspect, setAspect] = React.useState<Aspect>(() => {
    const requested = params.get('aspect');
    return requested === '9:16' || requested === '1:1' ? requested : '16:9';
  });
  const [format, setFormat] = React.useState<FilmFormat>('explainer');
  const [style, setStyle] = React.useState<InkStyle>('marker');
  const [palette, setPalette] = React.useState<Palette>('color');
  const [language, setLanguage] = React.useState('en');
  const [voice, setVoice] = React.useState<string>(DEFAULT_VOICE);
  const [cloudVoice, setCloudVoice] = React.useState('River');
  const [selection, setSelection] = React.useState<ProviderSelection>();
  const submittingRef = React.useRef(false);

  const [showOptions, setShowOptions] = React.useState(false);
  const [attempted, setAttempted] = React.useState(false);
  const [problem, setProblem] = React.useState<string | undefined>(undefined);

  const [rejection, setRejection] = React.useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = React.useState(false);

  const textRef = React.useRef<HTMLTextAreaElement>(null);

  const [caps, setCaps] = React.useState<Capabilities | undefined>(undefined);
  const [capsError, setCapsError] = React.useState<string>();
  const refreshCapabilities = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const value = await getCapabilities(signal);
      if (signal?.aborted) return;
      setCaps(value);
      setCapsError(undefined);
    } catch (err) {
      if (!signal?.aborted) setCapsError(errorMessage(err));
    }
  }, []);
  React.useEffect(() => {
    const controller = new AbortController();
    const refresh = () => void refreshCapabilities(controller.signal);
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      controller.abort();
      window.removeEventListener('focus', refresh);
    };
  }, [refreshCapabilities]);
  const providers = selection ?? caps?.selection ?? defaultSelection(caps?.keys ?? []);
  const cloudSpeech = providers.speech === 'elevenlabs';

  const words = wordCount(text);
  const estimate = estimateSpokenSeconds(text);
  const chosenFormat = formatOption(format);
  // Whether this build will honour the chosen length at all. A server that predates
  // `formats` renders at its own default, and the copy below says so rather than
  // showing a picker that quietly does nothing — which is what the control this one
  // replaces did for its whole life.
  const lengthHonoured = (caps?.formats.length ?? 0) > 0;
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
    if (submittingRef.current || !caps || capsError) return;
    setAttempted(true);
    setRejection(undefined);
    const found = validate();
    setProblem(found);
    if (found) {
      if (mode === 'text') textRef.current?.focus();
      else document.getElementById(mode === 'url' ? 'source-url' : 'source-error')?.focus();
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const input: GenerateInput = {
        aspect,
        language,
        voice: selectedVoice(providers, cloudSpeech ? cloudVoice.trim() || 'River' : voice),
        providers,
        style,
        palette,
        format,
        // Only fields the server advertised are actually sent. See `generate()`.
        ...(caps ? { accepts: caps.accepts, formats: caps.formats } : {}),
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
      submittingRef.current = false;
      setSubmitting(false);
      setRejection(errorMessage(err));
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
      className="create-form"
    >
      <section className="source-editor">
        <div className="mb-5">
          <h2 className="text-xl">What’s the idea?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a topic, your notes, or something you’ve already written.
          </p>
        </div>
        <div>
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
                  Write or paste
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
                rows={8}
                value={text}
                spellCheck
                aria-invalid={shownError ? true : undefined}
                aria-describedby={shownError ? 'source-error' : undefined}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void submit();
                  }
                }}
                placeholder={
                  'Explain a concept, tell a story, or paste your notes…\n\nFor example: How does a solar panel turn sunlight into electricity?'
                }
                className="source-textarea max-h-96 text-md"
              />

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <LightbulbIcon className="size-3.5" aria-hidden />
                  Need a starting point?
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
                PDF, Word, Markdown and text files are supported. Your source is uploaded to Inkcast
                for processing.
              </LabelHint>
            </TabsPanel>

            <TabsPanel value="url">
              <Label htmlFor="source-url">Page address</Label>
              <Input
                id="source-url"
                aria-invalid={shownError ? true : undefined}
                aria-describedby={shownError ? 'source-error' : undefined}
                type="url"
                inputMode="url"
                value={url}
                autoComplete="url"
                placeholder="https://example.com/an-article"
                onChange={(event) => setUrl(event.target.value)}
                className="mt-2"
              />
              <LabelHint className="mt-2">
                Use a public article or web page. We’ll extract the readable text.
              </LabelHint>
            </TabsPanel>
          </Tabs>

          {shownError ? (
            <LabelError id="source-error" tabIndex={-1} role="alert" className="mt-3">
              {shownError}
            </LabelError>
          ) : null}
        </div>
      </section>

      <section className="create-format">
        <h2 className="mb-5 text-xl">Shape the video</h2>
        <div className="flex flex-col gap-6">
          <TileGroup
            name="format"
            legend="Format"
            hint="Choose where your video will live."
            value={aspect}
            onValueChange={setAspect}
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
            name="length"
            legend="Length"
            hint="A quick explanation or room to go deeper."
            value={format}
            onValueChange={setFormat}
            options={FILM_FORMATS.filter(
              (option) => !caps || caps.formats.includes(option.value),
            ).map((option) => ({
              value: option.value,
              label: option.label,
              hint: option.hint,
            }))}
            className="grid-cols-1 sm:grid-cols-2"
          />

          <LabelHint>
            {lengthHonoured ? (
              <>Target length: {clock(chosenFormat.seconds)}. Final timing follows the narration.</>
            ) : (
              <>
                This studio build plans from the length of the source rather than a target, so the
                runtime follows the document.
              </>
            )}
          </LabelHint>
        </div>
      </section>

      <section className="create-options-section">
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
            {showOptions ? 'Hide voice & style' : 'Voice & style'}
          </Button>

          {showOptions ? null : (
            <p className="tabular min-w-0 text-xs text-muted-foreground">
              {languageLabel} · {cloudSpeech ? cloudVoice || 'River' : voiceLabel(voice)} ·{' '}
              {inkStyles.find((s) => s.value === style)?.label} ·{' '}
              {PALETTES.find((p) => p.value === palette)?.label}
            </p>
          )}
        </div>

        {showOptions ? (
          <Card id="create-options" className="mt-4 gap-6 border-0 bg-transparent p-0">
            <CardContent className="flex flex-col gap-6">
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
                  {localVoice || cloudSpeech ? (
                    <LabelHint>Narration is measured, so timing reflows per language.</LabelHint>
                  ) : (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs leading-relaxed text-warning">
                      <Badge variant="warning">Needs a key</Badge>
                      The local voice speaks English only. Select ElevenLabs above for{' '}
                      {languageLabel} narration.
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="voice">Voice</Label>
                  {cloudSpeech ? (
                    <Input
                      id="voice"
                      value={cloudVoice}
                      maxLength={100}
                      placeholder="River, Rachel, or your ElevenLabs voice ID"
                      onChange={(event) => setCloudVoice(event.target.value)}
                    />
                  ) : (
                    <Select
                      value={voice}
                      onValueChange={(value: unknown) => setVoice(String(value))}
                    >
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
                  )}
                  <LabelHint>
                    {cloudSpeech
                      ? 'A voice name or ID from your ElevenLabs account. Availability depends on your plan and key permissions.'
                      : 'Runs locally with Kokoro. No speech API charge.'}
                  </LabelHint>
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
      </section>

      <section className="create-providers">
        {' '}
        {capsError ? (
          <div role="alert" className="flex flex-col gap-2 text-sm text-destructive">
            <p>Could not load your provider settings. {capsError}</p>
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => void refreshCapabilities()}
            >
              Try again
            </Button>
          </div>
        ) : caps ? (
          <ProviderChoices caps={caps} value={providers} onChange={setSelection} />
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Loading your provider settings…
          </p>
        )}
      </section>
      <div className="create-submit">
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          Your source is uploaded to Inkcast. You can review every scene once your video is ready.{' '}
          {mode === 'text' && words > 0 ? (
            <span className="text-foreground">≈{clock(estimate)} of video.</span>
          ) : null}
        </p>

        <Button
          type="submit"
          size="lg"
          disabled={submitting || !caps || Boolean(capsError)}
          className="shrink-0"
        >
          {submitting ? 'Starting your video…' : 'Create video'}
          {submitting ? null : <ArrowRightIcon aria-hidden />}
        </Button>
      </div>

      <p
        className={cn(
          'create-shortcut flex items-center justify-end gap-1.5 text-xs text-muted-foreground',
          'max-sm:hidden',
        )}
      >
        <Kbd>⌘</Kbd>
        <Kbd>↵</Kbd>
        to create from the text field
      </p>
    </form>
  );
}
