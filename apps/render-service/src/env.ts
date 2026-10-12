/**
 * Environment the workspace packages read at import time, set before any of them
 * load — the same reason `apps/cli/src/env.ts` exists.
 *
 * `@inkcast/core` captures `INKCAST_PROJECTS` once, at module load, so it has to
 * point somewhere writable first. A Vercel container has no persistent disk; the
 * projects root and the machine-wide state (`INKCAST_HOME`: the generated-asset
 * cache) go under `/tmp`, live as long as the instance, and are never relied on
 * between requests. Nothing here overrides a value that is already set.
 */

import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKERS = ['pnpm-workspace.yaml', 'tsconfig.base.json'];

export function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (MARKERS.every((m) => existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

export function bootstrapEnv(env: NodeJS.ProcessEnv = process.env): void {
  const scratch = path.join(tmpdir(), 'inkcast');
  env.INKCAST_PROJECTS ??= path.join(scratch, 'projects');
  env.INKCAST_HOME ??= path.join(scratch, 'state');
  env.INKCAST_STORAGE ??= 'blob';
  // A container renders one film per instance (see server.ts); two capture
  // workers keep a 1080p render inside 4 GB with headroom on 2 vCPU.
  env.INKCAST_RENDER_WORKERS ??= '2';
}
