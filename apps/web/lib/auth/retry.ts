// Signing in at check-in: hundreds of phones within minutes, all reaching Supabase Auth from a few addresses. When Auth
// answers "too many requests" (429) or is briefly overloaded (5xx, or the request did not get through), the sign-in is
// tried again after a short random wait instead of showing the team an error. A wrong password (400) is never retried.
// Used by the login action (app/login/actions.ts) and by the check-in load test (scripts/app-load-test.ts --rush).

export interface AuthErrorLike {
  status?: number;
  code?: string;
}

/** Whether a sign-in error is worth another try: busy or overloaded, not wrong credentials. */
export function retryableAuthError(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false;
  const s = error.status;
  return s === undefined || s === 0 || s === 429 || s >= 500;
}

export const SIGN_IN_ATTEMPTS = 4;

/** Wait before attempt `n` (2, 3, 4): random, growing, so retries from many phones do not land together. */
export function retryDelayMs(n: number, random: () => number = Math.random): number {
  return Math.round((400 + random() * 800) * (n - 1));
}

/** Runs a sign-in, trying again on retryable errors. Returns the last result. */
export async function signInWithRetry<T extends { error: AuthErrorLike | null }>(
  attempt: () => Promise<T>,
  { attempts = SIGN_IN_ATTEMPTS, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), random = Math.random } = {},
): Promise<T & { tries: number }> {
  let result!: T;
  for (let n = 1; n <= attempts; n++) {
    if (n > 1) await sleep(retryDelayMs(n, random));
    try {
      result = await attempt();
    } catch {
      result = { error: { status: 0 } } as T;
    }
    if (!retryableAuthError(result.error)) return { ...result, tries: n };
  }
  return { ...result, tries: attempts };
}
