/**
 * `inkcast keys` — bring-your-own-key setup, sharing one store with the studio.
 *
 * ```
 * inkcast keys                      what is configured, and where it lives
 * inkcast keys set anthropic        prompt for a key (never echoed, never logged)
 * inkcast keys validate             one cheap live call per configured provider
 * inkcast keys delete elevenlabs    forget it
 * ```
 *
 * Two rules this command exists to make visible:
 *
 *  - **A stored key wins.** The key you deliberately saved beats an exported
 *    `ANTHROPIC_API_KEY` — a stale shell variable must not keep running renders
 *    against the wrong account. With nothing stored, the environment is used
 *    exactly as CI depends on. Either way the listing says which one is in use,
 *    because silent shadowing is the worst possible outcome.
 *  - **Nothing is ever echoed.** Keys are read from a muted prompt or stdin, and
 *    only masked previews are printed. `--json` output is masked too.
 */
import { paint } from '../ui.js';
import type { CliContext } from '../env.js';
import { UsageError } from '../main.js';
import { requireVault, type Keyvault } from '../vault.js';

const ACTIONS = ['list', 'set', 'validate', 'delete'] as const;
type Action = (typeof ACTIONS)[number];

/** Which stage each provider upgrades, in the words the rest of the CLI uses. */
const UPGRADES: Record<string, string> = {
  anthropic: 'lesson — writes the teaching itself. This is the one that matters.',
  elevenlabs: 'voice — a publishable narrator instead of a good local one.',
  replicate: 'visuals — drawn objects and characters instead of built-in icons.',
  fal: 'visuals — drawn objects and characters instead of built-in icons.',
};

export async function keysCommand(ctx: CliContext, args: string[]): Promise<number> {
  const first = (args[0] ?? 'list').toLowerCase();
  if (!(ACTIONS as readonly string[]).includes(first)) {
    throw new UsageError(`unknown \`keys\` action "${first}" — expected ${ACTIONS.join(' | ')}`);
  }
  const action = first as Action;
  const kv = await requireVault();
  const rest = args.slice(1);

  switch (action) {
    case 'list':
      return listKeys(ctx, kv);
    case 'set':
      return setKeyCmd(ctx, kv, rest);
    case 'validate':
      return validateKeys(ctx, kv, rest[0]);
    case 'delete':
      return deleteKeyCmd(ctx, kv, rest[0]);
  }
}

/* -------------------------------------------------------------------- list */

/** Printable width, ignoring the SGR escapes `paint` wraps colours in. */
function visibleWidth(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '').length;
}

/** Pad to `width` printable columns, so colour never shifts a column. */
function padVisible(s: string, width: number): string {
  const pad = width - visibleWidth(s);
  return pad > 0 ? s + ' '.repeat(pad) : s;
}

/**
 * Column layout for the key table, measured from the content.
 *
 * The widths used to be hard-coded with per-cell corrections for escape-sequence
 * length. Verification of a stored key printed
 * `anthropic  sk-ant-api03-ZZ…AAAAkeychain` — a 20-column masked preview in a
 * 16-column field, welded to the next value. This is the one view whose entire job
 * is to show a user that their key is masked, so it has to be readable.
 */
function columns(rows: string[][], gap = 2): number[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, visibleWidth(cell) + gap);
    });
  }
  return widths;
}

