/**
 * Test fixtures. Every test runs against a throwaway directory and an explicit
 * `env` object, so nothing here can touch the developer's real vault, real
 * keychain, or real `~/.inkcast`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { KeyvaultOptions } from '../src/index.js';

/** Realistic-looking but fake credentials, one per supported format. */
export const FAKE = {
  anthropic: 'sk-ant-api03-Aa0bCc1dEe2fGg3hIi4jKk5lMm6nOo7pQq8rSs9tUu0vWw1xYy2zZz3-AbCdEf',
  elevenlabs: 'sk_a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718',
  elevenlabsLegacy: '9f8e7d6c5b4a39281706f5e4d3c2b1a0',
  replicate: 'r8_AbCdEf0123456789GhIjKlMnOpQrStUvWx',
  fal: '7b2f4c1a-8d3e-4f5a-9b6c-0d1e2f3a4b5c:9a8b7c6d5e4f30291a2b3c4d5e6f7081',
  huggingface: 'hf_AbCdEfGhIjKlMnOpQrStUvWxYz012345',
  github: 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
  openai: 'sk-Aa0bCc1dEe2fGg3hIi4jKk5lMm6nOo7p',
} as const;

export type Sandbox = {
  dir: string;
  vaultPath: string;
  metaPath: string;
  /** Base options that pin every path and start from a clean environment. */
  opts(extra?: Partial<KeyvaultOptions>): KeyvaultOptions;
  cleanup(): void;
};

/**
 * A sandbox with the vault backend forced on, so the same assertions run
 * identically on macOS and Linux CI.
 */
export function sandbox(env: NodeJS.ProcessEnv = {}): Sandbox {
  const dir = mkdtempSync(path.join(tmpdir(), 'inkcast-keyvault-'));
  const vaultPath = path.join(dir, 'vault.json');
  const metaPath = path.join(dir, 'keyvault-meta.json');
  return {
    dir,
    vaultPath,
    metaPath,
    opts: (extra = {}) => ({
      backend: 'vault',
      vaultPath,
      metaPath,
      passphrase: 'correct horse battery staple',
      // An empty env by default: no ambient ANTHROPIC_API_KEY can influence a test.
      env: { ...env },
      // Do not pollute the process-wide tracked-secret table from a unit test.
      track: false,
      ...extra,
    }),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
