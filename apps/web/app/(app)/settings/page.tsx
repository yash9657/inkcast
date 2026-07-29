import type { Metadata } from 'next';

import { KeysPanel } from '@/components/settings/keys-panel';

/**
 * `/settings` — the four keys, and nothing else.
 *
 * This is the first page a new user needs and the only page they need again, so
 * it is one column of provider cards with the recommendation stated once at the
 * top. No tabs, no sections for settings that do not exist yet: everything else
 * the studio can be told is a per-render choice and belongs on the create form,
 * where the decision is actually being made.
 *
 * A server component that renders a client panel with **no props**. That is the
 * shape that guarantees the requirement: no key, and nothing derived from a key,
 * is serialised into this document's HTML or into the client bundle. The panel
 * fetches masked status from `/api/keys` at runtime instead.
 */

export const metadata: Metadata = {
  title: 'Keys',
  description: 'Paste the API keys that decide how much Inkcast can teach.',
};

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex max-w-2xl flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Keys</h1>
        <p className="text-md leading-relaxed text-muted-foreground">
          Inkcast runs with none of these: it plans with a local heuristic, speaks with Kokoro on
          this machine, and draws from a built-in icon set, for nothing per minute. Each key below
          replaces one of those with something better. They are listed in the order that matters.
        </p>
      </header>

      <KeysPanel />
    </div>
  );
}
