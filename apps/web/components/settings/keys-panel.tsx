'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRightIcon, LockIcon, RefreshCwIcon } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  Separator,
  Skeleton,
  SkeletonText,
  StatusDot,
  toast,
} from '@/components/ui';
import { errorMessage, getCapabilities, type Capabilities, type KeyState } from '@/lib/api';
import { cn } from '@/lib/utils';

import { PROVIDERS, providerInfo, type ProviderId } from './catalog';
import {
  deleteKey,
  listKeys,
  saveKey,
  validateKey,
  type Validation,
  type VaultInfo,
} from './client';
import { ProviderCard } from './provider-card';

/**
 * The keys screen.
 *
 * ## Why the data is fetched in the browser
 *
 * The page could be a server component that reads the vault directly, and it
 * deliberately is not. Server-rendering the list would put every mask into the
 * HTML document — masks are not secrets, but the *habit* is the problem: the next
 * field someone adds to that payload is the one that matters. Fetching over
 * `/api/keys` means the page's HTML contains no credential-shaped data at all,
 * and there is one code path that decides what a client may know.
 *
 * ## Two requests, not one
 *
 * `/api/keys` answers "what is configured". `/api/providers` answers "what will
 * therefore happen to my next render", which is the question the user actually
 * has. Showing the second is what makes this page feel like a setting rather than
 * a form.
 */

type Busy = { provider: ProviderId; action: 'save' | 'validate' | 'delete' };