async function listKeys(ctx: CliContext, kv: Keyvault): Promise<number> {
  const c = paint(ctx.color);
  const statuses = await kv.listProviders();
  const backend = kv.backendStatus();

  if (ctx.json) {
    process.stdout.write(`${JSON.stringify({ backend, providers: statuses }, null, 2)}\n`);
    return 0;
  }

  const rows: string[][] = [['PROVIDER', 'KEY', 'SOURCE', 'CHECKED']];
  const painted: string[][] = [
    [c.dim('PROVIDER'), c.dim('KEY'), c.dim('SOURCE'), c.dim('CHECKED')],
  ];
  for (const s of statuses) {
    // A stored-but-unusable key still has a preview, and showing it matters: "—"
    // would read as "you never set one", which is the opposite of the truth and
    // invites the user to overwrite a key that is perfectly good.
    const stuck = s.availability === 'locked' || s.availability === 'unreadable';
    const key = s.configured || stuck ? (s.masked ?? 'set') : '—';
    const source = s.source ?? (stuck ? s.availability : '—');
    const checked = s.lastValidated ? s.lastValidated.slice(0, 10) : 'never';
    rows.push([s.provider, key, source, checked]);
    painted.push([
      c.bold(s.provider),
      s.configured ? key : c.dim(key),
      s.source
        ? s.source === 'env'
          ? c.yellow(source)
          : source
        : stuck
          ? c.yellow(source)
          : c.dim(source),
      s.lastValidated ? checked : c.dim(checked),
    ]);
  }
  const widths = columns(rows);
  let out = '\n';
  for (const row of painted) {
    out += `${row.map((cell, i) => (i === row.length - 1 ? cell : padVisible(cell, widths[i] ?? 0))).join('')}\n`;
  }

  out += `\n  ${c.dim('storage:')} ${backend.ready ? c.green(backend.why) : c.yellow(backend.why)}\n`;
  const fromEnv = statuses.filter((s) => s.source === 'env');
  if (fromEnv.length > 0) {
    out += `  ${c.dim('note:')} ${fromEnv.map((s) => s.provider).join(', ')} ${fromEnv.length === 1 ? 'comes' : 'come'} from the environment — nothing stored beats ${fromEnv.length === 1 ? 'it' : 'them'}. \`inkcast keys set\` would take priority.\n`;
  }
  // A stored entry sitting unusable behind an active env key — the state nobody
  // can otherwise explain, because editing that entry changes nothing.
  const inert = statuses.filter((s) => s.shadowedByEnv);
  if (inert.length > 0) {
    out += `  ${c.yellow('note:')} ${inert.map((s) => s.provider).join(', ')} also ${inert.length === 1 ? 'has a stored key that' : 'have stored keys that'} cannot be read right now, so the environment ${inert.length === 1 ? 'value' : 'values'} above ${inert.length === 1 ? 'is' : 'are'} in use.\n`;
  }
  const overriding = statuses.filter((s) => s.overridesEnv);
  if (overriding.length > 0) {
    out += `  ${c.dim('note:')} ${overriding.map((s) => s.provider).join(', ')} ${overriding.length === 1 ? 'is' : 'are'} also set in the environment; the stored ${overriding.length === 1 ? 'key takes' : 'keys take'} priority and the ${overriding.length === 1 ? 'variable is' : 'variables are'} ignored.\n`;
  }

  const locked = statuses.filter((s) => s.availability === 'locked');
  if (locked.length > 0) {
    out += `  ${c.yellow('note:')} ${locked.map((s) => s.provider).join(', ')} ${locked.length === 1 ? 'is' : 'are'} stored but cannot be unsealed — no vault passphrase is available. Set INKCAST_VAULT_PASSPHRASE; the ${locked.length === 1 ? 'key' : 'keys'} ${locked.length === 1 ? 'is' : 'are'} intact.\n`;
  }
  const damaged = statuses.filter((s) => s.availability === 'unreadable');
  if (damaged.length > 0) {
    out += `  ${c.yellow('note:')} ${damaged.map((s) => s.provider).join(', ')} ${damaged.length === 1 ? 'is' : 'are'} stored but ${damaged.length === 1 ? 'fails' : 'fail'} authentication — the vault was modified. Re-add with ${c.cyan(`inkcast keys set ${damaged[0]!.provider}`)}.\n`;
  }

  // Only genuinely-absent providers get the upgrade pitch. Telling someone to
  // `keys set` a provider whose key is merely locked would have them overwrite it.
  const missing = statuses.filter((s) => s.availability === 'absent');
  if (missing.length > 0) {
    out += `\n${c.dim('what a key would change')}\n`;
    for (const s of missing) {
      out += `  ${s.provider.padEnd(12)}${c.dim(UPGRADES[s.provider] ?? '')}\n`;
    }
    out += `\n  ${c.cyan(`inkcast keys set ${missing[0]!.provider}`)}\n`;
  }
  out += '\n';
  process.stdout.write(out);
  return 0;
}

/* --------------------------------------------------------------------- set */

