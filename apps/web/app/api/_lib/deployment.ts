/** Authenticated installations must never expose the operator's local vault. */
export function accountKeys(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.INKCAST_HOSTED === '1' ||
    Boolean(env.CLERK_SECRET_KEY?.trim() || env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim())
  );
}
