import { Play } from 'lucide-react';
import { AbsoluteFill, Img, staticFile } from 'remotion';

import { Fonts, sketchRect, Stroke } from './ink';
import { Mark } from './Mark';
import { BODY, C, DISPLAY, HAND } from './theme';

/** Landing thumbnail: the question, a real drawn frame, and an obvious play button. */
export function Poster(): React.ReactElement {
  return (
    <AbsoluteFill
      style={{
        background: C.background,
        backgroundImage: 'radial-gradient(oklch(0.86 0.012 100) 2px, transparent 2.5px)',
        backgroundSize: '36px 36px',
      }}
    >
      <Fonts />
      <div
        style={{
          position: 'absolute',
          left: 110,
          top: 110,
          display: 'flex',
          alignItems: 'center',
          gap: 20,
        }}
      >
        <Mark size={64} p={1} fill={1} />
        <span
          style={{
            fontFamily: DISPLAY,
            fontSize: 56,
            fontWeight: 600,
            letterSpacing: '-0.04em',
            color: C.fg,
          }}
        >
          Inkcast
        </span>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 110,
          top: 280,
          fontFamily: HAND,
          fontSize: 80,
          lineHeight: 1.12,
          fontWeight: 500,
          color: C.ink,
        }}
      >
        Type a topic.
        <br />
        <span style={{ color: C.primary, fontWeight: 650 }}>
          Watch it get{' '}
          <span style={{ position: 'relative' }}>
            drawn.
            <svg
              width={240}
              height={40}
              style={{ position: 'absolute', left: -6, bottom: -22, overflow: 'visible' }}
            >
              <Stroke d="M6 22 C70 8 140 30 230 12" p={1} color={C.amber} width={9} />
            </svg>
          </span>
        </span>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 110,
          top: 560,
          fontFamily: BODY,
          fontSize: 34,
          lineHeight: 1.45,
          color: C.mutedFg,
          width: 760,
        }}
      >
        A topic, a PDF or a link becomes a narrated, hand-drawn video lesson.
      </div>
      <div
        style={{
          position: 'absolute',
          left: 110,
          top: 760,
          display: 'flex',
          alignItems: 'center',
          gap: 22,
          padding: '16px 36px 16px 16px',
          borderRadius: 99,
          background: C.primary,
          color: 'oklch(0.99 0.004 100)',
          fontFamily: BODY,
          fontSize: 34,
          fontWeight: 600,
          boxShadow: '0 20px 50px oklch(0.37 0.075 163 / 0.3)',
        }}
      >
        <span
          style={{
            width: 76,
            height: 76,
            borderRadius: 99,
            background: 'oklch(0.99 0.004 100)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Play size={34} color={C.primary} fill={C.primary} style={{ marginLeft: 5 }} />
        </span>
        Watch the 40-second demo
      </div>
      <div
        style={{
          position: 'absolute',
          left: 1060,
          top: 250,
          width: 760,
          height: 428,
          transform: 'rotate(2deg)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 18,
            overflow: 'hidden',
            boxShadow: '0 40px 90px oklch(0.25 0.03 160 / 0.22)',
          }}
        >
          <Img
            src={staticFile('clips/poster-frame.png')}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
        <svg
          width={760}
          height={428}
          style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
        >
          <Stroke d={sketchRect(-12, -12, 784, 452, 41, 4)} p={1} color={C.ink} width={5} />
        </svg>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 1090,
          top: 730,
          fontFamily: HAND,
          fontSize: 34,
          color: C.mutedFg,
          transform: 'rotate(2deg)',
        }}
      >
        ↑ real output: “Why is the sky blue?”
      </div>
    </AbsoluteFill>
  );
}
