import Link from 'next/link';
import { Logo } from '@/components/marketing/logo';
import { Button } from '@/components/ui';
export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="container-page flex h-(--header-height) items-center">
        <Link href="/" className="focus-ring rounded-md" aria-label="Inkcast home">
          <Logo size={26} />
        </Link>
      </header>
      <main
        id="main"
        className="container-page flex flex-1 flex-col items-center justify-center py-16 text-center"
      >
        <p className="font-hand text-2xl text-muted-foreground" aria-hidden>
          404
        </p>
        <h1 className="display-md mt-3 max-w-lg">This page isn’t on the board</h1>
        <p className="mt-4 max-w-md text-muted-foreground">
          The link may be mistyped, or the video it pointed to is no longer shared.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button render={<Link href="/studio" />}>Make a video</Button>
          <Button variant="secondary" render={<Link href="/" />}>
            Go to the homepage
          </Button>
        </div>
      </main>
    </div>
  );
}
