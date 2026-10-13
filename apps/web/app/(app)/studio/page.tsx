import { Suspense } from 'react';
import type { Metadata } from 'next';

import { Card, CardContent, InkUnderline, Skeleton } from '@/components/ui';
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
        heading={
          topic
            ? 'Your idea is ready. Let’s bring it to life.'
            : 'Your next great explanation starts here.'
        }
        lead={
          topic
            ? 'Sign in to continue. We’ve kept your topic ready for you.'
            : 'Sign in to create narrated whiteboard videos, keep your projects together, and pick up where you left off.'
        }
        links={accessLinks()}
        unavailable={access.mode === 'unavailable' ? access.reason : undefined}
        topic={topic}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="page-heading">
        <h1>Create a video</h1>
        <p>Start with what you know. We’ll help you draw it out.</p>
      </header>

      {}
      <Suspense fallback={<CreateFormFallback />}>
        <CreateForm />
      </Suspense>
    </div>
  );
}

function CreateFormFallback() {
  return (
    <div className="flex flex-col gap-6">
      <Card className="gap-4 py-4">
        <CardContent className="flex flex-col gap-4 px-4">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-48 w-full rounded-lg" />
          <div className="flex gap-2">
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-7 w-24" />
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Skeleton className="h-11 w-28" />
      </div>
    </div>
  );
}
