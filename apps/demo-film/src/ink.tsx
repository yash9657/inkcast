import { useEffect, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';

import { C, HAND, rand } from './theme';

const css = `
@font-face { font-family: "Shantell Sans"; src: url(${staticFile('fonts/ShantellSans-Variable.woff2')}) format('woff2'); font-weight: 300 800; }
@font-face { font-family: "Space Grotesk"; src: url(${staticFile('fonts/SpaceGrotesk-Variable.woff2')}) format('woff2'); font-weight: 300 700; }
@font-face { font-family: Inter; src: url(${staticFile('fonts/Inter-Variable.woff2')}) format('woff2'); font-weight: 100 900; }
@font-face { font-family: "JetBrains Mono"; src: url(${staticFile('fonts/JetBrainsMono-Variable.woff2')}) format('woff2'); font-weight: 100 800; }
`;

/** Self-hosted fonts; the render waits until they are ready. */
export function Fonts(): React.ReactElement {
  const [handle] = useState(() => delayRender('fonts'));
  useEffect(() => {
    const done = (): void => continueRender(handle);
    Promise.all(
      [
        '500 40px "Shantell Sans"',
        '600 40px "Space Grotesk"',
        '500 40px Inter',
        '500 40px "JetBrains Mono"',
      ].map((f) => document.fonts.load(f)),
    ).then(done, done);
  }, [handle]);
  return <style>{css}</style>;
}

/** A path revealed along its length, p in 0..1. */
export function Stroke({
  d,
  p,
  color = C.ink,
  width = 4,
  fill = 'none',
  opacity = 1,
}: {
  readonly d: string;
  readonly p: number;
  readonly color?: string;
  readonly width?: number;
  readonly fill?: string;
  readonly opacity?: number;
}): React.ReactElement | null {
  if (p <= 0) return null;
  return (
    <path
      d={d}
      pathLength={1}
      fill={fill}
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray="1 1"
      strokeDashoffset={1 - Math.min(1, p)}
      opacity={opacity}
    />
  );
}

/** A wobbly rectangle drawn in one pass that overshoots where it closes. */
export function sketchRect(x: number, y: number, w: number, h: number, seed = 1, j = 3): string {
  const r = rand(seed);
  const n = (): number => (r() - 0.5) * 2 * j;
  const p = [
    [x + n(), y + n()],
    [x + w + n(), y + n()],
    [x + w + n(), y + h + n()],
    [x + n(), y + h + n()],
    [x + 6 + n(), y - 2 + n()],
  ];
  return p
    .map(([px, py], i) => {
      if (i === 0) return `M${px} ${py}`;
      const [qx, qy] = p[i - 1];
      return `Q${(px + qx) / 2 + n()} ${(py + qy) / 2 + n()} ${px} ${py}`;
    })
    .join(' ');
}

/** A loose zig-zag scribble across a box, for crossing something out. */
export function scribble(x: number, y: number, w: number, h: number, seed = 7): string {
  const r = rand(seed);
  let d = `M${x} ${y + h * 0.3}`;
  const passes = 7;
  for (let i = 1; i <= passes; i++) {
    const tx = i % 2 ? x + w : x;
    const ty = y + h * (0.25 + (0.5 * i) / passes) + (r() - 0.5) * 10;
    d += ` Q${x + w / 2} ${ty - 30 + r() * 20} ${tx} ${ty}`;
  }
  return d;
}

/** Hand-lettered text revealed left to right like a pen writing it. */
export function Hand({
  children,
  p,
  size = 64,
  color = C.ink,
  weight = 500,
  style,
}: {
  readonly children: React.ReactNode;
  readonly p: number;
  readonly size?: number;
  readonly color?: string;
  readonly weight?: number;
  readonly style?: React.CSSProperties;
}): React.ReactElement {
  const q = Math.max(0, Math.min(1, p));
  return (
    <div
      style={{
        fontFamily: HAND,
        fontSize: size,
        fontWeight: weight,
        color,
        lineHeight: 1.12,
        whiteSpace: 'nowrap',
        clipPath: `inset(-20% ${(1 - q) * 100}% -20% -2%)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Absolutely placed block in world coordinates, centred on (x, y). */
export function At({
  x,
  y,
  children,
  style,
}: {
  readonly x: number;
  readonly y: number;
  readonly children: React.ReactNode;
  readonly style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: 'translate(-50%, -50%)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
