/**
 * macOS Keychain backend, driven through `/usr/bin/security`.
 *
 * Preferred on darwin because it keeps the secret out of our files entirely: the
 * key is sealed by the login keychain, encrypted at rest by the OS, and this
 * package never has a plaintext copy on disk to leak, back up, or commit.
 *
 * The exact invocations below were verified against `/usr/bin/security` on
 * macOS 24.6 (Darwin), and three details are load-bearing:
 *
 *   - **The secret is fed on stdin, never in argv.** `-w <password>` works, and
 *     the tool's own usage text calls it insecure: argv is visible to `ps` for
 *     the same user and can be captured by process accounting. Passing `-w`
 *     *last with no value* makes `security` prompt instead.
 *   - **A prompt reads `/dev/tty`, not stdin — unless there is no tty to read.**
 *     This is the part an earlier version of this file got wrong, and it shipped:
 *     it claimed `security` "reads the prompt from stdin when stdin is a pipe".
 *     It does, but only when the process has **no controlling terminal**. Give it
 *     one and `readpassphrase(3)` opens `/dev/tty`, our pipe is ignored, and the
 *     write blocks until `TIMEOUT_MS` — which is exactly what the studio did when
 *     `next dev` was started from a terminal: `password data for new item:`
 *     appeared in the server's own log and saving a key failed with a 500 after
 *     15 seconds. So any invocation we feed is spawned `detached`, which calls
 *     `setsid(2)` and leaves the child with no controlling terminal, making our
 *     pipe the only thing that can answer. See `spawnOptions`.
 *   - **The password must be written twice.** The prompt is "password data for
 *     new item:" followed by "retype password for new item:". Supplying one line
 *     leaves the second read at EOF, both reads compare equal as empty, and
 *     `security` silently stores an **empty password** and exits 0. That is a
 *     data-loss trap with a success exit code, which is why `write()` sends
 *     `key\nkey\n` and `setKey()` reads the value back to confirm.
 *
 * Exit codes, also verified: 44 = item not found (both `find` and `delete`),
 * 45 = item already exists (only reachable without `-U`).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { logger } from '@inkcast/core';
import { KeyvaultError } from './errors.js';
import type { Provider } from './providers.js';
import { redact } from './redact.js';

const log = logger('keyvault:keychain');

const SECURITY = '/usr/bin/security';
const NOT_FOUND = 44;
/** Keychain access can block on an unlock prompt; do not hang a pipeline stage. */
const TIMEOUT_MS = 15_000;

/** Service name under which every Inkcast key is filed. */
export function keychainService(env: NodeJS.ProcessEnv = process.env): string {
  return env.INKCAST_KEYCHAIN_SERVICE ?? 'inkcast';
}

/** True when this platform can use the keychain at all. */
export function keychainAvailable(): boolean {
  return process.platform === 'darwin' && existsSync(SECURITY);
}

type Run = { code: number; stdout: string; stderr: string };

/**
 * How one `security` invocation is spawned, and the one option that is a fix.
 *
 * `detached` runs `setsid(2)`, so the child leads a new session with **no
 * controlling terminal**. That is not about backgrounding it — we still await it —
 * it is the only way to guarantee that a `-w` prompt is answered by the pipe we
 * wrote rather than by a terminal that happens to be attached to whatever started
 * us. See the header for the failure it removes.
 *
 * Applied only where we supply input. An invocation that prompts for nothing has
 * no race to lose, and leaving those attached means a locked-keychain prompt can
 * still reach the person at the keyboard.
 *
 * Exported because a round-trip test cannot see this: a test runner has no
 * controlling terminal either, so the broken version passed. The regression test
 * pins the option, not the behaviour it produces.
 */
export function spawnOptions(feedsStdin: boolean): {
  stdio: ['pipe', 'pipe', 'pipe'];
  detached: boolean;
} {
  return { stdio: ['pipe', 'pipe', 'pipe'], detached: feedsStdin };
}

