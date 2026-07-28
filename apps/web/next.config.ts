import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * `next` is always launched with its cwd set to this directory, so deriving the
 * monorepo root from `process.cwd()` is stable under both `next dev` and
 * `next build` (and avoids `import.meta.url`, which is unreliable inside the
 * config loader).
 */
const repoRoot = path.resolve(process.cwd(), '..', '..');

/*
 * ## Why the scripts pass `--webpack`
 *
 * Turbopack cannot compile this workspace, and the reason is structural rather
 * than a bug to wait out. The packages are Node ESM, so every relative import
 * inside them carries the `.js` extension the spec requires — `export * from
 * './storyboard.js'` in a file that is really `storyboard.ts`. `tsc` performs
 * that substitution; Turbopack does not, and offers no setting that makes it,
 * so a Turbopack build fails on every relative import in `@inkcast/core`.
 *
 * Webpack has `resolve.extensionAlias`, surfaced by Next as
 * `experimental.extensionAlias` below, which expresses exactly this mapping. The
 * alternative would be dropping the `.js` extensions, which breaks Node ESM and
 * the `dist/` output of every package's `build` script — a worse trade than
 * choosing the resolver that can do the job.
 */

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * The workspace ships TypeScript sources rather than built `dist/` output
   * (see docs/CONTRACT.md, "Package conventions"), so Next has to compile them
   * itself instead of treating them as pre-built CJS/ESM.
   *
   * All six are listed, not just the two the app imports by name. `@inkcast/pipeline`
   * reaches the four stage packages through `import('@inkcast/planner')` and
   * friends in `packages/pipeline/src/stages.ts`; those are real edges in the
   * module graph, so their TypeScript has to be compiled too or every render
   * fails at request time with a module-resolution error.
   */
  transpilePackages: [
    '@inkcast/core',
    '@inkcast/pipeline',
    '@inkcast/planner',
    '@inkcast/render',
    '@inkcast/visuals',
    '@inkcast/voice',
  ],

  /**
   * Bundling these would break them. They are not slow-to-compile niceties —
   * each one has to stay a real `node_modules` package at runtime:
   *
   *  - `playwright` launches a browser and resolves its own driver and browser
   *    revisions from its package directory.
   *  - `kokoro-js` → `@huggingface/transformers` → `onnxruntime-node` loads
   *    `.node` binaries and `sharp` is a native addon; webpack cannot inline
   *    either, and both need their own file layout intact.
   *  - `lucide-static` is located with `createRequire(...).resolve()` and read as
   *    ~2000 files off disk, so it must exist as a directory, not as a chunk.
   *  - `@neplex/vectorizer` is an optional native module for the opt-in
   *    text-to-image lane.
   */
  serverExternalPackages: [
    '@huggingface/transformers',
    '@neplex/vectorizer',
    'kokoro-js',
    'lucide-static',
    'onnxruntime-node',
    'playwright',
    'sharp',
  ],

  /**
   * Both of these point Next at the monorepo root: file tracing needs it so
   * standalone output picks up hoisted pnpm dependencies, and Turbopack needs
   * it so the vendored fonts in `<root>/assets/fonts` resolve.
   */
  outputFileTracingRoot: repoRoot,

  experimental: {
    /**
     * Native View Transitions for same-document navigation. Progressive
     * enhancement only — a browser without support renders an ordinary
     * navigation, so nothing load-bearing may depend on it.
     */
    viewTransition: true,

    /**
     * The workspace packages are Node ESM, so every relative import inside them
     * carries the `.js` extension the spec requires — `export * from
     * './storyboard.js'` in a file that is actually `storyboard.ts`. `tsc`
     * substitutes the extension itself; Turbopack does not, and reports
     * `Can't resolve './storyboard.js'` for every one of them.
     *
     * This is the mapping that reconciles the two. Without it the whole of
     * `@inkcast/core` and `@inkcast/pipeline` is unresolvable from the studio.
     */
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    },
  },

  // Rendered videos and generated frames are served straight from the project
  // directory on disk; nothing goes through the Image Optimizer.
  images: { unoptimized: true },

  // Long-running pipeline routes stream progress; never buffer them.
  poweredByHeader: false,
};

export default nextConfig;
