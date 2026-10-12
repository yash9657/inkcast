/**
 * Dispatch, exit codes, and the `keys` command against a real isolated vault.
 *
 * The CLI is spawned as a child process rather than called in-process. That is
 * not ceremony: `run()` writes straight to `process.stdout`, and capturing that
 * inside `node:test` would also swallow the runner's own TAP output — the first
 * version of this file silently lost most of its assertions that way. Spawning
 * also exercises the real entry point, including the env bootstrap that has to
 * happen before `@inkcast/core` loads.
 *
 * No stage runs here: every assertion is about argument handling, the help text
 * and credential storage, which are the parts a user hits before anything renders.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { usage } from '../src/usage.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../src/index.ts');
const ROOT = path.resolve(HERE, '../../..');

let home: string;
let projects: string;

type Run = { code: number; out: string; err: string };

/** Spawn the CLI with an isolated vault, no provider keys, and no colour. */
function cli(args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<Run> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    INKCAST_HOME: home,
    INKCAST_PROJECTS: projects,
    INKCAST_KEYVAULT_BACKEND: 'vault',
    INKCAST_VAULT_PASSPHRASE: 'test-passphrase-not-a-secret',
    INKCAST_LOG: 'error',
    NO_COLOR: '1',
  };
  // Scrub inherited provider keys first, so `extraEnv` can deliberately put one
  // back for the precedence test.
  for (const name of [
    'ANTHROPIC_API_KEY',
    'ELEVENLABS_API_KEY',
    'REPLICATE_API_TOKEN',
    'FAL_KEY',
    'FAL_API_KEY',
  ]) {
    delete env[name];
  }
  Object.assign(env, extraEnv);

  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', CLI, ...args],
      { cwd: ROOT, env, timeout: 60_000 },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === 'number'
            ? (err as { code: number }).code
            : err
              ? 1
              : 0;
        resolve({ code, out: stdout, err: stderr });
      },
    );
  });
}

before(async () => {
  // Outside the repo on purpose: the keyvault refuses to write inside a git tree.
  home = await mkdtemp(path.join(tmpdir(), 'inkcast-home-'));
  projects = await mkdtemp(path.join(tmpdir(), 'inkcast-projects-'));
});

