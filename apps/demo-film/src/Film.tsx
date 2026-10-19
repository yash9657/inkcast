import { Download, GitBranch, Link2, Mic, Sparkles } from 'lucide-react';
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
} from 'remotion';

import { At, Fonts, Hand, scribble, sketchRect, Stroke } from './ink';
import { Mark } from './Mark';
import { SoundTrack } from './Sound';
import { BODY, C, DISPLAY, easeInOut, H, HAND, LINES, MONO, pop, ramp, s, W, word } from './theme';
import { CLIPS, LESSON } from './content';

// ---------------------------------------------------------------- world

/** Station centres on one big sheet of paper. */
const P = {
  q: [960, 540],
  src: [2900, 620],
  lesson: [4920, 560],
  draw: [4920, 1800],
  choose: [2900, 1860],
  edit: [960, 1860],
  ship: [960, 3080],
} as const;
const OVERVIEW = { x: 2950, y: 1820, z: 0.29 };

type Cam = { readonly x: number; readonly y: number; readonly z: number };
const at = (k: keyof typeof P, z = 1): Cam => ({ x: P[k][0], y: P[k][1], z });

/** [start, end, from, to]: the camera eases from one pose to the next. */
const MOVES: ReadonlyArray<readonly [number, number, Cam]> = [
  [0, 0, at('q', 1.1)],
  [0.1, 2.7, at('q', 1)],
  [2.6, 3.4, at('src')],
  [6.25, 7.05, at('lesson')],
  [14.9, 15.75, at('draw')],
  [15.75, 20.2, at('draw', 1.12)],
  [20.15, 20.85, at('choose')],
  [23.25, 23.95, at('edit')],
  [27.65, 28.35, at('ship')],
  [32.7, 33.9, OVERVIEW],
];

function camera(f: number): Cam {
  let cam = MOVES[0][2];
  for (const [a, b, to] of MOVES) {
    if (f < s(a)) break;
    const t = b === a ? 1 : ramp(f, a, b, easeInOut);
    // Zoom moves in log space so a pull-back reads as steady.
    cam = {
      x: cam.x + (to.x - cam.x) * t,
      y: cam.y + (to.y - cam.y) * t,
      z: Math.exp(Math.log(cam.z) + (Math.log(to.z) - Math.log(cam.z)) * t),
    };
  }
  return cam;
}

/** The one ink line that leads the camera from idea to idea. */
const THREAD: ReadonlyArray<{ d: string; from: number; to: number }> = [
  { d: 'M1640 610 C1840 560 1980 760 2190 650', from: 2.45, to: 3.3 },
  { d: 'M3640 640 C3800 560 3960 700 4130 560', from: 6.0, to: 6.95 },
  { d: 'M4920 1040 C4980 1120 4860 1180 4920 1290', from: 14.7, to: 15.6 },
  { d: 'M4150 1840 C3980 1780 3880 1960 3700 1880', from: 19.9, to: 20.75 },
  { d: 'M2110 1880 C1980 1800 1880 1960 1760 1880', from: 23.0, to: 23.85 },
  { d: 'M960 2330 C1020 2420 900 2480 960 2600', from: 27.4, to: 28.25 },
  { d: 'M1760 3080 C2300 3000 2700 3300 3300 3120 S4300 2900 4700 3150', from: 32.2, to: 33.6 },
];

