import type { Metadata } from 'next';

import { ProjectView } from '@/components/studio/project-view';

export const metadata: Metadata = {
  title: 'Project',
};

/**
 * One project. `?generating=1` is set by the create flow's redirect so the
 * progress stream opens on the first paint instead of after a round trip; the
 * component also opens it for any project the server still reports as running,
 * which is what makes a mid-render refresh harmless.
 */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const generating = query.generating === '1' || query.generating === 'true';

  return <ProjectView id={id} initialGenerating={generating} />;
}
