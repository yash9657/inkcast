'use client';

import * as React from 'react';
import { WandSparklesIcon } from 'lucide-react';

import { Button, Card, CardContent, Kbd, Label, LabelHint, Textarea, toast } from '@/components/ui';
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

function suggestionsFor(sb: Storyboard): string[] {
  const out: string[] = [];
  const sceneNumber = Math.min(3, sb.scenes.length);
  if (sceneNumber > 0) out.push(`make scene ${sceneNumber} slower`);
  const asset = sb.assets.find((a) => a.kind !== 'diagram');
  if (asset) out.push(`redraw the ${asset.id.replace(/-/g, ' ')}`);
  out.push(sb.meta.palette === 'color' ? 'switch to mono' : 'use colour');
  out.push(sb.meta.language === 'en' ? 'narrate it in Spanish' : 'narrate it in English');
  if (sb.scenes.length > 3) out.push('drop the last scene');
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
    <Card className="gap-3 py-4">
      <CardContent className="flex flex-col gap-3 px-4">
        <Label htmlFor="edit-instruction">Refine your video</Label>

        <Textarea
          id="edit-instruction"
          ref={inputRef}
          rows={2}
          value={instruction}
          disabled={busy}
          placeholder="make scene 3 slower · redraw the rover · switch to mono"
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void submit();
            }
          }}
          className="text-md"
        />

        <div className="flex flex-wrap gap-1.5">
          {suggestionsFor(storyboard).map((suggestion) => (
            <Button
              key={suggestion}
              type="button"
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => {
                setInstruction(suggestion);
                inputRef.current?.focus();
              }}
            >
              {suggestion}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <LabelHint className="max-w-sm">
            Adjust the pacing, style, language or scene order. Apply your changes, then re-render to
            update the video.
          </LabelHint>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1 text-2xs text-muted-foreground sm:flex">
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd>
            </span>
            <Button
              size="sm"
              disabled={busy || instruction.trim().length === 0}
              onClick={() => void submit()}
            >
              <WandSparklesIcon aria-hidden />
              {submitting ? 'Applying…' : 'Apply changes'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
