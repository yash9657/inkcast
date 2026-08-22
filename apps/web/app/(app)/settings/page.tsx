import type { Metadata } from 'next';

import { KeysPanel } from '@/components/settings/keys-panel';
import { isHosted } from '@/app/api/_lib/http';

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
 *
 * ## Why the whole panel disappears on the hosted deployment
 *
 * Plan item D5: hide the BYOK UI when `INKCAST_HOSTED=1`. Three reasons, in
 * ascending order of how much they matter.
 *
 * The panel would be *wrong*. It reads and writes the keyvault on the machine
 * serving the page, which on a shared deployment is the operator's server, not
 * the visitor's laptop. `hydrateEnv()` refuses to overwrite a key the real
 * environment already supplied (`packages/keyvault/src/hydrate.ts:78`), and the
 * hosted deployment supplies all of them as environment variables — so a visitor
 * who pasted a key would see it accepted, stored, and then silently ignored by
 * every stage. A control that reports success and changes nothing is worse than
 * no control.
 *
 * It would be *misleading*. The copy below explains that each key upgrades one
 * stage, which is true of the local studio, where the person pasting the key is
 * the person paying for it. On the hosted instance those upgrades are already
 * paid for by whoever is running the box, and inviting a stranger to paste a
 * funded credential into someone else's server is not a request anyone should
 * make of a user.
 *
 * And it would be a *credential sink*. A form that accepts API keys on a public
 * URL is a phishing target that phishes on our behalf: keys land in the
 * operator's vault, which is a place the user did not intend to put them and
 * cannot audit. There is no version of this panel that is safe to show to
 * someone who does not administer the machine.
 *
 * `isHosted()` rather than a fresh `process.env` read, because that function is
 * the single definition of "is this the shared deployment" and its own docstring
 * already names this page as one of its three callers. Two copies of the rule is
 * how a deployment ends up hosted for the rate limiter and local for the key
 * form.
 */

export async function generateMetadata(): Promise<Metadata> {
  // Evaluated per request on the server, so the tab title and description match
  // the page the visitor actually gets. A static export could only describe one
  // of the two, and would advertise a keys form the hosted page does not render.
  return isHosted()
    ? {
        title: 'Settings',
        description: 'How this Inkcast deployment is configured.',
      }
    : {
        title: 'Keys',
        description: 'Paste the API keys that decide how much Inkcast can teach.',
      };
}

export default function SettingsPage() {
  if (isHosted()) return <HostedSettings />;

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

/**
 * What replaces the panel: an explanation, not an empty page.
 *
 * A settings route that renders nothing reads as broken, and a visitor who
 * followed a link here deserves to know *why* there is nothing to set rather
 * than being bounced to the studio. It also says where the keys are, because
 * "who is paying for this" is a fair question to be able to answer, and it
 * points at the one honest alternative for someone who wants their own keys
 * used: run it themselves. Nothing here is derived from a key or from the
 * server's key state — no provider is named as configured or missing, because
 * that is operational detail a visitor has no use for and an attacker does.
 */
function HostedSettings() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex max-w-2xl flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="text-md leading-relaxed text-muted-foreground">
          There is nothing to configure here. This is a shared deployment, so the model, the voice
          and the illustration providers are set up on the server and paid for by whoever runs it —
          the daily limit on new videos is what keeps that sustainable.
        </p>
        <p className="text-md leading-relaxed text-muted-foreground">
          Everything else Inkcast can be told is a per-video choice — aspect, style, palette, voice,
          language — and lives on the create form, where you are making the decision anyway.
        </p>
        <p className="text-md leading-relaxed text-muted-foreground">
          If you want your own API keys used, run Inkcast on your own machine: it is open source, it
          works with no keys at all, and then the keys, the films and the bill are all yours.
        </p>
      </header>
    </div>
  );
}
