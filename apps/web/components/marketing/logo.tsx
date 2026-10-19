import { cn } from '@/lib/utils';
import geometry from '../../../../assets/brand/geometry.json';

export const MARK = geometry;

/** One geometry source for the app, favicons, social images and video signature. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox={MARK.viewBox}
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className={cn('shrink-0', className)}
    >
      <rect width="40" height="40" rx={MARK.tileRadius} fill="var(--mark-tile)" />
      <path d={MARK.stroke} fill="var(--mark-stroke)" />
      <path d={MARK.play} fill="var(--mark-play)" />
    </svg>
  );
}
export type LogoVariant = 'lockup' | 'mark';
export function Logo({
  variant = 'lockup',
  size = 32,
  className,
}: {
  variant?: LogoVariant;
  size?: number;
  className?: string;
}) {
  if (variant === 'mark') return <LogoMark size={size} className={className} />;
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark size={size} />
      <span
        className="font-sans font-semibold tracking-[-0.03em] text-foreground"
        style={{ fontSize: Math.round(size * 0.7), lineHeight: 1 }}
      >
        inkcast
      </span>
    </span>
  );
}