async function setKeyCmd(ctx: CliContext, kv: Keyvault, args: string[]): Promise<number> {
  const c = paint(ctx.color);
  const provider = requireProvider(kv, args[0]);
  const backend = kv.backendStatus();
  if (!backend.ready) {
    process.stderr.write(`${c.red('cannot store a key:')} ${backend.why}\n`);
    return 1;
  }

  // A key on the command line ends up in shell history; accept it because
  // scripts need it, but prefer the prompt and say so.
  let key = args.slice(1).join(' ').trim();
  if (key === '') {
    if (!process.stdin.isTTY) {
      key = (await readStdin()).trim();
      if (key === '') {
        throw new UsageError(
          `no key given. Pipe it in (\`… | inkcast keys set ${provider}\`) or run this in a terminal to be prompted.`,
        );
      }
    } else {
      if (!ctx.quiet) {
        process.stdout.write(
          `${c.dim(`storing in: ${backend.why}`)}\n${c.dim('input is hidden and never logged.')}\n`,
        );
      }
      key = await kv.promptSecret(`${provider} API key: `);
    }
  }

  await kv.setKey(provider, key);
  const statuses = await kv.listProviders();
  const status = statuses.find((s) => s.provider === provider);

  if (ctx.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, provider, status }, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(
    `${c.green('✔')} stored ${c.bold(provider)} ${c.dim(`(${status?.masked ?? 'set'}) in the ${kv.backendStatus().backend}`)}\n`,
  );
  if (status?.overridesEnv) {
    process.stdout.write(
      `${c.dim('note:')} ${status.envVar} is also set in your environment; the stored key takes priority and that variable is now ignored.\n`,
    );
  }
  process.stdout.write(`  ${c.dim('check it:')} ${c.cyan(`inkcast keys validate ${provider}`)}\n`);
  return 0;
}

/* ---------------------------------------------------------------- validate */

async function validateKeys(ctx: CliContext, kv: Keyvault, which?: string): Promise<number> {
  const c = paint(ctx.color);
  const targets = which
    ? [requireProvider(kv, which)]
    : (await kv.listProviders()).filter((s) => s.configured).map((s) => s.provider);

  if (targets.length === 0) {
    if (ctx.json) {
      process.stdout.write(`${JSON.stringify({ results: [] }, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(
      `${c.dim('no keys configured — nothing to validate.')} ${c.cyan('inkcast keys set anthropic')}\n`,
    );
    return 0;
  }

  const results = [];
  for (const provider of targets) results.push(await kv.validateKey(provider));

  if (ctx.json) {
    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
  } else {
    for (const r of results) {
      const mark = r.ok ? c.green('✔') : r.reason === 'network' ? c.yellow('?') : c.red('✘');
      process.stdout.write(`${mark} ${kv.describeValidation(r)}\n`);
    }
  }
  // A network failure says nothing about the key, so it is not a failure here.
  return results.every((r) => r.ok || r.reason === 'network') ? 0 : 1;
}

/* ------------------------------------------------------------------ delete */

async function deleteKeyCmd(ctx: CliContext, kv: Keyvault, which?: string): Promise<number> {
  const c = paint(ctx.color);
  const provider = requireProvider(kv, which);
  const removed = await kv.deleteKey(provider);
  // Retract anything this process injected, so the deletion applies immediately.
  kv.dehydrate();

  if (ctx.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, provider, removed }, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(
    removed
      ? `${c.green('✔')} removed the stored ${c.bold(provider)} key\n`
      : `${c.dim(`no stored ${provider} key to remove`)}\n`,
  );
  const still = (await kv.listProviders()).find((s) => s.provider === provider);
  if (still?.source === 'env') {
    process.stdout.write(
      `${c.yellow('note:')} ${provider} is still set in your environment, so that stage will keep using it.\n`,
    );
  }
  return 0;
}

/* ----------------------------------------------------------------- helpers */

function requireProvider(kv: Keyvault, value: string | undefined): string {
  if (!value) {
    throw new UsageError(`which provider? one of ${kv.PROVIDERS.join(', ')}`);
  }
  if (!kv.isProvider(value)) {
    throw new UsageError(`unknown provider "${value}" — expected ${kv.PROVIDERS.join(', ')}`);
  }
  return value;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
