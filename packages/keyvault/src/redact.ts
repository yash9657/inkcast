/**
 * Leak prevention: scrub anything key-shaped out of text before it can escape.
 *
 * A stored key is only as safe as the noisiest code path that touches it. Ours
 * are logs (`@inkcast/core`'s logger writes straight to stdout/stderr), SSE
 * progress events, HTTP response bodies, and stack traces — four places a key
 * lands in plain text and then gets pasted into a bug report. So redaction is
 * not a formatting nicety here; it is the last line of defence, and it runs in
 * two layers:
 *
 *   1. **Exact match on tracked values.** Every key this package hands out is
 *      registered in a process-local table, and `redact()` replaces those
 *      literal strings first. This is the only layer that catches a key whose
 *      shape we did not anticipate, which is why it is on by default.
 *   2. **Shape match on known credential formats.** `sk-ant-`, `sk-`, `r8_`,
 *      `hf_`, fal's `uuid:secret`, bearer/`x-api-key` headers, `FOO_TOKEN=…`
 *      assignments, `"apiKey": "…"` JSON, and long high-entropy runs.
 *
 * Layer 2's long-run rules are deliberately blunt: a 64-character hex digest in
 * a debug line gets masked along with a 64-character hex API key, because we
 * cannot tell them apart and only one of those two mistakes is expensive. Pass
 * `{ generic: false }` (or set `INKCAST_REDACT_GENERIC=0`) where readability of
 * digests matters more than that margin.
 */

const PLACEHOLDER = '«redacted»';

/** Marker characters are outside every credential charset, so a replacement can
 * never be re-matched (or partially matched) by a later rule. */
const MARKER = /[«»]/;

type Rule = {
  /** Name is the label used in the placeholder and in the tests. */
  name: string;
  re: RegExp;
  /** Rules that keep a non-secret prefix (a header name, an env var) use this. */
  replace: (match: string, ...groups: string[]) => string;
};

const tag = (name: string) => `«redacted:${name}»`;
const whole = (name: string) => () => tag(name);
/** Keep group 1 (the label: `Bearer `, `x-api-key: `, `MY_TOKEN=`), drop the rest. */
const keepLabel = (_m: string, label: string) => `${label}${PLACEHOLDER}`;

/**
 * Shape rules, most specific first. Ordering matters: `sk-ant-…` must be
 * consumed before the generic `sk-…` rule, or the anthropic key would be
 * reported under the wrong label (and, worse, a future edit to the generic rule
 * could leave the `ant-` fragment behind).
 */
