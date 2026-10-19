import type { Metadata } from 'next';
import { Landing } from '@/components/marketing/landing';
export const metadata: Metadata = {
  title: { absolute: 'Inkcast: explain anything with a hand-drawn video' },
  description:
    'Ask a question, paste your notes or drop in a PDF. Inkcast writes the lesson, draws it stroke by stroke and narrates it. Open source.',
};
export default function MarketingPage() {
  return <Landing />;
}
