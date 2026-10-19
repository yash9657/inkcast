'use client';
import Link from 'next/link';
import { Button } from '@/components/ui';
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      id="main"
      className="container-page flex min-h-[70svh] flex-col items-center justify-center py-16 text-center"
    >
      <h1 className="display-md max-w-lg">Something went wrong on this page</h1>
      <p className="mt-4 max-w-md text-muted-foreground">
        Nothing you made has been lost. Try loading it again, or open your library.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button variant="secondary" render={<Link href="/library" />}>
          Open library
        </Button>
      </div>
    </main>
  );
}
