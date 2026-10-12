/** Repair a model's extra JSON escape layer in a simple, single-line formula. */
export function normalizeGeneratedTex(tex: string): string {
  // Leave deliberate row breaks/environments and mixed-escaping expressions alone.
  // Only known commands ALL carrying two slashes provide evidence of double encoding.
  if (/\\+begin\s*\{/.test(tex) || /(?<!\\)\\[a-zA-Z]/.test(tex)) return tex;
  if (!/\\\\(?:mathrm|text|times|cdot|neq|frac|sqrt|Delta|rho)\b/.test(tex)) return tex;
  return tex.replace(/\\\\/g, '\\');
}
