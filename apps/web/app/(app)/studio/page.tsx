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

/**
 * The create page, and the one place on this site where losing a sentence would
 * cost us the visitor.
 *
 * The landing page's try strip is a plain GET form: it navigates to
 * `/studio?topic=explain%20photosynthesis` and that query *is* the funnel. So a
 * signed-out arrival must not redirect, must not 404, and must not render an
 * empty page. It renders the door in place, with the URL untouched, the typed
 * sentence shown back, and `redirect_url` pointing at this exact address — three
 * independent reasons the topic is still there after the round trip, plus a
 * fourth in `sign-in-gate.tsx` for the tab-switching sign-up flow.
 *
 * Not `redirect()` to a sign-in page, and not `notFound()`. A redirect replaces
 * the URL, so pressing Back after signing in lands on the sign-in page again
 * rather than on the studio, and a visitor who abandons the flow has lost the
 * only copy of what they typed.
 */
type SearchParams = Record<string, string | string[] | undefined>;

/** The topic the try strip handed us, trimmed and capped, or nothing. */
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
        heading={topic ? 'Sign in and it draws that' : 'Sign in to draw one'}
        lead={
          topic
            ? 'Your topic is held below. Signing in brings you straight back to this page with it already in the box.'
            : 'Drawing a video runs a planner, a voice and a headless browser for a couple of minutes, so this deployment asks who it is doing that for. Nothing else here is behind the door.'
        }
        links={accessLinks()}
        unavailable={access.mode === 'unavailable' ? access.reason : undefined}
        topic={topic}
      />
    );
  }

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
          {/* "Nothing leaves this machine" is the local studio's strongest
              promise and the shared deployment's plainest falsehood — there the
              machine is the server, and the document was uploaded to it to get
              here. Two sentences rather than one hedge, so neither deployment is
              told a version of the other's story. */}
          {access.mode === 'open'
            ? ' Nothing leaves this machine unless you have set a cloud key.'
            : ' The render runs on the server, so what you paste here is uploaded to it.'}
        </p>
      </header>

      {/* `CreateForm` reads `?example=` and `?topic=` to prefill, so it needs a
          boundary. */}
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
