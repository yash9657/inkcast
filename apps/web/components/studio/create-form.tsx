'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRightIcon,
  ChevronDownIcon,
  LinkIcon,
  PencilLineIcon,
  SlidersHorizontalIcon,
  UploadIcon,
} from 'lucide-react';

import {
  Button,
  Callout,
  Chip,
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
  { value: '16:9', label: 'Landscape', hint: 'YouTube, lessons', glyph: 'h-5 w-9' },
  { value: '9:16', label: 'Vertical', hint: 'Shorts, Reels', glyph: 'h-8 w-[1.125rem]' },
  { value: '1:1', label: 'Square', hint: 'Feeds, embeds', glyph: 'size-7' },
];

const FILM_FORMATS: { value: FilmFormat; label: string; hint: string; seconds: number }[] = [
  { value: 'explainer', label: 'Explainer', hint: 'About 75 seconds', seconds: 75 },
  { value: 'deepdive', label: 'Deep dive', hint: 'About 2½ minutes', seconds: 150 },
];

const PROVIDER_NAMES: Record<string, string> = {
  fireworks: 'Fireworks',
  anthropic: 'Anthropic',
  elevenlabs: 'ElevenLabs',
  local: 'Local',
};

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
      if (length === 0) return 'Type a question or paste some notes first.';
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
  const voiceName = cloudSpeech ? cloudVoice.trim() || 'River' : voiceLabel(voice);
  const styleName = inkStyles.find((s) => s.value === style)?.label;
  const paletteName = PALETTES.find((p) => p.value === palette)?.label;
  const providerSummary = [providers.planner, providers.speech]
    .filter((id, index, all) => all.indexOf(id) === index)
    .map((id) => PROVIDER_NAMES[id] ?? id)
    .join(' + ');

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-8 sm:gap-10"
    >
      {/* ── The source ─────────────────────────────────────────────── */}
      <section
        aria-label="Source"
        className={cn(
          'rounded-2xl border border-border bg-card p-4 shadow-card sm:p-5',
          'transition-[border-color,box-shadow] duration-fast ease-out',
          'focus-within:border-input',
        )}
      >
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
            <TabsList aria-label="How to add your source">
              <TabsTab value="text">
                <PencilLineIcon aria-hidden />
                Write
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
                {words.toLocaleString()} words · ≈{clock(estimate)} spoken
              </p>
            ) : null}
          </div>

          <TabsPanel value="text" className="mt-3">
            <Label htmlFor="source-text" className="sr-only">
              Your question, notes or document
            </Label>
            <Textarea
              id="source-text"
              ref={textRef}
              rows={6}
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
              placeholder="How does a solar panel turn sunlight into electricity?"
              className={cn(
                'max-h-[28rem] min-h-40 rounded-none border-0 bg-transparent px-1 py-2 text-lg leading-relaxed',
                'focus-visible:border-0 focus-visible:shadow-none',
              )}
            />

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-4">
              <span className="mr-1 text-sm text-muted-foreground">Try</span>
              {EXAMPLES.map((example) => (
                <Chip
                  key={example.label}
                  on="card"
                  onClick={() => {
                    setText(example.text);
                    setTitle(example.title);
                    setProblem(undefined);
                    setRejection(undefined);
                    textRef.current?.focus();
                  }}
                >
                  {example.label}
                </Chip>
              ))}
            </div>
          </TabsPanel>

          <TabsPanel value="file" className="mt-4">
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
          </TabsPanel>

          <TabsPanel value="url" className="mt-4 flex flex-col gap-2 pb-1">
            <Label htmlFor="source-url">Page address</Label>
            <Input
              id="source-url"
              aria-invalid={shownError ? true : undefined}
              aria-describedby={shownError ? 'source-error' : 'source-url-hint'}
              type="url"
              inputMode="url"
              value={url}
              autoComplete="url"
              placeholder="https://example.com/an-article"
              onChange={(event) => setUrl(event.target.value)}
            />
            <LabelHint id="source-url-hint">
              A public article or web page. Inkcast reads the main text.
            </LabelHint>
          </TabsPanel>
        </Tabs>

        {shownError ? (
          <LabelError id="source-error" tabIndex={-1} role="alert" className="mt-3 px-1">
            {shownError}
          </LabelError>
        ) : null}
      </section>

      {/* ── Shape ──────────────────────────────────────────────────── */}
      <section aria-label="Format and length" className="flex flex-col gap-3">
        <div className="grid gap-6 sm:grid-cols-[1.45fr_1fr]">
          <TileGroup
            name="format"
            legend="Format"
            value={aspect}
            onValueChange={setAspect}
            options={FORMATS.map((option) => ({
              value: option.value,
              label: option.label,
              hint: option.hint,
              visual: <AspectGlyph glyph={option.glyph} />,
            }))}
            className="grid-cols-3"
          />
          <TileGroup
            name="length"
            legend="Length"
            value={format}
            onValueChange={setFormat}
            options={FILM_FORMATS.filter(
              (option) => !caps || caps.formats.includes(option.value),
            ).map((option) => ({
              value: option.value,
              label: option.label,
              hint: option.hint,
            }))}
            className="grid-cols-2"
          />
        </div>
        {!caps || lengthHonoured ? null : (
          <LabelHint>
            This studio build plans from the length of the source, so the runtime follows the
            document.
          </LabelHint>
        )}
      </section>

      {/* ── More options ───────────────────────────────────────────── */}
      <section className="border-t border-border-subtle pt-2">
        <button
          type="button"
          aria-expanded={showOptions}
          aria-controls="create-options"
          onClick={() => setShowOptions((open) => !open)}
          className={cn(
            'focus-ring group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-3 text-left',
            'transition-colors duration-fast hover:bg-accent/40',
          )}
        >
          <SlidersHorizontalIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium text-foreground">More options</span>
          <span className="tabular min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {languageLabel} · {voiceName} · {styleName} · {paletteName}
            {caps ? ` · ${providerSummary}` : ''}
          </span>
          <ChevronDownIcon
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-brisk',
              showOptions && 'rotate-180',
            )}
            aria-hidden
          />
        </button>

        {showOptions ? (
          <div id="create-options" className="mt-4 flex flex-col gap-8 pb-2">
            <OptionGroup title="Voice">
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
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="voice">Voice</Label>
                  {cloudSpeech ? (
                    <Input
                      id="voice"
                      value={cloudVoice}
                      maxLength={100}
                      placeholder="River, Rachel, or a voice ID"
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
                </div>
              </div>
              {localVoice || cloudSpeech ? (
                <LabelHint className="mt-2">
                  {cloudSpeech
                    ? 'A voice name or ID from your ElevenLabs account.'
                    : 'Local Kokoro voice. No speech API charge.'}
                </LabelHint>
              ) : (
                <Callout tone="warning" className="mt-3">
                  The local voice speaks English only. Choose ElevenLabs under Providers for{' '}
                  {languageLabel} narration.
                </Callout>
              )}
            </OptionGroup>

            <OptionGroup title="Drawing">
              <div className="flex flex-col gap-6">
                <TileGroup
                  name="style"
                  legend="Ink"
                  hint="Stroke weight, texture and wobble."
                  value={style}
                  onValueChange={setStyle}
                  options={inkStyles.map((option) => ({
                    value: option.value,
                    label: option.label,
                    hint: option.hint,
                  }))}
                  className="grid-cols-2 sm:grid-cols-3"
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
              </div>
            </OptionGroup>

            <OptionGroup title="Title">
              <Label htmlFor="title" className="sr-only">
                Title
              </Label>
              <Input
                id="title"
                value={title}
                placeholder="Leave empty to use the source’s own title"
                onChange={(event) => setTitle(event.target.value)}
              />
            </OptionGroup>

            {caps && !capsError ? (
              <OptionGroup title="Providers">
                <ProviderChoices caps={caps} value={providers} onChange={setSelection} />
              </OptionGroup>
            ) : null}
          </div>
        ) : null}
      </section>

      {capsError ? (
        <Callout
          role="alert"
          tone="destructive"
          title="Couldn’t load your provider settings"
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void refreshCapabilities()}
            >
              Try again
            </Button>
          }
        >
          {capsError}
        </Callout>
      ) : null}

      {/* ── Go ─────────────────────────────────────────────────────── */}
      <div
        className={cn(
          'sticky bottom-0 z-20 -mx-[var(--gutter)] border-t border-border-subtle bg-background/95 px-[var(--gutter)] py-3 backdrop-blur-md',
          'sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none',
        )}
      >
        <div className="flex items-center justify-between gap-4">
          <p className="min-w-0 text-sm text-muted-foreground max-sm:hidden">
            {!caps && !capsError ? (
              <span role="status">Checking your settings…</span>
            ) : mode === 'text' && words > 0 ? (
              <>
                About{' '}
                <span className="tabular font-medium text-foreground">
                  {clock(lengthHonoured ? chosenFormat.seconds : estimate)}
                </span>{' '}
                of video. You can review every scene after.
              </>
            ) : (
              'You can review every scene before you share it.'
            )}
          </p>
          <div className="flex items-center gap-3 max-sm:w-full">
            <span
              className="hidden items-center gap-1 text-xs text-muted-foreground lg:inline-flex"
              aria-hidden
            >
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd>
            </span>
            <Button
              type="submit"
              size="lg"
              disabled={submitting || !caps || Boolean(capsError)}
              className="max-sm:w-full"
            >
              {submitting ? 'Starting…' : 'Create video'}
              {submitting ? null : <ArrowRightIcon aria-hidden />}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

function OptionGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}
