import { providerEnv } from './provider-context.js';
/** Shared provider selection. A Fireworks key wins auto selection; explicit pins win. */
export type TextProvider = 'fireworks' | 'anthropic' | 'heuristic';
export const FIREWORKS_DEFAULT_MODEL = 'accounts/fireworks/models/deepseek-v4p1-flash';
export function textProvider(
  env: NodeJS.ProcessEnv = providerEnv(),
  adapter?: string,
): TextProvider {
  const requested = adapter && adapter !== 'auto' ? adapter : env.INKCAST_PLANNER?.trim();
  if (requested === 'local' || requested === 'heuristic') return 'heuristic';
  if (requested === 'fireworks' || requested?.startsWith('accounts/'))
    return env.FIREWORKS_API_KEY ? 'fireworks' : 'heuristic';
  if (requested && requested !== 'auto') return env.ANTHROPIC_API_KEY ? 'anthropic' : 'heuristic';
  return env.FIREWORKS_API_KEY ? 'fireworks' : env.ANTHROPIC_API_KEY ? 'anthropic' : 'heuristic';
}
export function textModel(
  fallback: string,
  env: NodeJS.ProcessEnv = providerEnv(),
  adapter?: string,
): string {
  const selected = textProvider(env, adapter);
  if (selected === 'fireworks')
    return (
      env.INKCAST_FIREWORKS_MODEL ||
      (env.INKCAST_PLANNER?.startsWith('accounts/') ? env.INKCAST_PLANNER : FIREWORKS_DEFAULT_MODEL)
    );
  const pinned = env.INKCAST_PLANNER;
  return pinned?.startsWith('claude-') ? pinned : fallback;
}
