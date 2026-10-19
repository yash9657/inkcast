'use client';

import * as React from 'react';
import { FileTextIcon, UploadIcon, XIcon } from 'lucide-react';

import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

import { fileSize } from './format';
import {
  ACCEPTED_EXTENSIONS,
  ACCEPT_ATTRIBUTE,
  MAX_UPLOAD_BYTES,
  extensionOf,
  isAcceptedFile,
} from './options';

/**
 * The drop target.
 *
 * Native drag events plus a hidden `<input type="file">`, with the whole zone as
 * a real `<button>` — so Enter or Space opens the picker and the control is
 * reachable without a pointer. No drag-and-drop library: the browser API is
 * four handlers, and a dependency here would be carrying 30 kB to avoid them.
 */

export type FileDropProps = {
  file: File | null;
  onFileChange: (file: File | null) => void;
  /** Called with a human-readable reason when a dropped file is rejected. */
  onReject: (reason: string) => void;
  disabled?: boolean;
};

export function FileDrop({ file, onFileChange, onReject, disabled = false }: FileDropProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const dragDepth = React.useRef(0);

  const accept = React.useCallback(
    (candidate: File | undefined) => {
      if (!candidate) return;
      if (!isAcceptedFile(candidate.name)) {
        onReject(
          `${extensionOf(candidate.name) || 'That file type'} is not one we can read. Use ${ACCEPTED_EXTENSIONS.join(', ')}.`,
        );
        return;
      }
      if (candidate.size > MAX_UPLOAD_BYTES) {
        onReject(`${fileSize(candidate.size)} is over the ${fileSize(MAX_UPLOAD_BYTES)} limit.`);
        return;
      }
      if (candidate.size === 0) {
        onReject('That file is empty.');
        return;
      }
      onFileChange(candidate);
    },
    [onFileChange, onReject],
  );

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (disabled) return;
    accept(event.dataTransfer.files[0]);
  };

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted p-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-card text-foreground shadow-card">
          <FileTextIcon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium text-foreground">{file.name}</p>
          <p className="tabular text-xs text-muted-foreground">
            {fileSize(file.size)} · {extensionOf(file.name).replace('.', '').toUpperCase()}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${file.name}`}
          disabled={disabled}
          onClick={() => {
            onFileChange(null);
            if (inputRef.current) inputRef.current.value = '';
          }}
        >
          <XIcon aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => accept(event.target.files?.[0])}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          if (!disabled) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          'focus-ring group relative flex w-full flex-col items-center gap-2 overflow-hidden outline-none',
          'rounded-lg border-2 border-dashed border-border bg-background px-6 py-12 text-center',
          'transition-[background-color,border-color] duration-fast ease-out',
          'hover:border-input hover:bg-accent/30',
          'disabled:pointer-events-none disabled:opacity-50',
          dragging && 'border-foreground bg-accent-soft',
        )}
      >
        <span
          className={cn(
            'relative mb-1 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground',
            'transition-colors duration-fast ease-out',
            'group-hover:text-foreground',
            dragging && 'bg-highlighter text-highlighter-foreground',
          )}
        >
          <UploadIcon className="size-4" aria-hidden />
        </span>

        <span className="relative text-base font-medium text-foreground">
          {dragging ? 'Drop it here' : 'Drop a file here, or choose one'}
        </span>
        <span className="relative text-sm text-muted-foreground">
          PDF, Word, Markdown or text · up to {fileSize(MAX_UPLOAD_BYTES)}
        </span>
        <span className="relative text-xs text-muted-foreground">
          The file is uploaded to Inkcast to be read.
        </span>
      </button>
    </>
  );
}
