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
  const pending = React.useRef(false);
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
      setKeys(undefined);
      setVault(undefined);
      setCaps(undefined);
      setLoadError(errorMessage(snapshot.reason));
    }
    setCaps(
      snapshot.status === 'fulfilled' && capabilities.status === 'fulfilled'
        ? capabilities.value
        : undefined,
    );
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
    if (pending.current) return;
    pending.current = true;
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
      pending.current = false;
      setBusy(undefined);
    }
  }

  function onSave(provider: ProviderId, key: string) {
    void run(provider, 'save', async () => {
      const outcome = await saveKey(provider, key);
      setKeys((current) =>
        (current ?? []).map((item) => (item.id === provider ? outcome.key : item)),
      );
      setValidations((current) => ({ ...current, [provider]: undefined }));
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
  const plannerConfigured = byId.get('fireworks')?.configured || byId.get('anthropic')?.configured;
  const imagesConfigured = new Set(
    (keys ?? []).filter((key) => key.configured).map((key) => key.id),
  );

  function renderProvider(provider: (typeof PROVIDERS)[number]) {
    return (
      <ProviderCard
        key={provider.id}
        provider={provider}
        account={vault?.scope === 'account'}
        disabled={busy !== undefined}
        state={byId.get(provider.id)}
        siblingConfigured={
          provider.alternativeTo ? imagesConfigured.has(provider.alternativeTo) : false
        }
        busy={busy?.provider === provider.id ? busy.action : undefined}
        validation={
          validations[provider.id] ??
          (byId.get(provider.id)?.validatedAt
            ? {
                status: byId.get(provider.id)?.validatedOk ? 'valid' : 'invalid',
                message: `Last check: ${byId.get(provider.id)?.validatedOk ? 'accepted' : 'not accepted'}. Check again if you have changed the key’s permissions.`,
              }
            : undefined)
        }
        onSave={onSave}
        onValidate={onValidate}
        onDelete={onDelete}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <EffectivePipeline caps={caps} loading={loading} />

      {keys && !plannerConfigured ? <StartHere /> : null}

      {loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm font-medium text-destructive" role="alert">
              Could not read the key status: {loadError}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Your keys could not be loaded. Check your connection and sign-in, then try again.
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
      ) : keys ? (
        <div className="flex flex-col gap-4">
          {['fireworks', 'elevenlabs'].map((id) => renderProvider(providerInfo(id as ProviderId)))}
          <details className="group mt-2">
            <summary className="cursor-pointer rounded-md py-3 text-md font-medium focus-visible:outline-2 focus-visible:outline-ring">
              Optional providers · Anthropic, Replicate and fal
            </summary>
            <p className="mb-4 text-sm text-muted-foreground">
              Choose another planner or add generated illustrations. These keys are not needed for
              Fireworks and ElevenLabs.
            </p>
            <div className="flex flex-col gap-4">
              {PROVIDERS.filter(
                (provider) => !['fireworks', 'elevenlabs'].includes(provider.id),
              ).map(renderProvider)}
            </div>
          </details>
        </div>
      ) : null}

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
        {
          label: 'Plan',
          chosen: caps.planner,
          description: caps.planner.cloud
            ? 'Authors lessons and diagrams.'
            : 'Basic document summary.',
        },
        {
          label: 'Voice',
          chosen: caps.voice,
          description: caps.voice.cloud
            ? 'Narration with word timings.'
            : 'Kokoro narration in English.',
        },
        {
          label: 'Art',
          chosen: caps.images,
          description: caps.images.cloud
            ? 'Generated illustrations when requested.'
            : 'Built-in assets and diagrams.',
        },
      ] as const)
    : [];

  return (
    <Card className="gap-4">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">Default providers for new videos</h2>
          {caps ? (
            <Badge variant={caps.local ? 'neutral' : 'default'}>
              {caps.local ? 'Local processing' : 'Calls your providers'}
            </Badge>
          ) : null}
        </div>

        {loading ? (
          <Skeleton className="h-10 w-full" />
        ) : !caps ? (
          <p className="text-sm text-muted-foreground">
            Provider status is unavailable. Retry loading your keys below.
          </p>
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
                  <dd className="text-xs leading-snug text-muted-foreground">
                    {stage.description}
                  </dd>
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
                You can change these choices for each video in the studio.
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
          Start with Fireworks for authored lessons and diagrams. Add ElevenLabs for narration with
          word timings. An image provider is optional for generated illustrations.
        </p>
        {/* Outline, not `default`. The page's one primary action is Save on the
            card below — this is the errand you run first, not the thing you came
            here to do, and two primaries would make neither one primary. */}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          nativeButton={false}
          render={
            <a
              href="https://app.fireworks.ai/settings/users/api-keys"
              target="_blank"
              rel="noreferrer noopener"
            />
          }
        >
          Get a Fireworks key
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
        {!vault ? (
          <p className="text-sm text-muted-foreground">
            Storage details will appear when key status loads.
          </p>
        ) : vault.scope === 'account' ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {vault.why} Removing a key stops new jobs from using it. A job already running may
            finish with the key it loaded; revoke the key at the provider to stop all use.
          </p>
        ) : vault.backend === 'vault' ? (
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            A saved key is sealed with {vault.cipher ?? 'AES-256-GCM'} and written to{' '}
            <span className="font-mono text-foreground">{vault.path}</span>, owner-readable only, in
            a directory git already ignores. The sealing key is derived from{' '}
            <span className="font-mono">INKCAST_VAULT_PASSPHRASE</span>
            {vault.kdf
              ? ` with ${vault.kdf.name} (N=${vault.kdf.N}, r=${vault.kdf.r}, p=${vault.kdf.p})`
              : ''}
            , so the file on disk is useless without that passphrase.{' '}
            {vault.ready
              ? null
              : 'No passphrase is available right now, so a stored key cannot be unsealed and every stage is running locally.'}
          </p>
        ) : (
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            A saved key goes into your{' '}
            <span className="font-mono text-foreground">macOS login keychain</span> — no Inkcast
            file on disk contains it, so there is nothing here for a backup, a synced folder or a
            stray <span className="font-mono">grep</span> to pick up. It does not protect a key from
            a program already running as you; that is the same trust boundary{' '}
            <span className="font-mono">.env</span> has.
          </p>
        )}
        {vault && vault.scope !== 'account' ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Saved keys take priority over environment keys. Only the selected providers receive
            credentials and the source, narration or drawing data needed for that stage. Keys are
            sent to Inkcast for storage and are never returned in full to this page.
          </p>
        ) : null}
        {vault?.legacyPath ? (
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            An older studio vault is still at{' '}
            <span className="font-mono text-foreground">{vault.legacyPath}</span>. Nothing reads it
            any more — it was sealed with different material — so any key saved only there needs
            pasting again above. Delete the file once you have.
          </p>
        ) : null}
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
