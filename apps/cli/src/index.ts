/**
 * Entry point for `inkcast` / `cast`.
 *
 * Deliberately tiny: it configures the environment, *then* dynamically imports
 * the rest of the CLI, because everything downstream imports @inkcast/core and
 * core reads `INKCAST_PROJECTS` / `INKCAST_LOG` at module load.
 *
 * Exit codes: 0 success, 1 handled failure, 2 bad usage.
 */
import { bootstrap } from './env.js';

const ctx = bootstrap();
const { run } = await import('./main.js');

try {
  process.exitCode = await run(process.argv.slice(2), ctx);
} catch (err) {
  // Anything reaching here is a bug in the CLI itself, not a handled failure.
  process.stderr.write(
    `inkcast: unexpected error\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exitCode = 1;
}
