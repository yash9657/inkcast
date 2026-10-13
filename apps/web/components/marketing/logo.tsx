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
      <rect width="40" height="40" rx="12" className="fill-primary" />
      <path d={MARK.path} className="fill-primary-foreground" />
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
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      <span
        className="font-display font-semibold tracking-tight text-foreground"
        style={{ fontSize: Math.round(size * 0.76), lineHeight: 1 }}
      >
        inkcast
      </span>
    </span>
  );
}
