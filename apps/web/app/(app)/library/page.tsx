import type { Metadata } from 'next';

import { LibraryView } from '@/components/studio/library-view';

import { accessLinks, admitted, readAccess } from '../access';
import { SignInWall } from '../sign-in-gate';

export const metadata: Metadata = {
  title: 'Library',
  description: 'Every Inkcast project on this machine, rebuilt from the projects directory.',
};

/**
 * The library is somebody's own work, so on a deployment with accounts it is
 * behind the account.
 *
 * The API already enforces this: `/api/projects` scopes its listing with
 * `ownedProjectsFilter(session)`, so a signed-out visitor's request returns an
 * empty list rather than a stranger's films. Which is precisely why the page
 * needs the wall — an empty library and a library you are not signed in to look
 * identical, and the empty state would tell somebody with a hundred projects
 * that they have none. The wall names the real reason.
 */
export default async function LibraryPage() {
  const access = await readAccess();

  if (!admitted(access)) {
    return (
      <SignInWall
        heading="Sign in to see your library"
        lead="Your videos are saved to your account. Sign in to watch, edit and share them."
        links={accessLinks()}
        unavailable={access.mode === 'unavailable' ? access.reason : undefined}
      />
    );
  }

  return <LibraryView />;
}
