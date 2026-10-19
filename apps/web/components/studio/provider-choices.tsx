'use client';

import Link from 'next/link';
import {
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
    <div className="flex flex-col gap-4">
      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
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
              ? 'A basic summary of your source. No API charge.'
              : 'Writes the lesson and diagrams with your saved key.'}
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
              ? 'Kokoro, English only. No API charge.'
              : 'Many languages and voices. Pick the voice above.'}
          </LabelHint>
        </div>
        <div className="flex flex-col gap-2">
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
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {cloud
          ? 'The providers you pick receive the source or narration they need and bill your own account. Drawing and encoding always run on the Inkcast server. '
          : 'Everything runs on the Inkcast server. No paid keys are used. '}
        <Link
          href="/settings"
          className="focus-ring rounded-xs font-medium text-foreground underline underline-offset-4"
        >
          Manage API keys
        </Link>
      </p>
    </div>
  );
}
