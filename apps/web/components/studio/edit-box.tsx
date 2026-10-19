'use client';

import * as React from 'react';
import { Button, Chip, Kbd, Label, Textarea, toast } from '@/components/ui';
import { editProject, errorMessage } from '@/lib/api';
import type { Storyboard } from '@inkcast/core';

/**
 * Plain-English editing, free and central.
 *
 * The IR is the whole product: an edit is a patch to `storyboard.json` and a
 * re-render is a pure function of it. So this is a text box, not a paid
 * "frame-by-frame prompt editor" — and the suggestions are generated from the
 * storyboard in front of you, so they name real scenes and real entities.
 */

export type EditBoxProps = {
  projectId: string;
  storyboard: Storyboard;
  onEdited: (storyboard: Storyboard) => void;
  disabled?: boolean;
};

/**
 * Asset ids are machine names (`underlay-two-wide-views-the-c3ae651e`): a slug of
 * the prompt plus a hash. Only one that reads as words is worth suggesting.
 */
function readableAsset(id: string): string | undefined {
  if (/(^|-)underlay(-|$)/.test(id) || /-[0-9a-f]{6,}$/.test(id)) return undefined;
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words.split(' ').length <= 4 ? words : undefined;
}

function suggestionsFor(sb: Storyboard): string[] {
  const out: string[] = [];
  const sceneNumber = Math.min(3, sb.scenes.length);
  if (sceneNumber > 0) out.push(`Make scene ${sceneNumber} slower`);
  const asset = sb.assets
    .filter((a) => a.kind !== 'diagram')
    .map((a) => readableAsset(a.id))
    .find(Boolean);
  if (asset) out.push(`Redraw the ${asset}`);
  out.push(sb.meta.palette === 'color' ? 'Switch to black and white' : 'Use colour');
  out.push(sb.meta.language === 'en' ? 'Narrate it in Spanish' : 'Narrate it in English');
  if (sb.scenes.length > 3) out.push('Drop the last scene');
  return out.slice(0, 4);
}

export function EditBox({ projectId, storyboard, onEdited, disabled = false }: EditBoxProps) {
  const [instruction, setInstruction] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const busy = submitting || disabled;

  async function submit() {
    const trimmed = instruction.trim();
    if (!trimmed || busy) return;
    setSubmitting(true);
    try {
      const next = await editProject(projectId, trimmed);
      onEdited(next);
      setInstruction('');
      toast.success('Storyboard updated', {
        description: 'Re-render to put the change in the video.',
      });
    } catch (err) {
      toast.error('Could not apply that edit', { description: errorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby="edit-heading"
      className="rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="edit-heading" className="font-sans text-base font-semibold">
          Change something
        </h2>
        <p className="text-xs text-muted-foreground">
          Describe it in plain words, then render again.
        </p>
      </div>

      <Label htmlFor="edit-instruction" className="sr-only">
        What should change?
      </Label>
      <Textarea
        id="edit-instruction"
        ref={inputRef}
        rows={2}
        value={instruction}
        disabled={busy}
        placeholder="e.g. Make scene 3 slower"
        onChange={(event) => setInstruction(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void submit();
          }
        }}
        className="mt-3"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {suggestionsFor(storyboard).map((suggestion) => (
          <Chip
            key={suggestion}
            on="card"
            disabled={busy}
            onClick={() => {
              setInstruction(suggestion);
              inputRef.current?.focus();
            }}
          >
            {suggestion}
          </Chip>
        ))}
        <div className="ml-auto flex items-center gap-3 pt-1 max-sm:w-full max-sm:justify-end">
          <span className="hidden items-center gap-1 text-2xs text-muted-foreground sm:flex">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
          </span>
          <Button
            disabled={busy || instruction.trim().length === 0}
            onClick={() => void submit()}
            className="max-sm:w-full"
          >
            {submitting ? 'Applying…' : 'Apply change'}
          </Button>
        </div>
      </div>
    </section>
  );
}