function Thread({ f }: { readonly f: number }): React.ReactElement {
  return (
    <svg
      width={6000}
      height={3700}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
    >
      {THREAD.map((t) => (
        <Stroke
          key={t.d}
          d={t.d}
          p={ramp(f, t.from, t.to, easeInOut)}
          color={C.primary}
          width={7}
        />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------- pieces

function Card({
  x,
  y,
  w,
  h,
  f,
  at: t,
  seed,
  children,
  bg = C.card,
  ink = C.ink,
  tilt = 0,
}: {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly f: number;
  readonly at: number;
  readonly seed: number;
  readonly children?: React.ReactNode;
  readonly bg?: string;
  readonly ink?: string;
  readonly tilt?: number;
}): React.ReactElement | null {
  const p = pop(f, t, 15);
  if (f < s(t) - 1) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - w / 2,
        top: y - h / 2,
        width: w,
        height: h,
        transform: `rotate(${tilt}deg) scale(${0.9 + 0.1 * Math.min(1, p)})`,
        opacity: Math.min(1, p * 2),
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: bg,
          borderRadius: 22,
          opacity: ramp(f, t + 0.1, t + 0.5),
        }}
      />
      <svg width={w} height={h} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <Stroke
          d={sketchRect(4, 4, w - 8, h - 8, seed, 3)}
          p={ramp(f, t, t + 0.55)}
          color={ink}
          width={3.5}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, opacity: ramp(f, t + 0.2, t + 0.55) }}>
        {children}
      </div>
    </div>
  );
}

