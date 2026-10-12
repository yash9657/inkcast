import type { Metadata } from 'next';
import { KeysPanel } from '@/components/settings/keys-panel';
import { accountKeys } from '@/app/api/_lib/deployment';
import { accessLinks, admitted, readAccess } from '../access';
import { SignInWall } from '../sign-in-gate';

export const metadata: Metadata = {
  title: 'API keys',
  description: 'Connect your own planning, speech and illustration providers.',
};

export default async function SettingsPage() {
  const access = await readAccess();
  if (!admitted(access))
    return (
      <SignInWall
        heading="Sign in to manage your API keys"
        lead="Connect providers to your account, then choose which to use for each video."
        links={accessLinks()}
        unavailable={access.mode === 'unavailable' ? access.reason : undefined}
      />
    );
  return (
    <div className="flex flex-col gap-8">
      <header className="flex max-w-2xl flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Your API keys</h1>
        <p className="text-md leading-relaxed text-muted-foreground">
          Use Fireworks to write and draw the lesson, and ElevenLabs to narrate it. Choose providers
          for each video; their usage is billed to your provider accounts. Local planning and speech
          remain available without keys.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {accountKeys()
            ? 'Keys are encrypted on this server and scoped to your account. Only masked previews are shown after saving.'
            : 'Keys are saved on this machine, in the same store used by the Inkcast CLI.'}
        </p>
      </header>
      <KeysPanel />
    </div>
  );
}
