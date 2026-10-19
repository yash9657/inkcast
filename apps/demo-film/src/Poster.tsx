import { Play } from 'lucide-react';
import { AbsoluteFill, Img, staticFile } from 'remotion';

import { Fonts, sketchRect, Stroke } from './ink';
import { Mark } from './Mark';
import { BODY, C, DISPLAY, HAND } from './theme';

/** Landing thumbnail: the promise, a real drawn frame, and an obvious play button. */
export function Poster(): React.ReactElement {
  return (
    <AbsoluteFill
      style={{
        background: C.background,
        backgroundImage: `radial-gradient(${C.dot} 2px, transparent 2.5px)`,
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
          gap: 18,
        }}
      >
        <Mark size={60} p={1} fill={1} />
        <span
          style={{
            fontFamily: BODY,
            fontSize: 50,
            fontWeight: 600,
            letterSpacing: '-0.035em',
            color: C.fg,
          }}
        >
          inkcast
        </span>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 106,
          top: 250,
          fontFamily: DISPLAY,
          fontSize: 104,
          lineHeight: 1.04,
          fontWeight: 430,
          letterSpacing: '-0.028em',
          color: C.fg,
        }}
      >
        Type a topic.
        <br />
        Watch it get{' '}
        <span style={{ position: 'relative' }}>
          drawn.
          <svg
            width={300}
            height={60}
            style={{
              position: 'absolute',
              left: 14,
              bottom: 6,
              overflow: 'visible',
              mixBlendMode: 'multiply',
            }}
          >
            <Stroke d="M8 34 C86 28 176 38 262 30" p={1} color={C.highlighter} width={50} />
          </svg>
        </span>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 110,
          top: 530,
          fontFamily: BODY,
          fontSize: 34,
          lineHeight: 1.45,
          color: C.mutedFg,
          width: 760,
        }}
      >
        A question, a PDF or a link becomes a narrated, hand-drawn video lesson.
      </div>
      <div
        style={{
          position: 'absolute',
          left: 110,
          top: 730,
          display: 'flex',
          alignItems: 'center',
          gap: 22,
          padding: '14px 38px 14px 14px',
          borderRadius: 99,
          background: C.primary,
          color: C.onPrimary,
          fontFamily: BODY,
          fontSize: 34,
          fontWeight: 600,
          boxShadow: `0 20px 50px ${C.shadow}`,
        }}
      >
        <span
          style={{
            width: 76,
            height: 76,
            borderRadius: 99,
            background: C.highlighter,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Play size={32} color={C.fg} fill={C.fg} style={{ marginLeft: 5 }} />
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
            boxShadow: `0 40px 90px ${C.shadow}`,
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
