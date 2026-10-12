/** Public choices only. Credentials never enter a video request or its metadata. */
export type ProviderSelection = {
  planner: 'fireworks' | 'anthropic' | 'local';
  speech: 'elevenlabs' | 'local';
  images: 'auto' | 'local';
};

export function defaultSelection(
  keys: readonly { id: string; configured: boolean }[],
): ProviderSelection {
  const has = (id: string) => keys.some((key) => key.id === id && key.configured);
  return {
    planner: has('fireworks') ? 'fireworks' : has('anthropic') ? 'anthropic' : 'local',
    speech: has('elevenlabs') ? 'elevenlabs' : 'local',
    images: has('replicate') || has('fal') ? 'auto' : 'local',
  };
}

export function selectedVoice(selection: ProviderSelection, voice?: string): string {
  const bare = (voice ?? 'af_heart').replace(/^(?:elevenlabs|kokoro|local|say|system):/i, '');
  return selection.speech === 'elevenlabs'
    ? `elevenlabs:${bare}`
    : `kokoro:${/^[ab][fm]_/.test(bare) ? bare : 'af_heart'}`;
}
