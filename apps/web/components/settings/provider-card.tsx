'use client';

import * as React from 'react';
import {
  ArrowUpRightIcon,
  AudioLinesIcon,
  BrainIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  EyeIcon,
  EyeOffIcon,
  ImageIcon,
  Loader2Icon,
  ShieldCheckIcon,
  Trash2Icon,
} from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  LabelError,
  LabelHint,
  Separator,
  StatusDot,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import type { KeyState } from '@/lib/api';

import { judgeKeyShape, type ProviderId, type ProviderInfo, type ProviderStage } from './catalog';
import type { Validation } from './client';

/**
 * One provider: what it does, whether it is set, and the four things you can do
 * about that — paste, save, check, remove.
 *
 * ## The raw key's lifetime
 *
 * A pasted key lives in this component's `draft` state and nowhere else. It is
 * sent once, then `draft` is cleared in the same tick the save resolves. It is
 * never put in a ref that outlives the render, never in a URL, never in
 * `localStorage`, and never in a toast — a toast body can be read by anything that
 * screenshots the page, and it outlives the field it came from.
 *
 * The field is `type="password"` with `autoComplete="off"`. The reveal toggle
 * exists because pasting a 100-character credential into a masked box and hoping
 * is worse for accuracy than being able to look at it, and accuracy is the whole
 * problem this page solves.
 */

const STAGE_ICON: Record<ProviderStage, React.ComponentType<{ className?: string }>> = {
  plan: BrainIcon,
  voice: AudioLinesIcon,
  images: ImageIcon,
};

export type ProviderCardProps = {
  provider: ProviderInfo;
  account?: boolean;
  disabled?: boolean;
  state: KeyState | undefined;
  /** Set when this provider's sibling image key is configured. */
  siblingConfigured?: boolean;
  /** True while this card has a request in flight. */
  busy: 'save' | 'validate' | 'delete' | undefined;
  validation: Validation | undefined;
  onSave: (provider: ProviderId, key: string) => void;
  onValidate: (provider: ProviderId, key?: string) => void;
  onDelete: (provider: ProviderId) => void;
};