const SHAPE_RULES: Rule[] = [
  // Anthropic API keys and OAuth tokens: sk-ant-api03-…, sk-ant-oat01-…
  { name: 'anthropic', re: /sk-ant-[A-Za-z0-9_-]{6,}/g, replace: whole('anthropic') },
  // ElevenLabs (current format) and any other sk_-prefixed secret.
  { name: 'elevenlabs', re: /\bsk_[A-Za-z0-9]{20,}/g, replace: whole('elevenlabs') },
  // Replicate.
  { name: 'replicate', re: /\br8_[A-Za-z0-9]{16,}/g, replace: whole('replicate') },
  // Hugging Face (kokoro-js model downloads accept one).
  { name: 'huggingface', re: /\bhf_[A-Za-z0-9]{12,}/g, replace: whole('huggingface') },
  // fal.ai: <uuid key id>:<hex secret>.
  {
    name: 'fal',
    re: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:[A-Za-z0-9]{16,}/g,
    replace: whole('fal'),
  },
  // GitHub tokens — not a provider we use, but they ride along in repo tooling.
  { name: 'github', re: /\bgh[pousr]_[A-Za-z0-9]{16,}/g, replace: whole('github') },
  // OpenAI-style, and the catch-all for anything else calling itself sk-.
  { name: 'sk', re: /\bsk-[A-Za-z0-9_-]{12,}/g, replace: whole('sk') },
  // `Authorization: Bearer …`, Replicate's `Token …`, fal's `Key …`. The
  // lookahead demands a digit or separator in the token so English prose
  // ("Key features", "Token ring") is not mistaken for a credential.
  {
    name: 'bearer',
    re: /\b(Bearer|Token|Key)([ \t]+)(?=[A-Za-z0-9._:+/=-]*[\d_:+/=-])[A-Za-z0-9._:+/=-]{12,}/gi,
    replace: (_m, word, space) => `${word}${space}${PLACEHOLDER}`,
  },
  // Header form, however it is cased or spelled.
  {
    name: 'header',
    re: /\b((?:x-api-key|xi-api-key|api[-_]?key|authorization|auth[-_]?token|proxy-authorization)[ \t]*[:=][ \t]*)["']?[^\s"',;}\])]{6,}/gi,
    replace: keepLabel,
  },
  // Shell / dotenv assignment: ANTHROPIC_API_KEY=…, FAL_KEY=…, PASSPHRASE=…
  {
    name: 'assignment',
    re: /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIAL)S?[ \t]*[:=][ \t]*)["']?[^\s"',;]{4,}/g,
    replace: keepLabel,
  },
  // JSON / object literal.
  {
    name: 'json',
    re: /(["']?(?:api_?key|apiKey|access_?token|refresh_?token|token|secret|password|passphrase)["']?[ \t]*:[ \t]*)["'][^"']{4,}["']/gi,
    replace: (_m, label) => `${label}"${PLACEHOLDER}"`,
  },
];

/**
 * A masked preview from `mask()`: an optional public prefix, then either two
 * characters, an ellipsis and four characters, or six bullets.
 *
 * These are held out of the shape rules and restored afterwards. Without this,
 * `sk-ant-api03-Sm…aaaa` trips the Anthropic rule and every status listing
 * printed through the stdout hook collapses to `«redacted»` — defeating the one
 * job `listProviders()` has.
 *
 * The pattern is deliberately tight, which bounds the exemption: it can only
 * ever hold out a public prefix plus six characters, so even a contrived line
 * like `sk-ant-<real key>…abcd` still has the key itself redacted (the hold-out
 * takes `ey…abcd`, and the `sk-ant-…` remainder is matched as normal). At most
 * six characters can survive — precisely what `mask()` already discloses.
 */
const PREVIEW =
  /(?:[A-Za-z0-9_-]{0,16}[-_])?(?:[A-Za-z0-9]{2}…[A-Za-z0-9]{4}(?![A-Za-z0-9…])|•{6})/g;

/**
 * Tell a standard-alphabet base64 blob apart from an absolute file path.
 *
 * `/` is in base64's alphabet, so a bare 40-character run of `[A-Za-z0-9+/]`
 * also describes `/Users/someone/code/inkcast/projects` — and it matched. Every
 * absolute path Inkcast logged came out as `«redacted:base64»`, including the
 * `videoPath` in `--json` output, which turned a machine-readable contract into
 * nonsense. Redaction that mangles ordinary output gets switched off wholesale,
 * so precision here protects the keys as much as the log lines do.
 *
 * The three tests, in order of decisiveness:
 *
 *  - `=` padding or a `+` is base64 and effectively never a path.
 *  - Real base64 of this length is a dense mix of cases and digits: over 40
 *    characters the chance of no digit at all is under 0.2%, and of no uppercase
 *    about one in 250 million. A path made of words fails this immediately.
 *  - A blob containing `/` must still have one long unbroken run, because a path
 *    is short word, slash, short word. 20 is comfortably above the longest
 *    directory names in play and far below a credential.
 *
 * A secret this narrowing lets through is still caught by the tracked-value
 * layer if this process ever held it, and by every shape rule above.
 */
function looksLikeBase64Blob(run: string): boolean {
  if (run.endsWith('=') || run.includes('+')) return true;
  if (!/[A-Z]/.test(run) || !/[a-z]/.test(run) || !/\d/.test(run)) return false;
  if (!run.includes('/')) return true;
  return run.split('/').some((segment) => segment.length >= 20);
}

/** Blunt high-entropy rules. Applied last, and skippable — see the file header. */
const GENERIC_RULES: Rule[] = [
  // Long hex runs: legacy ElevenLabs keys, fal secrets, HMACs.
  { name: 'hex', re: /\b[0-9a-fA-F]{32,}\b/g, replace: whole('hex') },
  // Long base64url runs (JWT segments, opaque tokens).
  { name: 'b64', re: /\b[A-Za-z0-9_-]{40,}\b/g, replace: whole('base64') },
  // Long standard-alphabet base64, including padding.
  {
    name: 'b64std',
    re: /[A-Za-z0-9+/]{40,}={0,2}/g,
    replace: (match) => (looksLikeBase64Blob(match) ? tag('base64') : match),
  },
];

/* ------------------------------------------------------ tracked exact values */

/**
 * Literal secret values seen by this process, longest first so that a key which
 * happens to contain another is masked at full length.
 *
 * This table is the reason redaction catches formats we never anticipated, and
 * it is also the one place this package holds a key for longer than a single
 * call — an explicit, documented trade: a value already in this process's heap
 * is registered so it can never be *printed*. `INKCAST_KEYVAULT_TRACK=0`
 * disables it, and `forgetSecrets()` clears it.
 */
const tracked = new Set<string>();

/** Values shorter than this are too likely to appear in ordinary text. */
const MIN_TRACKABLE = 8;

/**
 * Remember a literal secret so `redact()` masks it by exact match, in every
 * encoding it might be re-serialised into on the way out.
 */
export function trackSecret(secret: string | undefined | null): void {
  if (!secret) return;
  if (process.env.INKCAST_KEYVAULT_TRACK === '0') return;
  const value = secret.trim();
  if (value.length < MIN_TRACKABLE) return;
  tracked.add(value);
  // A key can leave the process re-encoded: base64 in a data URI or an
  // Authorization header, percent-encoded in a query string, JSON-escaped in a
  // response body. Register those forms too when they differ.
  for (const form of [
    Buffer.from(value, 'utf8').toString('base64'),
    encodeURIComponent(value),
    JSON.stringify(value).slice(1, -1),
  ]) {
    if (form !== value && form.length >= MIN_TRACKABLE) tracked.add(form);
  }
}

/** Drop every tracked value. Called by `lock()`; useful between tests. */
export function forgetSecrets(): void {
  tracked.clear();
}

/** How many literal values are currently tracked (diagnostics only). */
export function trackedCount(): number {
  return tracked.size;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* --------------------------------------------------------------- the redactor */

export type RedactOptions = {
  /**
   * Apply the blunt long-hex / long-base64 rules. Default true, overridable
   * per call or globally with `INKCAST_REDACT_GENERIC=0`.
   */
  generic?: boolean;
};

/**
 * Scrub every credential-shaped run out of `text`.
 *
 * Safe on any input: non-strings are coerced, and a string with nothing
 * key-shaped in it is returned unchanged (same reference), so this is cheap
 * enough to sit on the hot path of every log line.
 */
export function redact(text: unknown, opts: RedactOptions = {}): string {
  let out = typeof text === 'string' ? text : String(text);
  if (out.length === 0) return out;

  // Layer 0: hold masked previews out of the way so the rules cannot eat them.
  const held: string[] = [];
  if (out.includes('…') || out.includes('•')) {
    out = out.replace(PREVIEW, (m) => {
      held.push(m);
      return `«p${held.length - 1}»`;
    });
  }

  // Layer 1: exact tracked values, longest first.
  if (tracked.size > 0) {
    for (const value of [...tracked].sort((a, b) => b.length - a.length)) {
      if (out.includes(value)) out = out.split(value).join(PLACEHOLDER);
    }
  }

  // Layer 2: shapes.
  for (const rule of SHAPE_RULES) out = out.replace(rule.re, rule.replace);

  const generic = opts.generic ?? process.env.INKCAST_REDACT_GENERIC !== '0';
  if (generic) {
    for (const rule of GENERIC_RULES) {
      out = out.replace(rule.re, (match, ...groups) => {
        // Never chew through a placeholder we just wrote.
        if (MARKER.test(match)) return match;
        return rule.replace(match, ...(groups.filter((g) => typeof g === 'string') as string[]));
      });
    }
  }

  // Put the previews back.
  if (held.length > 0) {
    out = out.replace(/«p(\d+)»/g, (m, i: string) => held[Number(i)] ?? m);
  }
  return out;
}

/** True when `text` still contains something key-shaped. Used by the tests. */
export function looksRedacted(text: string): boolean {
  return redact(text) === text;
}

/* ------------------------------------------------- errors, JSON, SSE payloads */

/**
 * A redacted copy of an error, message *and* stack.
 *
 * Stack frames carry argument values in some runtimes and, more commonly, the
 * message gets interpolated into the frame list by wrapping libraries — so both
 * have to be scrubbed before the object is logged or serialised.
 */
export function redactError(err: unknown): Error {
  if (!(err instanceof Error)) return new Error(redact(err));
  const clean = new Error(redact(err.message));
  clean.name = err.name;
  clean.stack = err.stack ? redact(err.stack) : undefined;
  if (err.cause !== undefined) clean.cause = redactError(err.cause);
  for (const [k, v] of Object.entries(err)) {
    if (k === 'message' || k === 'stack' || k === 'cause') continue;
    (clean as unknown as Record<string, unknown>)[k] = redactDeep(v);
  }
  return clean;
}

/** Keys whose *value* is replaced wholesale, whatever shape it has. */
const SECRET_KEY =
  /(?:^|[._-])(?:key|apikey|api_key|token|secret|password|passphrase|credential|authorization)s?$/i;

/**
 * Deep-redact a value for an SSE event or an HTTP response body.
 *
 * Strings go through `redact()`; a property whose *name* says "secret" has its
 * value replaced regardless of shape, which is what catches a short or
 * unusually formatted key that no pattern would match.
 */
export function redactDeep<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value === 'string') return redact(value) as unknown as T;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '«circular»' as unknown as T;
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((v) => redactDeep(v, seen)) as unknown as T;
  if (value instanceof Error) return redactError(value) as unknown as T;
  if (value instanceof Date || value instanceof RegExp) return value;
  if (Buffer.isBuffer(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] =
      SECRET_KEY.test(k) && v !== null && v !== undefined ? PLACEHOLDER : redactDeep(v, seen);
  }
  return out as unknown as T;
}

/** Alias that reads better at an SSE or JSON response boundary. */
export const redactJson = redactDeep;

/* ------------------------------------------------------------- install hook */

type WriteFn = typeof process.stdout.write;
type Patched = { stream: NodeJS.WriteStream; original: WriteFn };
let patched: Patched[] | undefined;

/**
 * Route everything written to stdout and stderr through `redact()`.
 *
 * Patching the two streams — rather than wrapping our own logger — is what
 * makes the guarantee hold end to end: `@inkcast/core`'s `logger` writes here,
 * so does `console.*`, so does Node's own uncaught-exception and
 * unhandled-rejection reporter. One hook covers log lines, error paths and
 * stack traces alike, and a stage that never imports this package still cannot
 * print a key it obtained from `getKey()`.
 *
 * Idempotent. Returns the uninstall function.
 */
export function installRedaction(): () => void {
  if (patched) return uninstallRedaction;
  patched = [];
  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write.bind(stream) as WriteFn;
    patched.push({ stream, original });
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      if (typeof chunk === 'string') {
        return (original as (...a: unknown[]) => boolean)(redact(chunk), ...rest);
      }
      if (Buffer.isBuffer(chunk)) {
        // Decode, scrub, and only substitute if something was actually found —
        // so a genuinely binary write passes through byte-for-byte untouched.
        const text = chunk.toString('utf8');
        const clean = redact(text);
        if (clean !== text) {
          return (original as (...a: unknown[]) => boolean)(Buffer.from(clean, 'utf8'), ...rest);
        }
      }
      return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as WriteFn;
  }
  return uninstallRedaction;
}

/** Restore the original stream writers. */
export function uninstallRedaction(): void {
  if (!patched) return;
  for (const { stream, original } of patched) stream.write = original;
  patched = undefined;
}

/** True when the stdout/stderr hook is currently installed. */
export function redactionInstalled(): boolean {
  return patched !== undefined;
}
