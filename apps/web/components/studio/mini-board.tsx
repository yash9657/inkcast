import * as React from 'react';

import { inkCirclePath, inkStrokePath } from '@/components/ui';
import { cn, randomFromSeed, seedFrom } from '@/lib/utils';
import type { Storyboard } from '@inkcast/core';

import { aspectValue } from './format';
import { findAsset, visibleElements, type BoardElement, type Box, type SceneElement } from './board';

/**
 * A real preview of one scene of the storyboard, drawn from the IR.
 *
 * This is not a decorative placeholder: every element in `scene.elements` is
 * plotted at its canvas coordinates, the camera's `x`/`y`/`zoom` become the
 * viewBox, and elements that earlier scenes left on the board are drawn faded
 * behind this scene's own — which is the whole point of the persistent canvas.
 * Resolved asset SVGs are embedded through `<image href="data:…">`, so hand-drawn
 * vectors show up as themselves while staying sandboxed (an `<image>` reference
 * cannot execute script or fetch anything).
 *
 * Wobble comes from the shared seeded PRNG, so the same scene draws identically
 * on the server and the client and does not re-roll between renders.
 */

const INK_TONES = [
  'stroke-ink',
  'stroke-ink-blue',
  'stroke-ink-violet',
  'stroke-ink-green',
  'stroke-ink-amber',
  'stroke-ink-red',
] as const;

const FILL_TONES = [
  'fill-ink',
  'fill-ink-blue',
  'fill-ink-violet',
  'fill-ink-green',
  'fill-ink-amber',
  'fill-ink-red',
] as const;

const ROLE_SCALE: Record<string, number> = {
  title: 0.062,
  heading: 0.046,
  body: 0.034,
  label: 0.028,
  caption: 0.024,
};

export type MiniBoardProps = {
  storyboard: Storyboard;
  /** Which scene to frame. */
  sceneIndex: number;
  className?: string;
  /** Hide earlier scenes' persisted elements (used for the tiny library tile). */
  soloScene?: boolean;
};