export function ProviderCard({
  provider,
  account = false,
  disabled = false,
  state,
  siblingConfigured = false,
  busy,
  validation,
  onSave,
  onValidate,
  onDelete,
}: ProviderCardProps) {
  const [draft, setDraft] = React.useState('');
  const [revealed, setRevealed] = React.useState(false);
  const [problem, setProblem] = React.useState<string | undefined>(undefined);

  const configured = state?.configured === true;
  const fromEnv = state?.source === 'env';
  const StageIcon = STAGE_ICON[provider.stage];
  const fieldId = `key-${provider.id}`;
  const hintId = `${fieldId}-hint`;
  const statusId = `${fieldId}-status`;

  // A key that saved successfully clears the box. Watching `updatedAt` rather
  // than the save callback keeps the reset tied to the server confirming it.
  const savedAt = state?.updatedAt;
  const lastSavedAt = React.useRef(savedAt);
  React.useEffect(() => {
    if (savedAt !== lastSavedAt.current) {
      lastSavedAt.current = savedAt;
      setDraft('');
      setRevealed(false);
      setProblem(undefined);
    }
  }, [savedAt]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (disabled) return;
    const key = draft.trim();
    const verdict = judgeKeyShape(provider.id, key);
    if (!verdict.ok) {
      setProblem(verdict.problem);
      return;
    }
    setProblem(undefined);
    onSave(provider.id, key);
  }

  return (
    <Card
      // The one key that changes whether the product teaches gets a visible
      // outline until it is set. Rank 3 providers never do — three cards asking
      // for attention is no hierarchy at all.
      className={cn(
        'gap-5',
        provider.rank === 1 && !configured && 'border-primary/40 bg-primary/4',
      )}
    >
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <StageIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {provider.label}
          {provider.rank === 1 && !configured ? <Badge variant="default">Start here</Badge> : null}
        </CardTitle>
        <CardDescription>
          {provider.role} · {provider.cost}
        </CardDescription>
        <CardAction>
          <StatusPill state={state} />
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {/* ----------------------------------------------- what it changes */}

        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <dt className="text-2xs font-medium uppercase text-muted-foreground">With a key</dt>
            <dd className="text-sm leading-relaxed text-foreground">{provider.unlocks}</dd>
          </div>
          <div className="flex flex-col gap-1.5">
            <dt className="text-2xs font-medium uppercase text-muted-foreground">Without one</dt>
            <dd className="text-sm leading-relaxed text-muted-foreground">{provider.without}</dd>
          </div>
        </dl>

        {provider.alternativeTo && siblingConfigured && !configured ? (
          <LabelHint>
            An image key is already set, so this one is not needed. Whichever of the two is present
            is used; Replicate wins if both are.
          </LabelHint>
        ) : null}

        <Separator />

        {/* ------------------------------------------------ current state */}

        {configured || state?.unreadable ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <code className="tabular rounded-sm bg-muted px-2 py-1 font-mono text-xs text-foreground">
                {state?.mask ?? '••••'}
              </code>
              <span className="text-xs text-muted-foreground">
                {fromEnv ? (
                  <>
                    from the environment, as <span className="font-mono">{state?.envVar}</span> —
                    paste a key below to override it
                  </>
                ) : (
                  <>
                    {state?.source === 'keychain'
                      ? 'in your OS keychain'
                      : account
                        ? 'encrypted for your account'
                        : 'encrypted on this machine'}
                    {savedAt ? ` · ${whenever(savedAt)}` : ''}
                  </>
                )}
                {state?.length ? ` · ${state.length} characters` : ''}
              </span>
            </div>

            {/* Two faults, two remedies. Telling someone to re-paste a key when
                the real problem is an unset passphrase makes them destroy a
                perfectly good entry, so these must not share a sentence. */}
            {state?.unreadable ? (
              <p className="flex items-start gap-1.5 text-xs leading-relaxed text-warning">
                <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {state.locked ? (
                  <>
                    This key is stored but cannot be unsealed, so it is not being used — no vault
                    passphrase is available. Set{' '}
                    <span className="font-mono">INKCAST_VAULT_PASSPHRASE</span> and restart the
                    studio; the key itself is intact.
                  </>
                ) : (
                  <>
                    This key cannot be decrypted, so it cannot be used. Replace it below, or contact
                    the server operator if the problem continues.
                  </>
                )}
              </p>
            ) : null}

            {state?.shadowedByEnv ? (
              <p className="flex items-start gap-1.5 text-xs leading-relaxed text-warning">
                <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />A key is also
                saved here but cannot be read right now, so{' '}
                <span className="font-mono">{state.envVar}</span> from the environment is in use.
                Once the saved key is readable again it takes priority.
              </p>
            ) : null}

            {state?.overridesEnv ? (
              <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                <CircleCheckIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  <span className="font-mono">{state.envVar}</span> is also set in the environment,
                  but the key you saved here takes priority — that variable is ignored.
                </span>
              </p>
            ) : null}
          </div>
        ) : null}

        {/* --------------------------------------------------- paste form */}

        <form onSubmit={submit} className="flex flex-col gap-2">
          <Label htmlFor={fieldId}>
            {configured ? `Replace the ${provider.label} key` : `${provider.label} key`}
          </Label>

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Input
                id={fieldId}
                // `type` flips rather than the value being copied anywhere, so the
                // reveal never creates a second place the key exists.
                type={revealed ? 'text' : 'password'}
                value={draft}
                disabled={disabled}
                maxLength={8192}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                inputMode="text"
                aria-describedby={problem ? `${fieldId}-error` : hintId}
                aria-invalid={problem ? true : undefined}
                placeholder={provider.looksLike.prefix ?? 'Paste the key'}
                onChange={(event) => {
                  setDraft(event.target.value);
                  if (problem) setProblem(undefined);
                }}
                className="pr-10 font-mono"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={revealed ? 'Hide the key' : 'Show the key'}
                aria-pressed={revealed}
                onClick={() => setRevealed((shown) => !shown)}
                className="absolute top-0.5 right-0.5"
              >
                {revealed ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
              </Button>
            </div>

            <Button type="submit" disabled={draft.trim() === '' || disabled}>
              {busy === 'save' ? <Spinner /> : null}
              {busy === 'save' ? 'Saving…' : 'Save'}
            </Button>
          </div>

          {problem ? (
            <LabelError id={`${fieldId}-error`}>{problem}</LabelError>
          ) : (
            <LabelHint id={hintId}>
              {provider.looksLike.describe}. Sent to Inkcast for secure storage and used to call{' '}
              {provider.label} when selected.
            </LabelHint>
          )}
        </form>

        {/* ------------------------------------------------------ actions */}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || (!configured && draft.trim() === '')}
            onClick={() => onValidate(provider.id, draft.trim() === '' ? undefined : draft.trim())}
          >
            {busy === 'validate' ? <Spinner /> : <ShieldCheckIcon aria-hidden />}
            {busy === 'validate' ? 'Checking…' : 'Validate now'}
          </Button>

          {(configured || state?.unreadable) && !fromEnv ? (
            <DeleteButton
              provider={provider}
              disabled={disabled}
              busy={busy === 'delete'}
              onConfirm={onDelete}
            />
          ) : null}
          {!configured && state?.unreadable ? (
            <DeleteButton
              provider={provider}
              disabled={disabled}
              busy={busy === 'delete'}
              onConfirm={onDelete}
            />
          ) : null}

          <Button
            variant="link"
            size="sm"
            nativeButton={false}
            render={<a href={provider.console.href} target="_blank" rel="noreferrer noopener" />}
          >
            Get a key · {provider.console.label}
            <ArrowUpRightIcon aria-hidden />
          </Button>
        </div>

        {/* Validation result. `role="status"` so a screen reader hears the
            verdict without the focus moving. */}
        <p
          id={statusId}
          role="status"
          aria-live="polite"
          className={cn(
            'min-h-0 text-xs leading-relaxed',
            validation === undefined && 'sr-only',
            validation?.status === 'valid' && 'text-success',
            validation?.status === 'invalid' && 'text-destructive',
            validation?.status === 'unknown' && 'text-warning',
          )}
        >
          {validation ? (
            <span className="flex items-start gap-1.5">
              {validation.status === 'valid' ? (
                <CircleCheckIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              ) : (
                <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              )}
              <span>
                {validation.message}
                {validation.detail ? (
                  <span className="text-muted-foreground"> {validation.detail}</span>
                ) : null}
              </span>
            </span>
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------- pieces */

/** Status as a word plus a shape, never as a colour alone. */
function StatusPill({ state }: { state: KeyState | undefined }) {
  if (state?.unreadable) {
    return (
      <Badge variant="warning">
        <StatusDot tone="warning" />
        {state.locked ? 'Needs a passphrase' : 'Cannot be read'}
      </Badge>
    );
  }
  if (state?.configured) {
    return (
      <Badge variant="success">
        <StatusDot tone="success" />
        {state.source === 'env'
          ? 'Set in environment'
          : state.validatedOk === false
            ? 'Needs attention'
            : state.validatedOk
              ? 'Connected'
              : 'Saved · unchecked'}
      </Badge>
    );
  }
  return (
    <Badge variant="neutral">
      <StatusDot tone="neutral" />
      Not set
    </Badge>
  );
}

function DeleteButton({
  provider,
  busy,
  disabled,
  onConfirm,
}: {
  provider: ProviderInfo;
  disabled: boolean;
  busy: boolean;
  onConfirm: (provider: ProviderId) => void;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={<Button type="button" variant="ghost" size="sm" disabled={disabled} />}
      >
        {busy ? <Spinner /> : <Trash2Icon aria-hidden />}
        Remove
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Remove the {provider.label} key?</DialogTitle>
          <DialogDescription>
            The saved key is removed from Inkcast. Queued videos that need it will ask you to add a
            key; running videos may finish using it. This does not revoke the key at{' '}
            {provider.label}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Keep it</DialogClose>
          <DialogClose
            render={<Button variant="destructive" onClick={() => onConfirm(provider.id)} />}
          >
            Remove key
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Spinner() {
  // A system-caused wait, so a CSS spin rather than a spring.
  return <Loader2Icon className="animate-spin" aria-hidden />;
}

/** "3 minutes ago", "yesterday", "12 Mar" — enough to recognise, no more. */
function whenever(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return 'at an unknown time';
  const seconds = Math.round((Date.now() - when.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