function Label({
  children,
  color = C.mutedFg,
}: {
  readonly children: React.ReactNode;
  readonly color?: string;
}) {
  return (
    <div
      style={{
        fontFamily: BODY,
        fontSize: 22,
        fontWeight: 600,
        letterSpacing: '0.14em',
        color,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- stations

function Question({ f }: { readonly f: number }): React.ReactElement {
  const [x, y] = P.q;
  return (
    <>
      <At x={x} y={y - 70}>
        <Hand p={ramp(f, 0.75, 1.5)} size={118}>
          Got something
        </Hand>
      </At>
      <At x={x} y={y + 70}>
        <Hand p={ramp(f, 1.35, 2.35)} size={118} color={C.primary} weight={650}>
          worth explaining?
        </Hand>
      </At>
      <svg
        width={1920}
        height={1080}
        style={{
          position: 'absolute',
          left: x - 960,
          top: y - 540,
          overflow: 'visible',
          mixBlendMode: 'multiply',
        }}
      >
        {/* The highlighter: a fat marker pass across the words that matter. */}
        <Stroke
          d="M470 642 C760 630 1100 650 1470 634"
          p={ramp(f, 2.1, 2.6)}
          color={C.highlighter}
          width={64}
        />
        <Stroke
          d="M1540 300 l26 -40 M1580 330 l44 -12 M1520 270 l-6 -46"
          p={ramp(f, 2.3, 2.7)}
          color={C.ink}
          width={6}
        />
      </svg>
    </>
  );
}

function Sources({ f }: { readonly f: number }): React.ReactElement {
  const [x, y] = P.src;
  const topic = 'Why is the sky blue?';
  const typed = topic.slice(
    0,
    Math.round(
      interpolate(f, [s(word('topic')), s(word('topic') + 0.6)], [0, topic.length], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
    ),
  );
  return (
    <>
      <Card
        x={x - 560}
        y={y - 60}
        w={560}
        h={300}
        f={f}
        at={word('Type') - 0.1}
        seed={11}
        tilt={-2}
      >
        <div style={{ padding: '36px 40px' }}>
          <Label>Topic</Label>
          <div
            style={{
              fontFamily: BODY,
              fontSize: 44,
              fontWeight: 500,
              color: C.fg,
              marginTop: 26,
              minHeight: 60,
            }}
          >
            {typed}
            <span style={{ opacity: Math.floor(f / 8) % 2 ? 0 : 1, color: C.primary }}>|</span>
          </div>
        </div>
      </Card>
      <Card
        x={x + 10}
        y={y + 40}
        w={360}
        h={440}
        f={f}
        at={word('PDF') - 0.15}
        seed={12}
        tilt={2.5}
      >
        <div style={{ padding: '40px 36px' }}>
          <Label color={C.red}>PDF</Label>
          {[0.95, 0.8, 0.9, 0.6, 0.85, 0.7].map((wd, i) => (
            <div
              key={i}
              style={{
                height: 14,
                width: `${wd * 100}%`,
                background: C.muted,
                borderRadius: 7,
                marginTop: i ? 18 : 30,
              }}
            />
          ))}
          <div style={{ fontFamily: BODY, fontSize: 24, color: C.mutedFg, marginTop: 40 }}>
            lecture-notes.pdf
          </div>
        </div>
      </Card>
      <Card
        x={x + 560}
        y={y - 20}
        w={520}
        h={150}
        f={f}
        at={word('link') - 0.15}
        seed={13}
        tilt={-1.5}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            padding: '0 34px',
            height: '100%',
          }}
        >
          <Link2 size={38} color={C.blue} />
          <span style={{ fontFamily: BODY, fontSize: 29, color: C.blue, fontWeight: 500 }}>
            en.wikipedia.org/wiki/Sky
          </span>
        </div>
      </Card>
      <At x={x} y={y + 340}>
        <Hand p={ramp(f, word('link') + 0.2, word('link') + 0.9)} size={40} color={C.mutedFg}>
          text · files · links
        </Hand>
      </At>
    </>
  );
}

function Lesson({ f }: { readonly f: number }): React.ReactElement {
  const [x, y] = P.lesson;
  const struck = ramp(f, word('summarize') + 0.25, word('summarize') + 0.75);
  const summaryOut = ramp(f, word('designs') - 0.1, word('designs') + 0.3);
  const notes = [
    {
      k: 'Hook',
      at: word('hook') - 0.12,
      bg: C.highlighterSoft,
      ink: C.fg,
      text: LESSON.hook,
      tilt: -2.5,
    },
    {
      k: 'Worked example',
      at: word('example') - 0.15,
      bg: C.sky,
      ink: C.skyInk,
      text: LESSON.worked,
      tilt: 1.5,
    },
    {
      k: 'Misconception',
      at: word('mistake') - 0.1,
      bg: C.rose,
      ink: C.roseInk,
      text: LESSON.misconception,
      tilt: -1,
    },
  ];
  return (
    <>
      {/* The thing it is not: a grey summary, crossed out. */}
      <div style={{ opacity: 1 - summaryOut, transform: `translateY(${-summaryOut * 40}px)` }}>
        <Card x={x} y={y} w={760} h={380} f={f} at={7.05} seed={21} ink={C.border}>
          <div style={{ padding: '40px 46px' }}>
            <Label>Summary</Label>
            {[1, 0.92, 0.97, 0.85, 0.9, 0.6].map((wd, i) => (
              <div
                key={i}
                style={{
                  height: 16,
                  width: `${wd * 100}%`,
                  background: C.muted,
                  borderRadius: 8,
                  marginTop: i ? 20 : 30,
                }}
              />
            ))}
          </div>
        </Card>
        <svg
          width={760}
          height={380}
          style={{ position: 'absolute', left: x - 380, top: y - 190, overflow: 'visible' }}
        >
          <Stroke d={scribble(30, 40, 700, 300)} p={struck} color={C.red} width={10} />
        </svg>
      </div>
      {/* What it does instead: a lesson plan. */}
      <div style={{ opacity: ramp(f, word('designs') - 0.05, word('designs') + 0.3) }}>
        <At x={x} y={y - 300}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 26 }}>
            <Hand
              p={ramp(f, word('designs'), word('lesson') + 0.4)}
              size={72}
              weight={650}
              color={C.primary}
            >
              Lesson plan
            </Hand>
            <Hand p={ramp(f, word('lesson'), word('lesson') + 0.7)} size={40} color={C.mutedFg}>
              {LESSON.topic}
            </Hand>
          </div>
        </At>
        {notes.map((n, i) => (
          <Card
            key={n.k}
            x={x - 520 + i * 520}
            y={y + 40}
            w={470}
            h={430}
            f={f}
            at={n.at}
            seed={30 + i}
            bg={n.bg}
            ink={n.ink}
            tilt={n.tilt}
          >
            <div style={{ padding: '38px 36px', color: n.ink }}>
              <Label color={n.ink}>{n.k}</Label>
              <div
                style={{
                  fontFamily: HAND,
                  fontSize: 37,
                  lineHeight: 1.3,
                  marginTop: 22,
                  fontWeight: 500,
                }}
              >
                {n.text}
              </div>
            </div>
          </Card>
        ))}
        <At
          x={x + 470}
          y={y + 330}
          style={{
            opacity: ramp(f, 14.45, 14.75),
            transform: `translate(-50%, -50%) rotate(-6deg) scale(${0.8 + 0.2 * pop(f, 14.45)})`,
          }}
        >
          <div
            style={{
              fontFamily: BODY,
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: '0.1em',
              color: C.green,
              border: `3px solid ${C.green}`,
              borderRadius: 10,
              padding: '8px 16px',
            }}
          >
            CRITIQUED · REVISED ✓
          </div>
        </At>
      </div>
    </>
  );
}

function Frame({
  x,
  y,
  w,
  h,
  f,
  at: t,
  seed,
  children,
}: {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly f: number;
  readonly at: number;
  readonly seed: number;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div style={{ position: 'absolute', left: x - w / 2, top: y - h / 2, width: w, height: h }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 18,
          overflow: 'hidden',
          background: C.paper,
          opacity: ramp(f, t + 0.25, t + 0.6),
          boxShadow: `0 30px 80px ${C.shadow}`,
        }}
      >
        {children}
      </div>
      <svg width={w} height={h} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <Stroke
          d={sketchRect(-10, -10, w + 20, h + 20, seed, 4)}
          p={ramp(f, t, t + 0.6)}
          color={C.ink}
          width={5}
        />
      </svg>
    </div>
  );
}

