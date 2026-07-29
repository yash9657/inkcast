/**
 * `inkcast providers` — what will actually run, and what would upgrade it.
 *
 * Two honest jobs. It confirms in one command that the pipeline runs on this
 * machine (including the two binaries the renderer needs), and it says where the
 * local path is *worse* rather than merely free. The MVP printed "$0.00 per video"
 * as the headline and let people conclude that was the recommended way to use it;
 * the degradation notices below are the correction.
 */
import { spawnSync } from 'node:child_process';
import { degradations, fullyLocal, providers, STAGE_BLURB } from '@inkcast/pipeline';
import type { CliContext } from '../env.js';
import { paint } from '../ui.js';

export async function providersCommand(ctx: CliContext): Promise<number> {
  const c = paint(ctx.color);
  const p = providers();
  const ffmpeg = probe('ffmpeg');
  const degraded = degradations(p);

  if (ctx.json) {
    process.stdout.write(
      `${JSON.stringify({ providers: p, local: fullyLocal(p), degraded, ffmpeg }, null, 2)}\n`,
    );
    return 0;
  }

  const rows: Array<[string, string, boolean, string, string]> = [
    [
      'lesson',
      label(p.planner.name, p.planner.model),
      p.planner.cloud,
      p.planner.why,
      'inkcast keys set anthropic   (or export ANTHROPIC_API_KEY)',
    ],
    [
      'storyboard',
      'local compiler',
      false,
      STAGE_BLURB.storyboard,
      'always local — plots and layout are pure computation',
    ],
    [
      'voice',
      label(p.voice.name, p.voice.model),
      p.voice.cloud,
      p.voice.why,
      'inkcast keys set elevenlabs  (or --voice af_heart for a good local one)',
    ],
    [
      'visuals',
      label(p.images.name),
      p.images.cloud,
      p.images.why,
      'inkcast keys set replicate   (or fal)',
    ],
    [
      'render',
      'playwright + ffmpeg',
      false,
      ffmpeg ? `ffmpeg found: ${ffmpeg}` : 'ffmpeg NOT found on PATH',
      'always local — no cloud renderer exists here',
    ],
  ];

  let out = `\n${c.dim(['STAGE'.padEnd(12), 'PROVIDER'.padEnd(22), 'WHERE'.padEnd(7), 'WHY'].join(''))}\n`;
  for (const [stage, provider, cloud, why] of rows) {
    out += `${c.bold(stage.padEnd(12))}${provider.padEnd(22)}${(cloud ? c.yellow('cloud') : c.green('local')).padEnd(7 + (ctx.color ? 9 : 0))}${c.dim(why)}\n`;
  }

  out += `\n${c.dim('upgrade with')}\n`;
  for (const [stage, , , , how] of rows) out += `  ${stage.padEnd(12)}${c.dim(how)}\n`;

  if (degraded.length > 0) {
    out += `\n${c.dim('running degraded')}\n`;
    for (const d of degraded) {
      const mark = d.severity === 'major' ? c.yellow('!') : c.dim('·');
      out += `  ${mark} ${c.bold(d.stage)} ${d.effect}\n    ${c.dim('fix:')} ${c.cyan(d.fix)}\n`;
    }
  } else {
    out += `\n  ${c.green('Nothing is running degraded.')}\n`;
  }

  out += `\n  ${
    fullyLocal(p)
      ? c.dim('Nothing leaves this machine, so this configuration costs $0.00 — but see above: ') +
        c.dim('free is not the same as good.')
      : c.yellow('Cloud providers are active: runs will incur cost.')
  }\n`;
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
