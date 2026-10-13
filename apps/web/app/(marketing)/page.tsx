import type { Metadata } from 'next';
import { Landing } from '@/components/marketing/landing';
export const metadata: Metadata = {
  title: { absolute: 'Inkcast — A good idea. Beautifully explained.' },
  description:
    'Turn your ideas, notes and documents into narrated whiteboard videos. Choose your format, refine your storyboard, and share what you know.',
};
export default function MarketingPage() {
  return <Landing />;
}
