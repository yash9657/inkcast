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
      className="mx-auto flex min-h-[65svh] max-w-xl flex-col items-start justify-center px-6 py-16"
    >
      <h1 className="text-3xl">Something interrupted the studio.</h1>
      <p className="mt-4 text-md leading-relaxed text-muted-foreground">
        We couldn’t load this page. Try again, or return to your library to pick up a saved project.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" render={<Link href="/library" />}>
          Your library
        </Button>
      </div>
    </main>
  );
}
