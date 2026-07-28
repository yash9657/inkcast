/**
 * Ambient declarations for the two libraries we import by non-default subpath.
 *
 * `roughjs` has no `exports` map, so the bare specifier resolves to its CJS
 * bundle in Node ESM; the working import is the explicit ESM subpath
 * `roughjs/bundled/rough.esm.js`, which ships no adjacent `.d.ts`. Declaring
 * exactly the surface we use here keeps the package type-safe without pinning
 * ourselves to roughjs's internal type layout.
 *
 * Only the members actually called are declared — anything else should be added
 * deliberately.
 */

declare module 'roughjs/bundled/rough.esm.js' {
  export interface RoughOptions {
    seed?: number;
    /** Must be set to `undefined` on every call: roughjs memoises its RNG. */
    randomizer?: unknown;
    roughness?: number;
    bowing?: number;
    stroke?: string;
    strokeWidth?: number;
    fill?: string;
    fillStyle?: string;
    fillWeight?: number;
    hachureAngle?: number;
    hachureGap?: number;
    curveStepCount?: number;
    curveFitting?: number;
    curveTightness?: number;
    simplification?: number;
    disableMultiStroke?: boolean;
    disableMultiStrokeFill?: boolean;
    preserveVertices?: boolean;
    maxRandomnessOffset?: number;
    strokeLineDash?: number[];
    fillLineDash?: number[];
  }

  export interface RoughOp {
    op: 'move' | 'lineTo' | 'bcurveTo';
    data: number[];
  }
  export interface RoughOpSet {
    type: 'path' | 'fillPath' | 'fillSketch';
    ops: RoughOp[];
    size?: [number, number];
    path?: string;
  }
  export interface Drawable {
    shape: string;
    options: RoughOptions;
    sets: RoughOpSet[];
  }
  export interface RoughPathInfo {
    d: string;
    stroke: string;
    strokeWidth: number;
    fill: string;
  }

  export type RoughPoint = [number, number];

  export interface RoughGenerator {
    line(x1: number, y1: number, x2: number, y2: number, options?: RoughOptions): Drawable;
    rectangle(x: number, y: number, w: number, h: number, options?: RoughOptions): Drawable;
    ellipse(x: number, y: number, w: number, h: number, options?: RoughOptions): Drawable;
    circle(x: number, y: number, diameter: number, options?: RoughOptions): Drawable;
    linearPath(points: RoughPoint[], options?: RoughOptions): Drawable;
    polygon(points: RoughPoint[], options?: RoughOptions): Drawable;
    curve(points: RoughPoint[], options?: RoughOptions): Drawable;
    arc(
      x: number,
      y: number,
      width: number,
      height: number,
      start: number,
      stop: number,
      closed?: boolean,
      options?: RoughOptions,
    ): Drawable;
    path(d: string, options?: RoughOptions): Drawable;
    toPaths(drawable: Drawable): RoughPathInfo[];
    opsToPath(drawing: RoughOpSet): string;
    defaultOptions: RoughOptions;
  }

  export interface RoughApi {
    generator(config?: { options?: RoughOptions }): RoughGenerator;
  }
  /**
   * `roughjs` declares no `"type": "module"`, so whether a loader hands back the
   * API object or an ESM namespace wrapping it under `.default` depends on the
   * loader. Both shapes are declared; `geometry.ts` unwraps.
   */
  const rough: RoughApi & { default?: RoughApi };
  export default rough;
}

declare module '@dagrejs/dagre' {
  export interface GraphLabel {
    rankdir?: 'TB' | 'BT' | 'LR' | 'RL';
    align?: 'UL' | 'UR' | 'DL' | 'DR';
    nodesep?: number;
    ranksep?: number;
    edgesep?: number;
    marginx?: number;
    marginy?: number;
    ranker?: 'network-simplex' | 'tight-tree' | 'longest-path';
    acyclicer?: 'greedy';
    width?: number;
    height?: number;
  }
  export interface NodeLabel {
    width: number;
    height: number;
    x: number;
    y: number;
    [k: string]: unknown;
  }
  export interface EdgeLabel {
    points?: Array<{ x: number; y: number }>;
    [k: string]: unknown;
  }
  export class Graph {
    constructor(opts?: { directed?: boolean; multigraph?: boolean; compound?: boolean });
    setGraph(label: GraphLabel): this;
    graph(): GraphLabel;
    setDefaultEdgeLabel(fn: () => object): this;
    setNode(id: string, label: Partial<NodeLabel>): this;
    node(id: string): NodeLabel | undefined;
    hasNode(id: string): boolean;
    setEdge(from: string, to: string, label?: object): this;
    edge(from: string, to: string): EdgeLabel | undefined;
    nodes(): string[];
    edges(): Array<{ v: string; w: string }>;
  }
  export const graphlib: { Graph: typeof Graph };
  export function layout(g: Graph): void;
  /**
   * The package ships both a CJS and an ESM build. Depending on the loader, the
   * namespace either carries the named exports directly or nests the whole API
   * under `default`; `diagram.ts` unwraps whichever it gets.
   */
  export interface DagreApi {
    graphlib: { Graph: typeof Graph };
    layout(g: Graph): void;
  }
  const dagre: DagreApi;
  export default dagre;
}
