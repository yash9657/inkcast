import { redactProviderSecrets } from '@inkcast/core';
/** Errors that name the stage that failed and keep the original cause attached. */

import type { StageName } from './progress.js';

export class StageError extends Error {
  readonly stage: StageName;
  readonly projectId: string | undefined;

  constructor(
    stage: StageName,
    message: string,
    opts: { cause?: unknown; projectId?: string } = {},
  ) {
    super(`[${stage}] ${redactProviderSecrets(message)}`, { cause: opts.cause });
    this.name = 'StageError';
    this.stage = stage;
    this.projectId = opts.projectId;
  }
}

/** The message of the deepest cause, which is where the real reason usually lives. */
export function rootCauseMessage(err: unknown): string {
  let cur: unknown = err;
  const seen = new Set<unknown>();
  while (cur && typeof cur === 'object' && 'cause' in cur && (cur as { cause?: unknown }).cause) {
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = (cur as { cause?: unknown }).cause;
  }
  if (cur instanceof Error) return redactProviderSecrets(cur.message);
  if (typeof cur === 'string') return redactProviderSecrets(cur);
  return redactProviderSecrets(err instanceof Error ? err.message : String(err));
}

/** Run `fn`, wrapping any throw in a StageError that names `stage`. */
export async function inStage<T>(
  stage: StageName,
  projectId: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    if (cause instanceof StageError) throw cause;
    const why = cause instanceof Error ? cause.message : String(cause);
    throw new StageError(stage, why, { cause, projectId });
  }
}