after(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(projects, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ the help */

test('the help text leads with a key and the teach command', () => {
  const text = usage(false);
  assert.match(text, /inkcast keys set fireworks/);
  assert.match(text, /inkcast teach/);
  assert.match(text, /ingest → lesson → storyboard → voice → visuals → render/);
  // Do not repeat the MVP's headline claim.
  assert.doesNotMatch(text, /\$0\.00\/min/);
  for (const flag of ['--short', '--depth', '--aspect', '--voice', '--style', '--lesson']) {
    assert.ok(text.includes(flag), `${flag} must be documented`);
  }
});

/* ---------------------------------------------------------------- dispatch */

test('exit codes: help 0, no arguments 2, unknown flag 2', async () => {
  assert.equal((await cli(['help'])).code, 0);
  assert.equal((await cli(['--version'])).code, 0);

  const bare = await cli([]);
  assert.equal(bare.code, 2);
  assert.match(bare.out, /USAGE/);

  const bad = await cli(['--nonsense']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /usage:/);
});

test('teach with no topic is a usage error, not a crash', async () => {
  const res = await cli(['teach']);
  assert.equal(res.code, 2);
  assert.match(res.err, /what should I teach\?/);
});

test('a bad enum value is reported before any work starts', async () => {
  const res = await cli(['teach', 'entropy', '--depth', 'exhaustive']);
  assert.equal(res.code, 2);
  assert.match(res.err, /--depth must be one of/);
});

test('a subcommand name still wins over a topic of the same word', async () => {
  const res = await cli(['list', '--json']);
  assert.equal(res.code, 0);
  assert.deepEqual(JSON.parse(res.out), []);
});

test('providers reports the stages in pipeline order and how to upgrade them', async () => {
  const res = await cli(['providers', '--json']);
  assert.equal(res.code, 0);
  const parsed = JSON.parse(res.out) as {
    local: boolean;
    degraded: Array<{ stage: string; fix: string }>;
  };
  assert.equal(parsed.local, true);
  const lesson = parsed.degraded.find((d) => d.stage === 'lesson');
  assert.equal(lesson?.fix, 'inkcast keys set fireworks');
});

/* -------------------------------------------------------------------- keys */

test('keys list reports every provider and where a key would come from', async () => {
  const res = await cli(['keys', 'list', '--json']);
  assert.equal(res.code, 0);
  const parsed = JSON.parse(res.out) as {
    backend: { backend: string };
    providers: Array<{ provider: string; configured: boolean }>;
  };
  assert.equal(parsed.backend.backend, 'vault');
  assert.deepEqual(
    parsed.providers.map((p) => p.provider),
    ['fireworks', 'anthropic', 'elevenlabs', 'replicate', 'fal'],
  );
  assert.ok(parsed.providers.every((p) => !p.configured));
});

test('keys validate with nothing configured succeeds and says what to do', async () => {
  // Runs before anything is stored, so it never makes a network call.
  const res = await cli(['keys', 'validate']);
  assert.equal(res.code, 0);
  assert.match(res.out, /inkcast keys set fireworks/);
});

test('keys set stores a key, list masks it, delete removes it', async () => {
  const key = 'sk-ant-test-0123456789abcdef';
  const set = await cli(['keys', 'set', 'anthropic', key, '--json']);
  assert.equal(set.code, 0);
  assert.ok(!set.out.includes(key), 'a raw key must never be printed');

  const list = await cli(['keys', 'list', '--json']);
  const anthropic = (
    JSON.parse(list.out) as {
      providers: Array<{
        provider: string;
        configured: boolean;
        masked: string | null;
        source: string | null;
      }>;
    }
  ).providers.find((p) => p.provider === 'anthropic')!;
  assert.equal(anthropic.configured, true);
  assert.equal(anthropic.source, 'vault');
  assert.ok(anthropic.masked && !anthropic.masked.includes('0123456789'));

  // A stored key must actually reach the stages, which read the environment.
  const providers = await cli(['providers', '--json']);
  const parsed = JSON.parse(providers.out) as { providers: { planner: { name: string } } };
  assert.equal(parsed.providers.planner.name, 'anthropic');

  const del = await cli(['keys', 'delete', 'anthropic', '--json']);
  assert.equal(del.code, 0);
  assert.equal((JSON.parse(del.out) as { removed: boolean }).removed, true);

  const afterDelete = await cli(['keys', 'list', '--json']);
  const gone = (
    JSON.parse(afterDelete.out) as { providers: Array<{ provider: string; configured: boolean }> }
  ).providers.find((p) => p.provider === 'anthropic')!;
  assert.equal(gone.configured, false);
});

test('a stored key is reported as winning over an environment one', async () => {
  await cli(['keys', 'set', 'elevenlabs', 'el-stored-key-abcdef', '--json']);
  try {
    const res = await cli(['keys', 'list', '--json'], { ELEVENLABS_API_KEY: 'el-env-key-123456' });
    const el = (
      JSON.parse(res.out) as {
        providers: Array<{
          provider: string;
          source: string | null;
          masked: string | null;
          overridesEnv: boolean;
        }>;
      }
    ).providers.find((p) => p.provider === 'elevenlabs')!;
    // The pasted key is the deliberate one and must be the one in use — and
    // silent shadowing is the worst outcome, so the listing must name both the
    // winner and the fact that the exported variable is being ignored.
    assert.notEqual(el.source, 'env');
    assert.equal(el.overridesEnv, true);
    assert.ok(el.masked !== null, 'a preview of the winning key is shown');
  } finally {
    // Leave no key behind: a later `validate` would try to use it.
    await cli(['keys', 'delete', 'elevenlabs', '--json']);
  }
});

test('keys rejects an unknown action and an unknown provider', async () => {
  const action = await cli(['keys', 'rotate']);
  assert.equal(action.code, 2);
  assert.match(action.err, /unknown `keys` action/);

  const provider = await cli(['keys', 'set', 'openai', 'sk-x']);
  assert.equal(provider.code, 2);
  assert.match(provider.err, /unknown provider/);

  const missing = await cli(['keys', 'delete']);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /which provider\?/);
});

/* ----------------------------------------------------------------- lesson */

test('lesson on an unknown project fails with a handled error, not a stack trace', async () => {
  const res = await cli(['lesson', 'nope']);
  assert.equal(res.code, 1);
  assert.match(`${res.out}${res.err}`, /no projects yet|no project/i);
  assert.doesNotMatch(res.err, /at Object\./, 'a handled failure must not print a stack');
});