export function MiniBoard({ storyboard, sceneIndex, className, soloScene = false }: MiniBoardProps) {
  const scene = storyboard.scenes[sceneIndex];
  if (!scene) return null;

  const canvas = storyboard.canvas ?? { x: 0, y: 0, w: 1920, h: 1080 };
  const ratio = aspectValue(storyboard.meta?.aspect ?? '16:9');
  const zoom = Math.max(scene.camera?.zoom ?? 1, 0.05);

  // The camera frames a window on the canvas; fit it to the output aspect so a
  // 9:16 project previews tall and a 16:9 one previews wide.
  let vw = canvas.w / zoom;
  let vh = canvas.h / zoom;
  if (vw / vh > ratio) vh = vw / ratio;
  else vw = vh * ratio;

  const cx = scene.camera?.x ?? canvas.x + canvas.w / 2;
  const cy = scene.camera?.y ?? canvas.y + canvas.h / 2;
  const viewBox = `${cx - vw / 2} ${cy - vh / 2} ${vw} ${vh}`;

  const mono = (storyboard.meta?.palette ?? 'color') === 'mono';
  const all: BoardElement[] = soloScene
    ? (scene.elements ?? []).map((element) => ({ element, own: true, from: sceneIndex }))
    : visibleElements(storyboard, sceneIndex);

  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={`Board at scene ${sceneIndex + 1}`}
      className={cn('block size-full bg-paper', className)}
    >
      {all.map(({ element, own }, i) => (
        <g key={element.id} opacity={own ? 1 : 0.32}>
          {renderElement(element, i, mono, vh, storyboard, all)}
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ drawing */

function tone(index: number, mono: boolean): { stroke: string; fill: string } {
  if (mono) return { stroke: INK_TONES[0], fill: FILL_TONES[0] };
  const i = Math.abs(index) % INK_TONES.length;
  return { stroke: INK_TONES[i] ?? INK_TONES[0], fill: FILL_TONES[i] ?? FILL_TONES[0] };
}

function renderElement(
  el: SceneElement,
  index: number,
  mono: boolean,
  viewportHeight: number,
  sb: Storyboard,
  board: BoardElement[],
): React.ReactNode {
  const rand = randomFromSeed(seedFrom(el.id));
  const { stroke, fill } = tone(index, mono);
  const weight = Math.max(viewportHeight * 0.0035, 1.2);

  switch (el.type) {
    case 'text':
      return (
        <BoardText
          box={el.at}
          text={el.text}
          role={el.role}
          align={el.align}
          fill={fill}
          viewportHeight={viewportHeight}
        />
      );

    case 'asset': {
      const asset = findAsset(sb, el.assetId);
      const svg = asset?.svg;
      if (svg && svg.trimStart().startsWith('<svg')) {
        return (
          <image
            href={svgDataUri(svg)}
            x={el.at.x}
            y={el.at.y}
            width={el.at.w}
            height={el.at.h}
            preserveAspectRatio="xMidYMid meet"
            transform={el.flipX ? `translate(${2 * el.at.x + el.at.w} 0) scale(-1 1)` : undefined}
          />
        );
      }
      // Not drawn yet: an honest outline with the entity's name, not a fake
      // illustration. This is what the board genuinely looks like mid-pipeline.
      return (
        <>
          <WobblyRect box={el.at} rand={rand} stroke={stroke} weight={weight} dashed />
          <BoardText
            box={{ ...el.at, y: el.at.y + el.at.h / 2 - viewportHeight * 0.02 }}
            text={el.assetId.replace(/-/g, ' ')}
            role="label"
            align="center"
            fill={fill}
            viewportHeight={viewportHeight}
            lines={1}
          />
        </>
      );
    }

    case 'shape':
      return <BoardShape el={el} rand={rand} stroke={stroke} fill={fill} weight={weight} />;

    case 'arrow':
      return <BoardArrow el={el} rand={rand} stroke={stroke} weight={weight} />;

    case 'diagram':
      return (
        <BoardDiagram
          el={el}
          rand={rand}
          stroke={stroke}
          fill={fill}
          weight={weight}
          viewportHeight={viewportHeight}
        />
      );

    case 'emphasis': {
      const target = board.find((b) => b.element.id === el.targetId)?.element;
      const box = target?.at ?? el.at;
      if (el.effect === 'underline') {
        return (
          <path
            d={inkStrokePath(
              rand,
              { x: box.x, y: box.y + box.h + box.h * 0.08 },
              { x: box.x + box.w, y: box.y + box.h + box.h * 0.08 },
              { amplitude: box.h * 0.04 },
            )}
            className={stroke}
            fill="none"
            strokeWidth={weight * 1.4}
            strokeLinecap="round"
          />
        );
      }
      return (
        <path
          d={inkCirclePath(
            rand,
            {
              cx: box.x + box.w / 2,
              cy: box.y + box.h / 2,
              rx: (box.w / 2) * 1.12,
              ry: (box.h / 2) * 1.25,
            },
            { amplitude: Math.max(box.h * 0.05, 2) },
          )}
          className={stroke}
          fill="none"
          strokeWidth={weight * 1.2}
          strokeLinecap="round"
        />
      );
    }

    default:
      return null;
  }
}

function svgDataUri(svg: string): string {
  const withNs = svg.includes('xmlns=')
    ? svg
    : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withNs)}`;
}

/* --------------------------------------------------------------------- text */

function BoardText({
  box,
  text,
  role = 'body',
  align = 'left',
  fill,
  viewportHeight,
  lines: maxLines = 3,
}: {
  box: Box;
  text: string;
  role?: string;
  align?: 'left' | 'center' | 'right';
  fill: string;
  viewportHeight: number;
  lines?: number;
}) {
  const size = viewportHeight * (ROLE_SCALE[role] ?? 0.034);
  const perLine = Math.max(Math.floor(box.w / (size * 0.5)), 6);
  const lines = wrap(text, perLine, maxLines);
  const x = align === 'center' ? box.x + box.w / 2 : align === 'right' ? box.x + box.w : box.x;
  const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';

  return (
    <text
      x={x}
      y={box.y + size}
      textAnchor={anchor}
      className={cn('font-hand', fill)}
      style={{ fontSize: size }}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : size * 1.22}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function wrap(text: string, perLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > perLine && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    } else {
      current = candidate;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1] ?? '';
    const consumed = lines.join(' ').length;
    if (consumed < text.trim().length) lines[maxLines - 1] = `${last.slice(0, Math.max(perLine - 1, 1))}…`;
  }
  return lines.length ? lines : [''];
}

/* ------------------------------------------------------------------- shapes */

function WobblyRect({
  box,
  rand,
  stroke,
  weight,
  dashed = false,
  fill,
}: {
  box: Box;
  rand: () => number;
  stroke: string;
  weight: number;
  dashed?: boolean;
  fill?: string;
}) {
  const amp = Math.max(Math.min(box.w, box.h) * 0.012, 1);
  const corners = [
    [
      { x: box.x, y: box.y },
      { x: box.x + box.w, y: box.y },
    ],
    [
      { x: box.x + box.w, y: box.y },
      { x: box.x + box.w, y: box.y + box.h },
    ],
    [
      { x: box.x + box.w, y: box.y + box.h },
      { x: box.x, y: box.y + box.h },
    ],
    [
      { x: box.x, y: box.y + box.h },
      { x: box.x, y: box.y },
    ],
  ] as const;

  return (
    <>
      {fill ? (
        <rect
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          className={fill}
          opacity={0.1}
          rx={Math.min(box.w, box.h) * 0.04}
        />
      ) : null}
      {corners.map(([a, b], i) => (
        <path
          key={i}
          d={inkStrokePath(rand, a, b, { amplitude: amp })}
          className={stroke}
          fill="none"
          strokeWidth={weight}
          strokeLinecap="round"
          strokeDasharray={dashed ? `${weight * 4} ${weight * 3}` : undefined}
        />
      ))}
    </>
  );
}

function BoardShape({
  el,
  rand,
  stroke,
  fill,
  weight,
}: {
  el: Extract<SceneElement, { type: 'shape' }>;
  rand: () => number;
  stroke: string;
  fill: string;
  weight: number;
}) {
  const box = el.at;
  const filled = el.fill ? fill : undefined;

  switch (el.shape) {
    case 'rect':
      return <WobblyRect box={box} rand={rand} stroke={stroke} weight={weight} fill={filled} />;

    case 'ellipse':
    case 'circle-highlight':
      return (
        <path
          d={inkCirclePath(
            rand,
            { cx: box.x + box.w / 2, cy: box.y + box.h / 2, rx: box.w / 2, ry: box.h / 2 },
            { amplitude: Math.max(Math.min(box.w, box.h) * 0.03, 2) },
          )}
          className={stroke}
          fill="none"
          strokeWidth={el.shape === 'circle-highlight' ? weight * 1.3 : weight}
          strokeLinecap="round"
        />
      );

    case 'bracket': {
      const lip = box.w * 0.4;
      return (
        <>
          <path
            d={inkStrokePath(rand, { x: box.x, y: box.y }, { x: box.x, y: box.y + box.h }, { amplitude: box.w * 0.03 })}
            className={stroke}
            fill="none"
            strokeWidth={weight}
            strokeLinecap="round"
          />
          <path
            d={inkStrokePath(rand, { x: box.x, y: box.y }, { x: box.x + lip, y: box.y }, { segments: 2, amplitude: 1 })}
            className={stroke}
            fill="none"
            strokeWidth={weight}
            strokeLinecap="round"
          />
          <path
            d={inkStrokePath(
              rand,
              { x: box.x, y: box.y + box.h },
              { x: box.x + lip, y: box.y + box.h },
              { segments: 2, amplitude: 1 },
            )}
            className={stroke}
            fill="none"
            strokeWidth={weight}
            strokeLinecap="round"
          />
        </>
      );
    }

    case 'underline':
    case 'line':
    default: {
      const y = el.shape === 'underline' ? box.y + box.h : box.y + box.h / 2;
      return (
        <path
          d={inkStrokePath(rand, { x: box.x, y }, { x: box.x + box.w, y }, { amplitude: Math.max(box.h * 0.06, 1.5) })}
          className={stroke}
          fill="none"
          strokeWidth={el.shape === 'underline' ? weight * 1.5 : weight}
          strokeLinecap="round"
        />
      );
    }
  }
}

function BoardArrow({
  el,
  rand,
  stroke,
  weight,
}: {
  el: Extract<SceneElement, { type: 'arrow' }>;
  rand: () => number;
  stroke: string;
  weight: number;
}) {
  const { from, to } = el;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const curve = el.curve ?? 0.2;
  // Control point pushed perpendicular to the chord, which is what `curve` means.
  const mx = (from.x + to.x) / 2 - (dy / len) * len * curve * 0.5;
  const my = (from.y + to.y) / 2 + (dx / len) * len * curve * 0.5;

  const head = len * 0.12;
  const angle = Math.atan2(to.y - my, to.x - mx);
  const wing = (offset: number) => ({
    x: to.x - Math.cos(angle - offset) * head,
    y: to.y - Math.sin(angle - offset) * head,
  });

  return (
    <>
      <path
        d={`M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`}
        className={stroke}
        fill="none"
        strokeWidth={weight}
        strokeLinecap="round"
      />
      <path
        d={inkStrokePath(rand, wing(0.5), to, { segments: 2, amplitude: 1 })}
        className={stroke}
        fill="none"
        strokeWidth={weight}
        strokeLinecap="round"
      />
      <path
        d={inkStrokePath(rand, wing(-0.5), to, { segments: 2, amplitude: 1 })}
        className={stroke}
        fill="none"
        strokeWidth={weight}
        strokeLinecap="round"
      />
    </>
  );
}

/* ----------------------------------------------------------------- diagrams */

function BoardDiagram({
  el,
  rand,
  stroke,
  fill,
  weight,
  viewportHeight,
}: {
  el: Extract<SceneElement, { type: 'diagram' }>;
  rand: () => number;
  stroke: string;
  fill: string;
  weight: number;
  viewportHeight: number;
}) {
  const nodes = el.nodes ?? [];
  if (!nodes.length) return null;
  const boxes = layoutNodes(el.layout, nodes.length, el.at);
  const byId = new Map(nodes.map((n, i) => [n.id, boxes[i] ?? el.at]));

  return (
    <>
      {(el.edges ?? []).map((edge, i) => {
        const a = byId.get(edge.from);
        const b = byId.get(edge.to);
        if (!a || !b) return null;
        return (
          <path
            key={`${edge.from}-${edge.to}-${i}`}
            d={inkStrokePath(
              rand,
              { x: a.x + a.w / 2, y: a.y + a.h / 2 },
              { x: b.x + b.w / 2, y: b.y + b.h / 2 },
              { amplitude: 2 },
            )}
            className={stroke}
            fill="none"
            strokeWidth={weight * 0.9}
            strokeLinecap="round"
            opacity={0.75}
          />
        );
      })}
      {nodes.map((node, i) => {
        const box = boxes[i];
        if (!box) return null;
        return (
          <g key={node.id}>
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx={box.h * 0.18}
              className="fill-paper"
            />
            <WobblyRect box={box} rand={rand} stroke={stroke} weight={weight} />
            <BoardText
              box={{ ...box, y: box.y + box.h * 0.24 }}
              text={node.label}
              role="label"
              align="center"
              fill={fill}
              viewportHeight={viewportHeight}
              lines={2}
            />
          </g>
        );
      })}
    </>
  );
}

function layoutNodes(layout: string, count: number, area: Box): Box[] {
  const gap = 0.16;
  if (layout === 'tree' || layout === 'stack') {
    const h = area.h / (count + (count - 1) * gap);
    return Array.from({ length: count }, (_u, i) => ({
      x: area.x + area.w * 0.15,
      y: area.y + i * h * (1 + gap),
      w: area.w * 0.7,
      h,
    }));
  }
  if (layout === 'grid' || layout === 'graph') {
    const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
    const rows = Math.max(1, Math.ceil(count / cols));
    const w = area.w / (cols + (cols - 1) * gap);
    const h = area.h / (rows + (rows - 1) * gap);
    return Array.from({ length: count }, (_u, i) => ({
      x: area.x + (i % cols) * w * (1 + gap),
      y: area.y + Math.floor(i / cols) * h * (1 + gap),
      w,
      h,
    }));
  }
  // flow and sequence read left to right.
  const w = area.w / (count + (count - 1) * gap);
  return Array.from({ length: count }, (_u, i) => ({
    x: area.x + i * w * (1 + gap),
    y: area.y + area.h * 0.25,
    w,
    h: Math.min(area.h * 0.5, w * 0.7),
  }));
}
