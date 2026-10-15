import { Stroke } from './ink';
import { C } from './theme';

// assets/brand/geometry.json
const TILE = 'M12 0 L28 0 Q40 0 40 12 L40 28 Q40 40 28 40 L12 40 Q0 40 0 28 L0 12 Q0 0 12 0 Z';
const GLYPH = 'M12 10 L17 10 L17 25.5 L12 30 Z M20 10 L32 20 L20 30 Z';

/** The ink-to-play mark: the tile outline is drawn, then filled. */
export function Mark({
  size,
  p,
  fill,
}: {
  readonly size: number;
  readonly p: number;
  readonly fill: number;
}) {
  return (
    <svg width={size} height={size} viewBox="-1 -1 42 42" style={{ overflow: 'visible' }}>
      <path d={TILE} fill={C.primary} opacity={fill} />
      <Stroke d={TILE} p={p} color={C.primary} width={1.6} />
      <path d={GLYPH} fill="oklch(0.99 0.004 100)" opacity={fill} />
    </svg>
  );
}