export function KeysPanel() {
  const [keys, setKeys] = React.useState<KeyState[] | undefined>(undefined);
  const [vault, setVault] = React.useState<VaultInfo | undefined>(undefined);
  const [caps, setCaps] = React.useState<Capabilities | undefined>(undefined);
  const [loadError, setLoadError] = React.useState<string | undefined>(undefined);
  const [busy, setBusy] = React.useState<Busy | undefined>(undefined);
  const [validations, setValidations] = React.useState<Partial<Record<ProviderId, Validation>>>({});

  const refresh = React.useCallback(async (signal?: AbortSignal) => {
    // The two are independent, and a pipeline that cannot be loaded must not
    // blank the key list — that is the half of the page you came here to use.
    const [snapshot, capabilities] = await Promise.allSettled([
      listKeys(signal),
      getCapabilities(signal),
    ]);
    if (signal?.aborted) return;

    if (snapshot.status === 'fulfilled') {
      setKeys(snapshot.value.keys);
      setVault(snapshot.value.vault);
      setLoadError(undefined);
    } else {
      setLoadError(errorMessage(snapshot.reason));
    }
    if (capabilities.status === 'fulfilled') setCaps(capabilities.value);
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  /* ------------------------------------------------------------- mutations */

  async function run(
    provider: ProviderId,
    action: Busy['action'],
    work: () => Promise<{ message: string; description?: string; failed?: boolean }>,
  ) {
    setBusy({ provider, action });
    try {
      const outcome = await work();
      // The raw key is never part of a toast body — see the note in
      // `provider-card.tsx`. These are all descriptions of state.
      if (outcome.failed) {
        toast.error(
          outcome.message,
          outcome.description ? { description: outcome.description } : {},
        );
      } else {
        toast.success(
          outcome.message,
          outcome.description ? { description: outcome.description } : {},
        );
      }
      await refresh();
    } catch (err) {
      toast.error('That did not work', { description: errorMessage(err) });
    } finally {
      setBusy(undefined);
    }
  }

  function onSave(provider: ProviderId, key: string) {
    void run(provider, 'save', async () => {
      const outcome = await saveKey(provider, key);
      // Saving and then immediately checking is one intent, so it is one action.
      // A key that saves and silently does not work is the failure this page
      // exists to prevent.
      const check = await validateKey(provider).catch(() => undefined);
      if (check) setValidations((current) => ({ ...current, [provider]: check }));
      const label = providerInfo(provider).label;
      if (check?.status === 'invalid') {
        return {
          failed: true,
          message: `${label} rejected that key`,
          description: 'It is saved, but it will not work. Copy it again from the dashboard.',
        };
      }
      return {
        message: `${label} key saved`,
        description: outcome.warning ?? outcome.note ?? check?.message,
      };
    });
  }

  function onValidate(provider: ProviderId, key?: string) {
    void run(provider, 'validate', async () => {
      const result = await validateKey(provider, key);
      setValidations((current) => ({ ...current, [provider]: result }));
      return {
        failed: result.status === 'invalid',
        message:
          result.status === 'valid'
            ? `${providerInfo(provider).label} accepted the key`
            : result.status === 'invalid'
              ? `${providerInfo(provider).label} rejected the key`
              : 'Could not check the key',
        description: result.detail ?? result.message,
      };
    });
  }

  function onDelete(provider: ProviderId) {
    void run(provider, 'delete', async () => {
      const outcome = await deleteKey(provider);
      setValidations((current) => {
        const next = { ...current };
        delete next[provider];
        return next;
      });
      return {
        message: outcome.removed
          ? `${providerInfo(provider).label} key removed`
          : `Nothing was saved for ${providerInfo(provider).label}`,
        description: outcome.note,
      };
    });
  }

  /* ---------------------------------------------------------------- render */

  const loading = keys === undefined && loadError === undefined;
  const byId = new Map((keys ?? []).map((key) => [key.id, key]));
  const anthropic = byId.get('anthropic');
  const imagesConfigured = new Set(
    (keys ?? []).filter((key) => key.configured).map((key) => key.id),
  );

  return (
    <div className="flex flex-col gap-8">
      <EffectivePipeline caps={caps} loading={loading} />

      {anthropic && !anthropic.configured ? <StartHere /> : null}

      {loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm font-medium text-destructive" role="alert">
              Could not read the key status: {loadError}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Nothing is broken by this — the studio runs its local pipeline whether or not this
              page can load. Try again, and if it keeps failing the studio server is not responding.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => void refresh()}
            >
              <RefreshCwIcon aria-hidden />
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-4" aria-hidden>
          {PROVIDERS.map((provider) => (
            <Card key={provider.id} className="gap-4">
              <CardContent className="flex flex-col gap-4">
                <Skeleton className="h-5 w-32" />
                <SkeletonText lines={2} />
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {PROVIDERS.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              state={byId.get(provider.id)}
              siblingConfigured={
                provider.alternativeTo ? imagesConfigured.has(provider.alternativeTo) : false
              }
              busy={busy?.provider === provider.id ? busy.action : undefined}
              validation={validations[provider.id]}
              onSave={onSave}
              onValidate={onValidate}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      <VaultNote vault={vault} />
    </div>
  );
}

/* ------------------------------------------------------- what happens next */

/**
 * The consequence panel: which provider each stage will use on the next render.
 *
 * Read from the pipeline's own decision function rather than inferred from the
 * key list, so it cannot claim a capability the stages do not actually have.
 */
function EffectivePipeline({
  caps,
  loading,
}: {
  caps: Capabilities | undefined;
  loading: boolean;
}) {
  const stages = caps
    ? ([
        { label: 'Plan', chosen: caps.planner },
        { label: 'Voice', chosen: caps.voice },
        { label: 'Art', chosen: caps.images },
      ] as const)
    : [];

  return (
    <Card className="gap-4">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">Your next render will use</h2>
          {caps ? (
            <Badge variant={caps.local ? 'neutral' : 'default'}>
              {caps.local ? 'Nothing leaves this machine' : 'Some stages call out'}
            </Badge>
          ) : null}
        </div>

        {loading || !caps ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-3">
              {stages.map((stage) => (
                <div
                  key={stage.label}
                  className="flex min-w-0 flex-col gap-1 rounded-lg bg-muted px-3 py-2"
                >
                  <dt className="text-2xs font-medium uppercase text-muted-foreground">
                    {stage.label}
                  </dt>
                  <dd className="flex items-center gap-1.5 truncate font-mono text-sm text-foreground">
                    <StatusDot tone={stage.chosen.cloud ? 'primary' : 'success'} />
                    {stage.chosen.name}
                  </dd>
                  <dd className="text-xs leading-snug text-muted-foreground">{stage.chosen.why}</dd>
                </div>
              ))}
            </dl>

            {caps.warnings.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {caps.warnings.map((warning) => (
                  <li
                    key={warning}
                    className="flex items-start gap-2 text-xs leading-relaxed text-warning"
                  >
                    <span
                      aria-hidden
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning"
                    />
                    {warning}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs leading-relaxed text-success">
                Every stage is on its best available path.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The one piece of advice this page exists to give. */
function StartHere() {
  return (
    <Card className={cn('gap-3 border-primary/40 bg-primary/6')}>
      <CardContent className="flex flex-col gap-3">
        <p className="text-md leading-relaxed text-foreground">
          If you add one key, add the Anthropic one. It is the difference between a video that
          teaches an idea and a video that reads your document aloud — the planner writes a hook, an
          everyday anchor, one step at a time with a reason for each, and a worked example with real
          numbers. Nothing else on this page changes what the viewer learns.
        </p>
        {/* Outline, not `default`. The page's one primary action is Save on the
            card below — this is the errand you run first, not the thing you came
            here to do, and two primaries would make neither one primary. */}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          render={
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer noopener"
            />
          }
        >
          Get an Anthropic key
          <ArrowRightIcon aria-hidden />
        </Button>
      </CardContent>
    </Card>
  );
}

/** Where the keys live and what protects them. Stated plainly, including the limits. */
function VaultNote({ vault }: { vault: VaultInfo | undefined }) {
  return (
    <>
      <Separator />
      <div className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <LockIcon className="size-4 text-muted-foreground" aria-hidden />
          Where these are kept
        </h2>
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          A saved key is sealed with {vault?.cipher ?? 'AES-256-GCM'} and written to{' '}
          <span className="font-mono text-foreground">{vault?.path ?? '.inkcast/keys.json'}</span>,
          owner-readable only, in a directory git already ignores.{' '}
          {vault?.kdf === 'passphrase' ? (
            <>
              It is unsealed with a key derived from{' '}
              <span className="font-mono">INKCAST_VAULT_SECRET</span>, so the file on disk is
              useless without that passphrase.
            </>
          ) : (
            <>
              It is unsealed with <span className="font-mono">.inkcast/vault.key</span>, which sits
              beside it — so this protects a key from a backup, a synced folder or a stray{' '}
              <span className="font-mono">grep</span>, not from a program already running as you.
              Set <span className="font-mono">INKCAST_VAULT_SECRET</span> to require a passphrase
              instead.
            </>
          )}
        </p>
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          A key set in the environment always wins over a saved one, so{' '}
          <span className="font-mono">.env</span> and your shell keep working exactly as they did.
          Keys are never sent anywhere but the provider they belong to, and never returned to this
          page — everything above is a preview of the first six and last four characters.
        </p>
        <p className="text-xs text-muted-foreground">
          <Link
            href="/studio"
            className="focus-ring rounded-xs text-primary underline-offset-4 outline-none hover:underline"
          >
            Back to the studio
          </Link>
        </p>
      </div>
    </>
  );
}
