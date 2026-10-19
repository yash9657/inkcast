'use client';

import * as React from 'react';
import { CheckIcon, LinkIcon, Trash2Icon } from 'lucide-react';

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from '@/components/ui';
import { deleteProject, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * The two actions that appear on both the result screen and the library card,
 * written once: copy a public link, and delete for good.
 *
 * The delete control owns its own dialog rather than exposing a trigger, so the
 * confirmation copy can never drift between the two places it is used.
 */

export function CopyLinkButton({
  projectId,
  variant = 'secondary',
  size = 'default',
  label = 'Copy link',
}: {
  projectId: string;
  variant?: 'outline' | 'ghost' | 'secondary';
  size?: 'xs' | 'sm' | 'default';
  label?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      variant={variant}
      size={size}
      onClick={async () => {
        const url = `${window.location.origin}/share/${projectId}`;
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          toast.success('Share link copied', { description: url });
        } catch {
          // Clipboard access can be refused (insecure origin, or permissions).
          toast.error('Could not reach the clipboard', { description: url });
        }
      }}
    >
      {copied ? <CheckIcon aria-hidden /> : <LinkIcon aria-hidden />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

export function DeleteProjectButton({
  projectId,
  title,
  onDeleted,
  className,
}: {
  projectId: string;
  title: string;
  /** Called once the server confirms the delete. */
  onDeleted: () => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${title}`}
        onClick={() => setOpen(true)}
        className={cn(
          'shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
          className,
        )}
      >
        <Trash2Icon aria-hidden />
      </Button>
      <DeleteProjectDialog
        open={open}
        onOpenChange={setOpen}
        projectId={projectId}
        title={title}
        onDeleted={onDeleted}
      />
    </>
  );
}

/**
 * The confirmation itself, controlled, so a menu item can open it as well as the
 * icon button. One dialog, one copy, wherever delete is offered.
 */
export function DeleteProjectDialog({
  open,
  onOpenChange,
  projectId,
  title,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  title: string;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete “{title}”?</DialogTitle>
          <DialogDescription>
            This removes the video, its storyboard, narration and frames. It can’t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" disabled={deleting} />}>Keep it</DialogClose>
          <Button
            variant="destructive"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              try {
                await deleteProject(projectId);
                onOpenChange(false);
                onDeleted();
                toast.success('Project deleted', { description: title });
              } catch (err) {
                toast.error('Could not delete the project', { description: errorMessage(err) });
              } finally {
                setDeleting(false);
              }
            }}
          >
            {deleting ? 'Deleting…' : 'Delete video'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
