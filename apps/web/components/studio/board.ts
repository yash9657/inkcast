/**
 * Client-safe derivations over the Storyboard IR.
 *
 * `@inkcast/core` exports the same `totalDuration`/`sceneOffsets` maths, but its
 * barrel also re-exports `project.ts`, which imports `node:fs` and
 * `node:crypto` — importing it at runtime in a browser bundle fails the build.
 * So the two derivations are mirrored here, deliberately and identically, while
 * the *types* still come from core so the shape can never drift.
 */
import type { Storyboard } from '@inkcast/core';

export type Scene = Storyboard['scenes'][number];
export type SceneElement = Scene['elements'][number];
export type BoardAsset = Storyboard['assets'][number];
export type Box = SceneElement['at'];

/** Total runtime, once the voice stage has measured every scene. */
export function totalDuration(sb: Storyboard): number {
  const scenes = sb.scenes.reduce((acc, s) => acc + (s.durationSec ?? 0), 0);
  return scenes + (sb.meta?.outroSec ?? 0);
}

/** Absolute start time of each scene, in seconds. */
export function sceneOffsets(sb: Storyboard): number[] {
  const offsets: number[] = [];
  let t = 0;
  for (const s of sb.scenes) {
    offsets.push(t);
    t += s.durationSec ?? 0;
  }
  return offsets;
}

/** True once the voice stage has measured at least one scene. */
export function isMeasured(sb: Storyboard): boolean {
  return sb.scenes.some((s) => typeof s.durationSec === 'number' && s.durationSec > 0);
}

export type BoardElement = {
  element: SceneElement;
  /** False when the element was drawn by an earlier scene and persisted. */
  own: boolean;
  /** Index of the scene that introduced it. */
  from: number;
};

/**
 * Everything on the board during scene `index`: this scene's elements, plus
 * every element an earlier scene left behind. This is the persistent canvas the
 * IR was built around — the board grows, it never wipes.
 */
export function visibleElements(sb: Storyboard, index: number): BoardElement[] {
  const out: BoardElement[] = [];
  const seen = new Set<string>();
  for (let i = 0; i <= index && i < sb.scenes.length; i += 1) {
    const scene = sb.scenes[i];
    if (!scene) continue;
    for (const element of scene.elements ?? []) {
      const persists = element.persist !== false;
      if (i < index && !persists) continue;
      if (seen.has(element.id)) continue;
      seen.add(element.id);
      out.push({ element, own: i === index, from: i });
    }
  }
  return out;
}

export function findAsset(sb: Storyboard, assetId: string): BoardAsset | undefined {
  return sb.assets?.find((a) => a.id === assetId);
}

/** How many entities the visuals stage has actually resolved to vectors. */
export function resolvedAssetCount(sb: Storyboard): number {
  return (sb.assets ?? []).filter((a) => typeof a.svg === 'string' && a.svg.length > 0).length;
}

/* -------------------------------------------------------------- descriptions */

export type ElementKind = SceneElement['type'];

/** A one-line, human description of an element for the inspector. */
export function describeElement(el: SceneElement): { kind: string; detail: string } {
  switch (el.type) {
    case 'text':
      return { kind: el.role === 'title' ? 'Title' : el.role === 'heading' ? 'Heading' : 'Text', detail: el.text };
    case 'asset':
      return { kind: 'Drawing', detail: el.assetId };
    case 'shape':
      return { kind: 'Shape', detail: el.shape.replace(/-/g, ' ') };
    case 'arrow':
      return { kind: 'Arrow', detail: el.label ?? `${round(el.from.x)},${round(el.from.y)} → ${round(el.to.x)},${round(el.to.y)}` };
    case 'diagram':
      return {
        kind: 'Diagram',
        detail: `${el.layout} · ${el.nodes.length} node${el.nodes.length === 1 ? '' : 's'}${
          el.edges.length ? `, ${el.edges.length} edge${el.edges.length === 1 ? '' : 's'}` : ''
        }`,
      };
    case 'emphasis':
      return { kind: 'Emphasis', detail: `${el.effect.replace(/-/g, ' ')} on ${el.targetId}` };
    default:
      return { kind: 'Element', detail: '' };
  }
}

/** `writes in at 40%` — how and when an element arrives. */
export function describeEnter(el: SceneElement): string {
  const enter = el.enter ?? { at: 0, duration: 0.8, style: 'draw' as const };
  const at = Math.round((enter.at ?? 0) * 100);
  const verb =
    enter.style === 'write'
      ? 'writes in'
      : enter.style === 'draw'
        ? 'draws in'
        : enter.style === 'fade'
          ? 'fades in'
          : enter.style === 'pop'
            ? 'pops in'
            : 'grows in';
  return at === 0 ? `${verb} at the start` : `${verb} at ${at}%`;
}

function round(n: number): number {
  return Math.round(n);
}

/** The camera move into a scene, in words. */
export function describeCamera(scene: Scene, previous: Scene | undefined): string {
  const cam = scene.camera;
  if (!previous) return cam.zoom > 1 ? `opens at ${cam.zoom.toFixed(1)}× zoom` : 'opens on the whole board';
  const prev = previous.camera;
  const moved = Math.hypot(cam.x - prev.x, cam.y - prev.y) > 1;
  const zoomed = Math.abs(cam.zoom - prev.zoom) > 0.01;
  if (!moved && !zoomed) return 'camera holds';
  const parts: string[] = [];
  if (moved) parts.push('pans');
  if (zoomed) parts.push(cam.zoom > prev.zoom ? 'zooms in' : 'zooms out');
  const how = cam.transition === 0 ? 'cuts' : `${parts.join(' and ')} over ${cam.transition.toFixed(1)}s`;
  return `camera ${how}`;
}