/**
 * Run `security` with `args`, optionally writing `stdin`.
 *
 * Never rejects on a non-zero exit — callers need to distinguish 44 from a real
 * failure — but does reject if the binary cannot be spawned or times out.
 */
function run(args: string[], stdin?: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(SECURITY, args, spawnOptions(stdin !== undefined));
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(
        new KeyvaultError(
          'keychain-failed',
          `\`security ${args[0]}\` timed out after ${TIMEOUT_MS}ms`,
          {
            // Two causes, and the second one used to be ours. The hint names both,
            // because "unlock your keychain" is useless advice for a prompt that is
            // waiting on a terminal nobody is typing into.
            hint:
              'The login keychain may be locked and waiting on an unlock prompt — unlock it and ' +
              'retry. If the output above shows a `password data for new item:` prompt, the ' +
              'child had a controlling terminal and never read our input (see `spawnOptions`).',
          },
        ),
      );
    }, TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => (stdout += d));
    child.stderr.on('data', (d: string) => (stderr += d));

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new KeyvaultError('keychain-failed', `cannot run ${SECURITY}`, { cause: err }));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });

    if (stdin !== undefined) child.stdin.end(stdin, 'utf8');
    else child.stdin.end();
  });
}

/**
 * `security` echoes its prompts ("password data for new item:") to stdout/stderr
 * and quotes the keychain path on delete. None of that is useful and the prompt
 * text is confusing in a log, so failures report a trimmed, redacted tail.
 */
function failure(action: string, r: Run): KeyvaultError {
  const detail = redact(`${r.stderr}${r.stdout}`.trim()).slice(0, 300) || `exit ${r.code}`;
  return new KeyvaultError('keychain-failed', `keychain ${action} failed: ${detail}`);
}

/** Store (or replace) `key` for `provider`. */
export async function write(provider: Provider, key: string, service: string): Promise<void> {
  const r = await run(
    [
      'add-generic-password',
      // Update in place; without -U a second write exits 45.
      '-U',
      '-s',
      service,
      '-a',
      provider,
      '-D',
      'Inkcast API key',
      '-l',
      `Inkcast — ${provider}`,
      '-j',
      'Managed by @inkcast/keyvault. Safe to delete; Inkcast will fall back to its local provider.',
      // -w must be last, with no value: that is what makes `security` read the
      // secret from stdin instead of argv.
      '-w',
    ],
    // Twice: the tool prompts for the password and then for a confirmation.
    `${key}\n${key}\n`,
  );
  if (r.code !== 0) throw failure('write', r);
}

/** Read the key for `provider`, or `undefined` when there is no item. */
export async function read(provider: Provider, service: string): Promise<string | undefined> {
  const r = await run(['find-generic-password', '-s', service, '-a', provider, '-w']);
  if (r.code === NOT_FOUND) return undefined;
  if (r.code !== 0) throw failure('read', r);
  // `-w` prints the password followed by exactly one newline. Strip that one
  // terminator only — a trailing newline inside a stored secret would be our
  // own bug, but truncating a legitimate key with `.trim()` would be worse.
  return r.stdout.replace(/\r?\n$/, '');
}

/**
 * True when an item exists, without reading the secret.
 *
 * `find-generic-password` without `-w` prints attributes only, so a status
 * listing can answer "configured?" without the key ever entering this process.
 */
export async function has(provider: Provider, service: string): Promise<boolean> {
  const r = await run(['find-generic-password', '-s', service, '-a', provider]);
  if (r.code === NOT_FOUND) return false;
  if (r.code !== 0) throw failure('probe', r);
  return true;
}

/** Delete the item. Returns false when there was nothing to delete. */
export async function remove(provider: Provider, service: string): Promise<boolean> {
  const r = await run(['delete-generic-password', '-s', service, '-a', provider]);
  if (r.code === NOT_FOUND) return false;
  if (r.code !== 0) throw failure('delete', r);
  log.debug(`removed keychain item for ${provider}`);
  return true;
}
