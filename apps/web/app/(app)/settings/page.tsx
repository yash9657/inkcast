import type { Metadata } from 'next';
import { KeysPanel } from '@/components/settings/keys-panel';
import { accessLinks, admitted, readAccess } from '../access';
import { SignInWall } from '../sign-in-gate';

export const metadata: Metadata = {
  title: 'Settings',
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
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <header className="flex flex-col gap-3">
        <h1 className="display-md">Settings</h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
          Inkcast works without any keys. Add one to get model-written lessons, more voices or
          generated illustrations.
        </p>
      </header>
      <KeysPanel />
    </div>
  );
}
