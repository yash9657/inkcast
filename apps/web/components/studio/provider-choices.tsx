'use client';

import Link from 'next/link';
import {
  Button,
  Label,
  LabelHint,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui';
import type { Capabilities } from '@/lib/api';
import type { ProviderSelection } from '@/lib/provider-selection';

export function ProviderChoices({
  caps,
  value,
  onChange,
}: {
  caps: Capabilities;
  value: ProviderSelection;
  onChange: (value: ProviderSelection) => void;
}) {
  const has = (id: string) => caps.keys.some((key) => key.id === id && key.configured);
  const planners = [
    { id: 'fireworks', label: 'Fireworks', ready: has('fireworks') },
    { id: 'anthropic', label: 'Anthropic', ready: has('anthropic') },
    { id: 'local', label: 'Local · basic summary', ready: true },
  ] as const;
  const speakers = [
    { id: 'elevenlabs', label: 'ElevenLabs', ready: has('elevenlabs') },
    { id: 'local', label: 'Local · Kokoro', ready: true },
  ] as const;
  const cloud = value.planner !== 'local' || value.speech !== 'local' || value.images !== 'local';
  return (
    <section className="flex flex-col gap-4" aria-labelledby="video-providers">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="video-providers" className="text-md font-semibold">
          Providers for this video
        </h2>
        <Button variant="link" size="sm" nativeButton={false} render={<Link href="/settings" />}>
          Manage API keys
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="planning-provider">Lesson and diagrams</Label>
          <Select
            value={value.planner}
            onValueChange={(planner) =>
              onChange({ ...value, planner: planner as ProviderSelection['planner'] })
            }
          >
            <SelectTrigger id="planning-provider">
              <span>{planners.find((p) => p.id === value.planner)?.label}</span>
            </SelectTrigger>
            <SelectContent>
              {planners.map((p) => (
                <SelectItem key={p.id} value={p.id} disabled={!p.ready}>
                  {p.label}
                  {p.ready ? '' : ' · add a key'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <LabelHint>
            {value.planner === 'local'
              ? 'A basic, deterministic summary of your source. No planning API charge.'
              : 'Writes the lesson and composes diagrams using your saved key.'}
          </LabelHint>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="speech-provider">Narration</Label>
          <Select
            value={value.speech}
            onValueChange={(speech) =>
              onChange({ ...value, speech: speech as ProviderSelection['speech'] })
            }
          >
            <SelectTrigger id="speech-provider">
              <span>{speakers.find((p) => p.id === value.speech)?.label}</span>
            </SelectTrigger>
            <SelectContent>
              {speakers.map((p) => (
                <SelectItem key={p.id} value={p.id} disabled={!p.ready}>
                  {p.label}
                  {p.ready ? '' : ' · add a key'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <LabelHint>
            {value.speech === 'local'
              ? 'Kokoro speech in English, processed on the Inkcast server.'
              : 'Multilingual speech with native word timings. Choose the voice in Options.'}
          </LabelHint>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:max-w-sm">
        <Label htmlFor="image-provider">Illustrations</Label>
        <Select
          value={value.images}
          onValueChange={(images) =>
            onChange({ ...value, images: images as ProviderSelection['images'] })
          }
        >
          <SelectTrigger id="image-provider">
            <span>
              {value.images === 'local'
                ? 'Built-in assets'
                : `Generated · ${has('replicate') ? 'Replicate' : 'fal'}`}
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">Built-in assets · no image API charge</SelectItem>
            <SelectItem value="auto" disabled={!has('replicate') && !has('fal')}>
              Generated · your image provider
              {!has('replicate') && !has('fal') ? ' · add a key' : ''}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {cloud
          ? 'Selected providers receive the source, narration or drawing data needed for their stage and bill your provider accounts. Local rendering still runs on the Inkcast server.'
          : 'Planning, speech and artwork run locally on the Inkcast server. No paid provider keys are used.'}
      </p>
    </section>
  );
}
