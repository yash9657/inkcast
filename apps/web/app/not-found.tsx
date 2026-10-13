import Link from 'next/link';
import { ArrowLeftIcon } from 'lucide-react';
import { Logo } from '@/components/marketing/logo';
import { Button } from '@/components/ui';
export default function NotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-[70svh] max-w-xl flex-col items-start justify-center gap-6 px-6 py-16"
    >
      <Link href="/" className="focus-ring" aria-label="Inkcast home">
        <Logo />
      </Link>
      <div>
        <h1 className="text-3xl">This page isn’t on the board.</h1>
        <p className="mt-4 text-md leading-relaxed text-muted-foreground">
          The link may have changed, or this video may no longer be shared. You can head back to the
          studio and start from there.
        </p>
      </div>
      <Button render={<Link href="/studio" />}>
        <ArrowLeftIcon aria-hidden />
        Back to the studio
      </Button>
    </main>
  );
}
