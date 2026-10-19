'use client';

import * as React from 'react';
import { ArrowUpRightIcon, ChevronDownIcon, RefreshCwIcon } from 'lucide-react';

import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  Skeleton,
  SkeletonText,
  StatusDot,
  toast,
} from '@/components/ui';
import { errorMessage, getCapabilities, type Capabilities, type KeyState } from '@/lib/api';
import { cn } from '@/lib/utils';

import { isProviderId, PROVIDERS, providerInfo, type ProviderId } from './catalog';
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
  const [showOptional, setShowOptional] = React.useState(false);
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
    <div className="flex flex-col gap-10">
      <EffectivePipeline caps={caps} loading={loading} />

      {keys && !plannerConfigured ? <StartHere /> : null}

      {loadError ? (
        <Callout
          tone="destructive"
          role="alert"
          title={`Could not read the key status: ${loadError}`}
          action={
            <Button variant="secondary" size="sm" onClick={() => void refresh()}>
              <RefreshCwIcon aria-hidden />
              Try again
            </Button>
          }
        >
          Check your connection and sign-in, then try again.
        </Callout>
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
        <section aria-labelledby="providers-heading" className="flex flex-col gap-4">
          <h2 id="providers-heading" className="font-sans text-lg font-semibold tracking-tight">
            Providers
          </h2>
          {['fireworks', 'elevenlabs'].map((id) => renderProvider(providerInfo(id as ProviderId)))}

          <div className="mt-2 flex flex-col gap-4">
            <button
              type="button"
              aria-expanded={showOptional}
              aria-controls="optional-providers"
              onClick={() => setShowOptional((open) => !open)}
              className="focus-ring group flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4 text-left transition-colors hover:border-input"
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">Optional providers</span>
                <span className="text-sm text-muted-foreground">
                  Anthropic as another planner; Replicate or fal for generated illustrations.
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                <span className="max-sm:hidden">{showOptional ? 'Hide' : 'Show'}</span>
                <ChevronDownIcon
                  aria-hidden
                  className={cn(
                    'size-4 transition-transform duration-brisk',
                    showOptional && 'rotate-180',
                  )}
                />
              </span>
            </button>
            <div id="optional-providers" hidden={!showOptional} className="flex flex-col gap-4">
              {PROVIDERS.filter(
                (provider) => !['fireworks', 'elevenlabs'].includes(provider.id),
              ).map(renderProvider)}
            </div>
          </div>
        </section>
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
    <section aria-labelledby="defaults-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="defaults-heading" className="font-sans text-lg font-semibold tracking-tight">
          Defaults for new videos
        </h2>
        {caps ? (
          <Badge variant="neutral">
            {caps.local ? 'Everything runs locally' : 'Uses your providers'}
          </Badge>
        ) : null}
      </div>

      {loading ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : !caps ? (
        <p className="text-sm text-muted-foreground">
          Provider status is unavailable. Retry loading your keys below.
        </p>
      ) : (
        <>
          <dl className="grid overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-3">
            {stages.map((stage) => (
              <div
                key={stage.label}
                className="flex min-w-0 flex-col gap-1 border-border-subtle px-4 py-3.5 not-last:border-b sm:not-last:border-r sm:not-last:border-b-0"
              >
                <dt className="eyebrow">{stage.label}</dt>
                <dd className="flex items-center gap-2 truncate text-base font-medium text-foreground">
                  <StatusDot tone={stage.chosen.cloud ? 'primary' : 'success'} />
                  {displayName(stage.chosen.name)}
                </dd>
                <dd className="text-xs leading-snug text-muted-foreground">{stage.description}</dd>
              </div>
            ))}
          </dl>

          {caps.warnings.length > 0 ? (
            <Callout tone="warning">
              <ul className="flex flex-col gap-1">
                {caps.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Callout>
          ) : (
            <p className="text-sm text-muted-foreground">
              You can pick different providers for each video when you create it.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** The one piece of advice this page exists to give. */
function StartHere() {
  return (
    <Callout
      title="Want better lessons? Start with Fireworks."
      action={
        // Secondary, not `default`. The page's one primary action is Save on the
        // card below — this is the errand you run first, not the thing you came
        // here to do, and two primaries would make neither one primary.
        <Button
          variant="secondary"
          size="sm"
          nativeButton={false}
          render={
            <a
              href="https://app.fireworks.ai/settings/users/api-keys"
              target="_blank"
              rel="noreferrer noopener"
            />
          }
        >
          Get a key
          <ArrowUpRightIcon aria-hidden />
        </Button>
      }
    >
      It writes the lessons and diagrams. Add ElevenLabs for more voices; an image provider is
      optional.
    </Callout>
  );
}

/** Where the keys live and what protects them. Stated plainly, including the limits. */
function VaultNote({ vault }: { vault: VaultInfo | undefined }) {
  return (
    <Callout title="Where your keys are kept">
      <div className="flex flex-col gap-2">
        {!vault ? (
          <p>Storage details will appear when key status loads.</p>
        ) : vault.scope === 'account' ? (
          <p className="leading-relaxed">
            {vault.why} Removing a key stops new jobs from using it. A job already running may
            finish with the key it loaded; revoke the key at the provider to stop all use.
          </p>
        ) : vault.backend === 'vault' ? (
          <p className="leading-relaxed">
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
          <p className="leading-relaxed">
            A saved key goes into your{' '}
            <span className="font-mono text-foreground">macOS login keychain</span> — no Inkcast
            file on disk contains it, so there is nothing here for a backup, a synced folder or a
            stray <span className="font-mono">grep</span> to pick up. It does not protect a key from
            a program already running as you; that is the same trust boundary{' '}
            <span className="font-mono">.env</span> has.
          </p>
        )}
        {vault && vault.scope !== 'account' ? (
          <p className="leading-relaxed">
            Saved keys take priority over environment keys. Only the selected providers receive
            credentials and the source, narration or drawing data needed for that stage. Keys are
            sent to Inkcast for storage and are never returned in full to this page.
          </p>
        ) : null}
        {vault?.legacyPath ? (
          <p className="leading-relaxed">
            An older studio vault is still at{' '}
            <span className="font-mono text-foreground">{vault.legacyPath}</span>. Nothing reads it
            any more — it was sealed with different material — so any key saved only there needs
            pasting again above. Delete the file once you have.
          </p>
        ) : null}
      </div>
    </Callout>
  );
}

/** Brand names keep their own casing (ElevenLabs, fal); local engines get a capital. */
function displayName(name: string): string {
  if (isProviderId(name)) return providerInfo(name).label;
  return name.charAt(0).toUpperCase() + name.slice(1);
}
