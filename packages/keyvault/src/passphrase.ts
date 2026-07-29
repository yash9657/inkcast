/**
 * Resolving the vault passphrase, and reading one without echoing it.
 *
 * Precedence is explicit → environment → file → interactive prompt, which is the
 * order that lets the same code serve a developer at a terminal and a CI job
 * with no TTY. The file form exists because a passphrase in an environment
 * variable is visible in `/proc`, in `docker inspect`, and in any crash dump
 * that includes the environment — a mounted secret file is the better shape for
 * a runner that supports it.
 */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { KeyvaultError } from './errors.js';
import { trackSecret } from './redact.js';

export type PassphraseOptions = {
  /** Supplied directly by the caller — highest precedence. */
  passphrase?: string;
  env?: NodeJS.ProcessEnv;
  /** Allow a TTY prompt. Off for library calls that must never block. */
  interactive?: boolean;
  /** Prompt text, when interactive. */
  prompt?: string;
};

/**
 * Read a secret from the terminal without echoing it.
 *
 * Node's readline has no supported "no echo" mode, so the prompt is written
 * directly and `_writeToOutput` is neutralised for the duration — the standard
 * approach, guarded so that a future readline change degrades to a visible
 * prompt rather than a crash. Exported because the CLI and studio need exactly
 * this to collect a key without putting it in shell history.
 */
export function promptSecret(prompt: string): Promise<string> {
  const input = process.stdin;
  const output = process.stdout;
  if (!input.isTTY) {
    return Promise.reject(
      new KeyvaultError('passphrase-required', 'cannot prompt for a secret: stdin is not a TTY'),
    );
  }

  return new Promise((resolve, reject) => {
    const rl = createInterface({ input, output, terminal: true });
    output.write(prompt);
    const muted = rl as unknown as { _writeToOutput?: (s: string) => void };
    const restore = muted._writeToOutput;
    try {
      muted._writeToOutput = () => {};
    } catch {
      // Visible input beats no input; the caller was asking a human.
    }
    rl.question('', (answer) => {
      if (restore) muted._writeToOutput = restore;
      output.write('\n');
      rl.close();
      const value = answer.trim();
      if (value.length === 0) {
        reject(new KeyvaultError('passphrase-required', 'no value entered'));
        return;
      }
      resolve(value);
    });
    rl.on('SIGINT', () => {
      if (restore) muted._writeToOutput = restore;
      output.write('\n');
      rl.close();
      reject(new KeyvaultError('passphrase-required', 'cancelled'));
    });
  });
}

const MISSING_HINT =
  'Set INKCAST_VAULT_PASSPHRASE (or INKCAST_VAULT_PASSPHRASE_FILE), or run the command in a terminal ' +
  'so it can prompt. On macOS you can skip the passphrase entirely — the OS keychain is used by default.';

/**
 * Find the passphrase, or explain precisely what to set.
 *
 * Never returns an empty string: an empty passphrase would derive a real key and
 * silently produce a vault that anyone can open.
 */
export async function resolvePassphrase(opts: PassphraseOptions = {}): Promise<string> {
  const env = opts.env ?? process.env;

  const direct = opts.passphrase?.trim();
  if (direct) {
    trackSecret(direct);
    return direct;
  }

  const fromEnv = env.INKCAST_VAULT_PASSPHRASE?.trim();
  if (fromEnv) {
    trackSecret(fromEnv);
    return fromEnv;
  }

  const file = env.INKCAST_VAULT_PASSPHRASE_FILE?.trim();
  if (file) {
    let contents: string;
    try {
      contents = readFileSync(file, 'utf8');
    } catch (cause) {
      throw new KeyvaultError(
        'passphrase-required',
        `cannot read INKCAST_VAULT_PASSPHRASE_FILE at ${file}`,
        { cause },
      );
    }
    // Strip only the trailing newline a writer or `echo` would add.
    const value = contents.replace(/\r?\n$/, '');
    if (value.length === 0) {
      throw new KeyvaultError('passphrase-required', `${file} is empty`, { hint: MISSING_HINT });
    }
    trackSecret(value);
    return value;
  }

  if (opts.interactive && process.stdin.isTTY) {
    const value = await promptSecret(opts.prompt ?? 'Inkcast vault passphrase: ');
    trackSecret(value);
    return value;
  }

  throw new KeyvaultError('passphrase-required', 'no vault passphrase available', {
    hint: MISSING_HINT,
  });
}

/** True when a passphrase could be resolved without prompting. */
export function passphraseAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.INKCAST_VAULT_PASSPHRASE?.trim() || env.INKCAST_VAULT_PASSPHRASE_FILE?.trim());
}
