#!/usr/bin/env node
/**
 * `inkcast` / `cast` launcher.
 *
 * The workspace runs TypeScript sources directly, so this shim re-execs the real
 * entry point through tsx (a declared dependency of this package). It forwards
 * stdio — which is what makes `cat notes.md | cast -` work — and propagates the
 * child's exit code and signals unchanged, so the documented exit codes
 * (0 ok / 1 failed / 2 bad usage) survive the extra hop.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const args = process.argv.slice(2);

let tsxCli;
try {
  tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
} catch {
  process.stderr.write(
    'inkcast: cannot find tsx, so the TypeScript entry point cannot run.\n' +
      '         Run `pnpm install` at the repo root and try again.\n',
  );
  process.exit(1);
}

const child = spawn(process.execPath, [tsxCli, entry, ...args], {
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (err) => {
  process.stderr.write(`inkcast: failed to start (${err.message})\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
