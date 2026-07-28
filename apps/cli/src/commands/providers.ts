/**
 * `inkcast providers` — what will actually run, and what would upgrade it.
 *
 * The whole project's promise is that the default path is local and free, so it
 * should be one command to confirm that on any machine.
 */
import { spawnSync } from 'node:child_process';
import { fullyLocal, providers } from '@inkcast/pipeline';
import type { CliContext } from '../env.js';
import { paint } from '../ui.js';

export async function providersCommand(ctx: CliContext): Promise<number> {
  const c = paint(ctx.color);
  const p = providers();
  const ffmpeg = probe('ffmpeg');

  if (ctx.json) {
    process.stdout.write(
      `${JSON.stringify({ providers: p, local: fullyLocal(p), ffmpeg }, null, 2)}\n`,
    );
    return 0;
  }

  const rows: Array<[string, string, boolean, string, string]> = [
    [
      'plan',
      label(p.planner.name, p.planner.model),
      p.planner.cloud,
      p.planner.why,
      'ANTHROPIC_API_KEY, INKCAST_PLANNER',
    ],
    [
      'voice',
      label(p.voice.name, p.voice.model),
      p.voice.cloud,
      p.voice.why,
      'ELEVENLABS_API_KEY, INKCAST_VOICE',
    ],
    [
      'visuals',
      label(p.images.name),
      p.images.cloud,
      p.images.why,
      'REPLICATE_API_TOKEN or FAL_KEY',
    ],
    [
      'render',
      'playwright + ffmpeg',
      false,
      ffmpeg ? `ffmpeg found: ${ffmpeg}` : 'ffmpeg NOT found on PATH',
      'always local — no cloud renderer exists here',
    ],
  ];

  let out = `\n${c.dim(['STAGE'.padEnd(9), 'PROVIDER'.padEnd(22), 'WHERE'.padEnd(7), 'WHY'].join(''))}\n`;
  for (const [stage, provider, cloud, why] of rows) {
    out += `${c.bold(stage.padEnd(9))}${provider.padEnd(22)}${(cloud ? c.yellow('cloud') : c.green('local')).padEnd(7 + (ctx.color ? 9 : 0))}${c.dim(why)}\n`;
  }

  out += `\n${c.dim('upgrade with')}\n`;
  for (const [stage, , , , env] of rows) out += `  ${stage.padEnd(9)}${c.dim(env)}\n`;

  out += `\n  ${fullyLocal(p) ? c.green('Fully local: this configuration costs $0.00 per video.') : c.yellow('Cloud providers are active: runs will incur cost.')}\n`;
  if (!ffmpeg) {
    out += `  ${c.red('ffmpeg is required to mux video.')} ${c.dim('macOS: brew install ffmpeg · Debian: apt install ffmpeg')}\n`;
  }
  out += `  ${c.dim('Chromium for the renderer: pnpm exec playwright install chromium')}\n\n`;
  process.stdout.write(out);
  return 0;
}

function label(name: string, model?: string): string {
  const s = model && model !== name ? `${name}/${model}` : name;
  return s.length > 21 ? `${s.slice(0, 20)}…` : s;
}

/** Version string of a binary on PATH, or undefined when it is missing. */
function probe(bin: string): string | undefined {
  try {
    const res = spawnSync(bin, ['-version'], { encoding: 'utf8', timeout: 4000 });
    if (res.status !== 0 || !res.stdout) return undefined;
    return res.stdout.split('\n')[0]?.slice(0, 60);
  } catch {
    return undefined;
  }
}
