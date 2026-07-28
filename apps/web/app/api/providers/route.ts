/**
 * `GET /api/providers` — which provider each stage will actually use, and why.
 *
 * The whole project's promise is that it runs with zero API keys, so the studio
 * should be able to *show* that rather than assert it. This is the same
 * decision table `inkcast providers` prints, read straight from the pipeline so
 * the two can never disagree.
 */

import { json, unexpected } from '../_lib/http';
import { loadPipeline } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { providers, fullyLocal } = await loadPipeline();
    const chosen = providers();
    return json({
      providers: chosen,
      /** True when nothing in a run leaves this machine and nothing can be billed. */
      local: fullyLocal(chosen),
      projectsDir: process.env.INKCAST_PROJECTS ?? null,
    });
  } catch (err) {
    return unexpected('providers', err);
  }
}