function Draw({ f }: { readonly f: number }): React.ReactElement {
  const [x, y] = P.draw;
  const t0 = word('draws') - 0.5;
  const words = CLIPS.sky.words;
  const clipT = (f - s(t0)) / 30 + CLIPS.sky.from;
  return (
    <>
      <Frame x={x} y={y - 60} w={1280} h={720} f={f} at={t0} seed={41}>
        <Sequence from={s(t0)} layout="none">
          <OffthreadVideo
            src={staticFile(CLIPS.sky.src)}
            startFrom={s(CLIPS.sky.from)}
            muted
            style={{ width: '100%', height: '100%' }}
          />
        </Sequence>
      </Frame>
      {/* The words those strokes were timed to. */}
      <At x={x} y={y + 380} style={{ opacity: ramp(f, word('stroke'), word('stroke') + 0.4) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Mic size={30} color={C.primary} />
          {words.map((w) => {
            const on = clipT >= w.at;
            return (
              <span
                key={`${w.w}${w.at}`}
                style={{
                  fontFamily: BODY,
                  fontSize: 30,
                  fontWeight: 600,
                  padding: '6px 14px',
                  borderRadius: 10,
                  background: on ? C.highlighter : 'transparent',
                  color: on ? C.fg : C.border,
                }}
              >
                {w.w}
              </span>
            );
          })}
        </div>
      </At>
    </>
  );
}

const STYLES = [
  { name: 'marker', bg: C.paper, ink: C.ink, w: 9 },
  { name: 'chalk', bg: '#1b232e', ink: 'oklch(0.95 0.01 90)', w: 7 },
  { name: 'blueprint', bg: 'oklch(0.36 0.09 255)', ink: 'oklch(0.95 0.02 240)', w: 4 },
  { name: 'pencil', bg: C.paper, ink: 'oklch(0.55 0.01 250)', w: 3 },
  { name: 'ink', bg: C.paper, ink: C.blue, w: 5 },
];

function Choose({ f }: { readonly f: number }): React.ReactElement {
  const [x, y] = P.choose;
  const tv = word('voice', 1);
  const ts = word('style');
  const tsh = word('shape');
  const morph = ramp(f, tsh - 0.1, tsh + 0.5, easeInOut);
  const fw = 640 + (340 - 640) * morph;
  const fh = 360 + (604 - 360) * morph;
  return (
    <>
      <div style={{ position: 'absolute', left: x - 820, top: y - 250, width: 900 }}>
        <div style={{ opacity: ramp(f, tv - 0.2, tv + 0.2) }}>
          <Label>Voice</Label>
          <div style={{ display: 'flex', gap: 18, marginTop: 18 }}>
            {['Kokoro · on your machine', 'ElevenLabs'].map((v, i) => (
              <span
                key={v}
                style={{
                  fontFamily: BODY,
                  fontSize: 30,
                  fontWeight: 600,
                  padding: '14px 24px',
                  borderRadius: 14,
                  border: `2.5px solid ${i ? C.primary : C.border}`,
                  background: i ? C.canvas : C.card,
                  color: C.fg,
                  transform: `scale(${0.85 + 0.15 * pop(f, tv - 0.1 + i * 0.15)})`,
                }}
              >
                {v}
              </span>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 56, opacity: ramp(f, ts - 0.2, ts + 0.2) }}>
          <Label>Drawing style</Label>
          <div style={{ display: 'flex', gap: 16, marginTop: 18 }}>
            {STYLES.map((st, i) => (
              <div
                key={st.name}
                style={{
                  textAlign: 'center',
                  transform: `scale(${0.8 + 0.2 * pop(f, ts - 0.1 + i * 0.08)})`,
                }}
              >
                <svg
                  width={150}
                  height={100}
                  style={{ background: st.bg, borderRadius: 14, border: `2px solid ${C.border}` }}
                >
                  <Stroke
                    d="M20 70 C45 20 70 85 95 45 S125 30 132 52"
                    p={ramp(f, ts + i * 0.08, ts + 0.45 + i * 0.08)}
                    color={st.ink}
                    width={st.w}
                  />
                </svg>
                <div style={{ fontFamily: BODY, fontSize: 22, color: C.mutedFg, marginTop: 8 }}>
                  {st.name}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 50, opacity: ramp(f, tsh - 0.2, tsh + 0.2) }}>
          <Label>Shape</Label>
          <div
            style={{
              display: 'flex',
              gap: 30,
              marginTop: 14,
              fontFamily: MONO,
              fontSize: 32,
              fontWeight: 600,
            }}
          >
            {['16:9', '9:16', '1:1'].map((r, i) => (
              <span key={r} style={{ color: i === Math.round(morph) ? C.primary : C.mutedFg }}>
                {r}
              </span>
            ))}
          </div>
        </div>
      </div>
      <Frame x={x + 520} y={y} w={fw} h={fh} f={f} at={tv - 0.4} seed={51}>
        <Sequence from={s(tv - 0.4)} layout="none">
          <OffthreadVideo
            src={staticFile(CLIPS.sky.src)}
            startFrom={s(CLIPS.sky.choose)}
            muted
            style={{
              position: 'absolute',
              width: 640,
              height: 360,
              left: (fw - 640) / 2,
              top: (fh - 360) / 2,
              opacity: 1 - morph,
            }}
          />
          <OffthreadVideo
            src={staticFile(CLIPS.short.src)}
            startFrom={s(CLIPS.short.from)}
            muted
            style={{
              position: 'absolute',
              width: 340,
              height: 604,
              left: (fw - 340) / 2,
              top: (fh - 604) / 2,
              opacity: morph,
            }}
          />
        </Sequence>
      </Frame>
    </>
  );
}

function Edit({ f }: { readonly f: number }): React.ReactElement {
  const [x, y] = P.edit;
  const tAsk = word('change') - 0.2;
  const ask = CLIPS.edit.instruction;
  const typed = ask.slice(
    0,
    Math.round(
      interpolate(f, [s(tAsk + 0.2), s(word('ask') + 0.3)], [0, ask.length], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
    ),
  );
  const tRe = word('redraws');
  const wipe = ramp(f, tRe - 0.35, tRe + 0.05);
  const redraw = ramp(f, tRe + 0.05, tRe + 1.2, easeInOut);
  return (
    <>
      <Card x={x - 470} y={y} w={640} h={330} f={f} at={tAsk} seed={61} tilt={-1.5}>
        <div style={{ padding: '36px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Sparkles size={26} color={C.primary} />
            <Label color={C.primary}>Ask for a change</Label>
          </div>
          <div
            style={{
              fontFamily: BODY,
              fontSize: 38,
              fontWeight: 500,
              color: C.fg,
              lineHeight: 1.35,
              marginTop: 24,
            }}
          >
            “{typed}
            <span style={{ opacity: Math.floor(f / 8) % 2 ? 0 : 1, color: C.primary }}>|</span>”
          </div>
        </div>
      </Card>
      <Frame x={x + 400} y={y} w={800} h={450} f={f} at={tAsk + 0.1} seed={62}>
        <Img src={staticFile(CLIPS.edit.before)} style={{ width: '100%', height: '100%' }} />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            clipPath: `inset(0 ${(1 - redraw) * 100}% 0 0)`,
          }}
        >
          <Img src={staticFile(CLIPS.edit.after)} style={{ width: '100%', height: '100%' }} />
        </div>
        <svg width={800} height={450} style={{ position: 'absolute', inset: 0 }}>
          <Stroke
            d={scribble(40, 30, 720, 390, 3)}
            p={wipe}
            color={C.ink}
            width={14}
            opacity={1 - redraw}
          />
        </svg>
      </Frame>
      <At x={x + 400} y={y + 290} style={{ opacity: ramp(f, tRe + 0.6, tRe + 1) }}>
        <Hand p={ramp(f, tRe + 0.6, tRe + 1.3)} size={34} color={C.mutedFg}>
          storyboard updated · re-rendered
        </Hand>
      </At>
    </>
  );
}

function Ship({ f }: { readonly f: number }): React.ReactElement {
  const [x, y] = P.ship;
  const items = [
    {
      at: word('Download'),
      icon: <Download size={54} color={C.primary} />,
      title: 'Download',
      sub: 'MP4 · 1080p · captions',
    },
    {
      at: word('share'),
      icon: <Link2 size={54} color={C.blue} />,
      title: 'Share a link',
      sub: 'inkcast.video/share/…',
    },
  ];
  return (
    <>
      {items.map((it, i) => (
        <Card
          key={it.title}
          x={x - 560 + i * 460}
          y={y - 120}
          w={400}
          h={250}
          f={f}
          at={it.at - 0.12}
          seed={70 + i}
          tilt={i ? 1.5 : -1.5}
        >
          <div style={{ padding: '36px 36px' }}>
            {it.icon}
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: 46,
                fontWeight: 480,
                letterSpacing: '-0.02em',
                color: C.fg,
                marginTop: 16,
              }}
            >
              {it.title}
            </div>
            <div style={{ fontFamily: BODY, fontSize: 24, color: C.mutedFg, marginTop: 6 }}>
              {it.sub}
            </div>
          </div>
        </Card>
      ))}
      <Card
        x={x + 470}
        y={y - 120}
        w={560}
        h={250}
        f={f}
        at={word('host') - 0.15}
        seed={72}
        bg={C.night}
        ink={C.ink}
        tilt={1}
      >
        <div
          style={{
            padding: '40px 38px',
            fontFamily: MONO,
            fontSize: 27,
            lineHeight: 1.6,
            color: 'oklch(0.955 0.006 90)',
          }}
        >
          <span style={{ color: C.highlighter }}>$</span> pnpm dev
          <br />
          <span style={{ color: C.highlighter }}>$</span> inkcast teach “why…”
          <br />
          <span style={{ color: 'oklch(0.74 0.012 262)' }}>your machine, your keys</span>
        </div>
      </Card>
      <At
        x={x}
        y={y + 210}
        style={{
          transform: `translate(-50%, -50%) scale(${0.7 + 0.3 * pop(f, word('open'))})`,
          opacity: ramp(f, word('open') - 0.1, word('open') + 0.2),
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            padding: '18px 34px',
            borderRadius: 99,
            background: C.primary,
            color: C.onPrimary,
            fontFamily: BODY,
            fontSize: 38,
            fontWeight: 600,
          }}
        >
          <GitBranch size={40} /> Open source · AGPL-3.0
        </div>
      </At>
    </>
  );
}

function EndCard({ f }: { readonly f: number }): React.ReactElement | null {
  const t0 = word('Inkcast', 1) - 0.25;
  if (f < s(t0) - 2) return null;
  const veil = ramp(f, t0, t0 + 0.6);
  const tType = word('Type', 1);
  const tWatch = word('Watch');
  const tDrawn = word('drawn');
  return (
    <AbsoluteFill style={{ background: `oklch(0.982 0.005 90 / ${veil * 0.95})` }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 250,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 34,
        }}
      >
        <Mark size={150} p={ramp(f, t0, t0 + 0.8)} fill={ramp(f, t0 + 0.5, t0 + 0.9)} />
        <div
          style={{
            fontFamily: BODY,
            fontSize: 132,
            fontWeight: 600,
            letterSpacing: '-0.035em',
            color: C.fg,
            opacity: ramp(f, t0 + 0.2, t0 + 0.6),
            transform: `translateX(${(1 - ramp(f, t0 + 0.2, t0 + 0.7)) * -30}px)`,
          }}
        >
          inkcast
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 560,
          textAlign: 'center',
          fontFamily: DISPLAY,
          fontSize: 100,
          fontWeight: 430,
          letterSpacing: '-0.025em',
          color: C.fg,
        }}
      >
        <span style={{ opacity: ramp(f, tType - 0.1, tType + 0.25) }}>Type a topic. </span>
        <span style={{ opacity: ramp(f, tWatch - 0.1, tWatch + 0.25) }}>
          Watch it get{' '}
          <span style={{ position: 'relative' }}>
            drawn.
            <svg
              width={290}
              height={60}
              style={{
                position: 'absolute',
                left: 12,
                bottom: 4,
                overflow: 'visible',
                mixBlendMode: 'multiply',
              }}
            >
              <Stroke
                d="M8 34 C80 28 160 38 240 30"
                p={ramp(f, tDrawn, tDrawn + 0.5)}
                color={C.highlighter}
                width={46}
              />
            </svg>
          </span>
        </span>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 790,
          textAlign: 'center',
          fontFamily: BODY,
          fontSize: 38,
          fontWeight: 500,
          color: C.mutedFg,
          opacity: ramp(f, tDrawn + 0.6, tDrawn + 1.1),
        }}
      >
        inkcast.video
      </div>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------- film

export function Film(): React.ReactElement {
  const f = useCurrentFrame();
  const cam = camera(f);
  return (
    <AbsoluteFill style={{ background: C.background, overflow: 'hidden' }}>
      <Fonts />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 6000,
          height: 3700,
          transformOrigin: '0 0',
          transform: `translate(${W / 2 - cam.x * cam.z}px, ${H / 2 - cam.y * cam.z}px) scale(${cam.z})`,
          backgroundImage: `radial-gradient(${C.dot} 2px, transparent 2.5px)`,
          backgroundSize: '36px 36px',
        }}
      >
        <Thread f={f} />
        <Question f={f} />
        <Sources f={f} />
        <Lesson f={f} />
        <Draw f={f} />
        <Choose f={f} />
        <Edit f={f} />
        <Ship f={f} />
      </div>
      <EndCard f={f} />
      {LINES.map((ln) => (
        <Sequence key={ln.id} from={s(ln.clipStart)} layout="none">
          <Audio src={staticFile(`audio/${ln.id}.wav`)} />
        </Sequence>
      ))}
      <SoundTrack />
    </AbsoluteFill>
  );
}
