import { Suspense } from 'react';
import type { Metadata } from 'next';

import { Skeleton } from '@/components/ui';
import { CreateForm } from '@/components/studio/create-form';
import { STUDIO_TOPIC_MAX, STUDIO_TOPIC_PARAM } from '@/components/marketing/site-config';

import { accessLinks, admitted, readAccess } from '../access';
import { SignInWall } from '../sign-in-gate';

export const metadata: Metadata = {
  title: 'Studio',
  description:
    'Paste a document, drop a pdf, or hand it a link. Inkcast plans one growing canvas, writes on it stroke by stroke, and narrates it.',
};

type SearchParams = Record<string, string | string[] | undefined>;

function arrivingTopic(params: SearchParams): string | undefined {
  const raw = params[STUDIO_TOPIC_PARAM];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim().slice(0, STUDIO_TOPIC_MAX);
  return trimmed ? trimmed : undefined;
}

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [access, params] = await Promise.all([readAccess(), searchParams]);
  const topic = arrivingTopic(params);

  if (!admitted(access)) {
    return (
      <SignInWall
        heading={topic ? 'Sign in to make this video' : 'Sign in to start creating'}
        lead={
          topic
            ? 'Your question is saved and will be waiting when you come back.'
            : 'A free account keeps your videos in one place, so you can come back to edit, download or share them.'
        }
        links={accessLinks()}
        unavailable={access.mode === 'unavailable' ? access.reason : undefined}
        topic={topic}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-8 sm:gap-10">
      <header>
        <h1 className="display-md">What do you want to explain?</h1>
        <p className="mt-3 text-base text-muted-foreground">
          Type a question, paste your notes, upload a document or add a link.
        </p>
      </header>

      <Suspense fallback={<CreateFormFallback />}>
        <CreateForm />
      </Suspense>
    </div>
  );
}

function CreateFormFallback() {
  return (
    <div className="flex flex-col gap-8" aria-hidden>
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
        <Skeleton className="h-10 w-64 rounded-pill" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-32 rounded-pill" />
          <Skeleton className="h-8 w-40 rounded-pill" />
        </div>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-12 w-40 rounded-pill" />
      </div>
    </div>
  );
}
