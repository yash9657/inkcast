/**
 * Formatting for the studio. Pure functions, no React, safe on both sides of
 * the server/client boundary.
 */

/** `1:42`, `12:03`, `1:02:03`. For durations and timecodes. */
export function clock(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0
    ? `${h}:${mm}:${String(s).padStart(2, '0')}`
    : `${mm}:${String(s).padStart(2, '0')}`;
}

/** `0:42` from milliseconds — the elapsed clock on the waiting screen. */
export function elapsed(ms: number): string {
  return clock(Math.floor(ms / 1000));
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/**
 * `3 minutes ago`. Returns undefined for an unparseable date rather than
 * guessing, so the caller can omit the line entirely.
 */
export function relativeTime(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return undefined;
  const delta = then - Date.now();
  const abs = Math.abs(delta);
  for (const [unit, ms] of UNITS) {
    if (abs >= ms) return RELATIVE.format(Math.round(delta / ms), unit);
  }
  return RELATIVE.format(Math.round(delta / 1000), 'second');
}

/** An absolute timestamp for the `title` attribute behind a relative one. */
export function absoluteTime(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;
  return at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** CSS `aspect-ratio` for one of the three output shapes. */
export function aspectRatio(aspect: '16:9' | '9:16' | '1:1'): string {
  switch (aspect) {
    case '9:16':
      return '9 / 16';
    case '1:1':
      return '1 / 1';
    default:
      return '16 / 9';
  }
}

/** Numeric width/height ratio, for laying out a preview viewport. */
export function aspectValue(aspect: '16:9' | '9:16' | '1:1'): number {
  switch (aspect) {
    case '9:16':
      return 1080 / 1920;
    case '1:1':
      return 1;
    default:
      return 1920 / 1080;
  }
}

/** `12.4 kB`, `3.1 MB` — for a dropped file's size. */
export function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1000) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit] ?? 'GB'}`;
}

/** Rough spoken length: 150 words a minute is a normal narration pace. */
export function estimateSpokenSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return (words / 150) * 60;
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}
