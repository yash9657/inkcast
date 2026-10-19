import { Stroke } from './ink';

// assets/brand/geometry.json, coloured by --mark-tile / --mark-stroke / --mark-play (light).
const TILE = 'M11 0 L29 0 Q40 0 40 11 L40 29 Q40 40 29 40 L11 40 Q0 40 0 29 L0 11 Q0 0 11 0 Z';
const PEN = 'M11.5 10 L16.5 10 L16.5 25.5 L11.5 30 Z';
const PLAY =
  'M19.5 10.5 Q19.5 9.2 20.6 9.9 L31 18.8 Q32.1 20 31 21.2 L20.6 30.1 Q19.5 30.8 19.5 29.5 Z';
const TILE_INK = '#131a24';
const PAPER = '#fdfdfa';
const HIGHLIGHTER = '#fee860';

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
      <path d={TILE} fill={TILE_INK} opacity={fill} />
      <Stroke d={TILE} p={p} color={TILE_INK} width={1.6} />
      <path d={PEN} fill={PAPER} opacity={fill} />
      <path d={PLAY} fill={HIGHLIGHTER} opacity={fill} />
    </svg>
  );
}
