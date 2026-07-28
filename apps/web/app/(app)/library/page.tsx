import type { Metadata } from 'next';

import { LibraryView } from '@/components/studio/library-view';

export const metadata: Metadata = {
  title: 'Library',
  description: 'Every Inkcast project on this machine, rebuilt from the projects directory.',
};

export default function LibraryPage() {
  return <LibraryView />;
}
