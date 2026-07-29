/**
 * Masked previews: enough to recognise a key, never enough to reconstruct one.
 *
 * `listProviders()` has to answer "is this the key I think it is?" for a user
 * with two accounts, without putting usable material on a screen that might be
 * shared or screenshotted. Two rules make that safe:
 *
 *   - A **public prefix** (`sk-ant-api03-`, `r8_`, …) is shown in full. It
 *     carries no entropy — every key from that provider has it — but it is what
 *     makes the preview legible at a glance.
 *   - Of the remaining body, at most two leading and four trailing characters
 *     are shown, and only when the body is long enough that the middle stays
 *     hidden. Below that threshold nothing of the body is revealed at all.
 *
 * The invariant the tests pin down: no contiguous run from the middle of the key
 * ever appears in the output.
 */

/** Prefixes that identify a provider and carry no secret material. */
const PUBLIC_PREFIXES = [
  'sk-ant-api03-',
  'sk-ant-api',
  'sk-ant-oat01-',
  'sk-ant-oat',
  'sk-ant-',
  'sk-proj-',
  'sk_live_',
  'sk_test_',
  'sk-',
  'sk_',
  'r8_',
  'hf_',
  'ghp_',
] as const;

const LEAD = 2;
const TAIL = 4;
/** Below this, the body is short enough that showing 6 of it reveals too much. */
const MIN_BODY = 10;

/**
 * A display-safe preview of `raw`.
 *
 * Returns `''` for an empty input so a caller can distinguish "no key" from
 * "a key I am not showing you".
 */
export function mask(raw: string | undefined | null): string {
  const key = (raw ?? '').trim();
  if (key.length === 0) return '';

  const prefix = PUBLIC_PREFIXES.find((p) => key.startsWith(p)) ?? '';
  const body = key.slice(prefix.length);

  if (body.length < MIN_BODY) return `${prefix}${'•'.repeat(6)}`;
  return `${prefix}${body.slice(0, LEAD)}…${body.slice(-TAIL)}`;
}

/**
 * The characters `mask()` withholds, for tests and for asserting the invariant
 * at a call site. Empty when the whole body is hidden.
 */
export function maskedMiddle(raw: string): string {
  const key = raw.trim();
  const prefix = PUBLIC_PREFIXES.find((p) => key.startsWith(p)) ?? '';
  const body = key.slice(prefix.length);
  if (body.length < MIN_BODY) return body;
  return body.slice(LEAD, body.length - TAIL);
}
