import { Suspense } from 'react';
import type { Metadata } from 'next';

import { Card, CardContent, InkUnderline, Skeleton } from '@/components/ui';
import { CreateForm } from '@/components/studio/create-form';

export const metadata: Metadata = {
  title: 'Studio',
  description:
    'Paste a document, drop a pdf, or hand it a link. Inkcast plans one growing canvas, writes on it stroke by stroke, and narrates it.',
};

export default function StudioPage() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="max-w-2xl text-3xl text-foreground">
          Draw an explainer from{' '}
          <InkUnderline tone="primary" seed="studio">
            anything
          </InkUnderline>{' '}
          you have written
        </h1>
        <p className="max-w-2xl text-md leading-relaxed text-muted-foreground">
          One canvas the camera moves across, real strokes, narration measured against the audio.
          Nothing leaves this machine unless you have set a cloud key.
        </p>
      </header>

      {/* `CreateForm` reads `?example=` to prefill, so it needs a boundary. */}
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
