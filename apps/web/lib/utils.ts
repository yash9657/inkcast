import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names, resolving Tailwind conflicts in favour of the last one.
 *
 * Every component in `components/ui` takes `className` and passes it through
 * `cn()` last, so a caller's `className="px-6"` genuinely beats the component's
 * own `px-4` instead of both landing in the class list and letting source order
 * decide.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * The house focus ring, as a class string.
 *
 * `focus-ring` is a Tailwind utility declared in `app/globals.css`: a 2px
 * `--color-ring` outline with a 2px offset, applied on `:focus-visible` only.
 * It is defined once and referenced here so every interactive element in the
 * app is keyboard-visible in exactly the same way.
 *
 * Compose it, don't reinvent it:
 *   className={cn(focusRing, 'rounded-md px-3')}
 */
export const focusRing = 'focus-ring outline-none';

/**
 * Base UI's `className` prop accepts either a string or a function of the
 * component's state. Our wrappers narrow it to a plain string so `cn()` can
 * merge it — state-dependent styling is expressed with `data-*` variants
 * (`data-[open]:rotate-180`), which keeps it visible in the class list rather
 * than hidden in a callback.
 */
export type WithClass<P> = Omit<P, 'className'> & { className?: string };

/**
 * Lifts `cn()` into Base UI's state-callback shape, for the rare part whose
 * styling genuinely cannot be expressed as a `data-*` variant.
 *
 *   className={stateClass((s) => (s.side === 'top' ? 'origin-bottom' : ''), className)}
 */
export function stateClass<State>(
  fromState: (state: State) => ClassValue,
  ...rest: ClassValue[]
): (state: State) => string {
  return (state: State) => cn(fromState(state), ...rest);
}

/**
 * Deterministic 32-bit hash of a string, used to seed the hand-drawn ink
 * flourishes. Same text in, same wobble out — so a hand-drawn underline does
 * not re-roll its shape on every render or differ between server and client.
 */
export function seedFrom(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Small, fast, seeded PRNG (mulberry32). Deterministic given the same seed,
 * which is what makes the ink components SSR-safe.
 */
export function randomFromSeed(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
