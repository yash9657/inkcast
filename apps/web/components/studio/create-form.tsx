'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRightIcon,
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
import { errorMessage, generate, type Aspect, type GenerateInput, type InkStyle, type Palette } from '@/lib/api';
import { cn } from '@/lib/utils';

import { FileDrop } from './file-drop';
import { clock, estimateSpokenSeconds, wordCount } from './format';
import {
  ASPECTS,
  DEFAULT_VOICE,
  MAX_SOURCE_CHARS,
  MIN_SOURCE_CHARS,
  EXAMPLES,
  INK_STYLES,
  LANGUAGES,
  LOCAL_LANGUAGES,
  PALETTES,
  VOICE_GROUPS,
  findExample,
  isTextualFile,
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

export function CreateForm() {
  const router = useRouter();
  // `/studio?example=gradient-descent` arrives from the library's empty state,
  // so a link can hand the box its starting content.
  const preset = findExample(useSearchParams().get('example'));

  const [mode, setMode] = React.useState<Mode>('text');
  const [text, setText] = React.useState(preset?.text ?? '');
  const [url, setUrl] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [title, setTitle] = React.useState(preset?.title ?? '');

  const [aspect, setAspect] = React.useState<Aspect>('16:9');
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

  const words = wordCount(text);
  const estimate = estimateSpokenSeconds(text);

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
      const input: GenerateInput = { aspect, language, voice, style, palette };
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
              {aspect} · {languageLabel} · {voiceLabel(voice)} ·{' '}
              {INK_STYLES.find((s) => s.value === style)?.label} ·{' '}
              {PALETTES.find((p) => p.value === palette)?.label}
            </p>
          )}
        </div>

        {showOptions ? (
          <Card
            id="create-options"
            className="animate-in fade-in gap-6 duration-brisk ease-out"
          >
            <CardContent className="flex flex-col gap-6">
              <TileGroup
                name="aspect"
                legend="Shape"
                hint="The frame the camera crops to as it tours the canvas."
                value={aspect}
                onValueChange={setAspect}
                options={ASPECTS.map((option) => ({
                  value: option.value,
                  label: option.label,
                  hint: option.hint,
                  visual: <AspectGlyph glyph={option.glyph} />,
                }))}
              />

              <Separator />

              <TileGroup
                name="style"
                legend="Ink"
                hint="How the hand draws: stroke weight, texture, wobble."
                value={style}
                onValueChange={setStyle}
                options={INK_STYLES.map((option) => ({
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
