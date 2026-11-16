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
/** "Too many requests" clears as Supabase's limit refills, so it is given more tries than an outage. */
export const RATE_LIMITED_ATTEMPTS = 6;
/** The longest single wait, and so (with 6 tries) about 12 s in all: inside the login page's time limit. */
export const MAX_RETRY_DELAY_MS = 3000;

/** Wait before attempt `n` (2, 3, …): random, growing, capped, so retries from many phones do not land together. */
export function retryDelayMs(n: number, random: () => number = Math.random): number {
  return Math.min(MAX_RETRY_DELAY_MS, Math.round((500 + random() * 700) * (n - 1)));
}

/**
 * Runs a sign-in, trying again on retryable errors: up to `attempts` tries for an outage, more when Auth only said
 * "too many requests" (429). Returns the last result.
 */
export async function signInWithRetry<T extends { error: AuthErrorLike | null }>(
  attempt: () => Promise<T>,
  {
    attempts = SIGN_IN_ATTEMPTS,
    rateLimitedAttempts = Math.max(attempts, RATE_LIMITED_ATTEMPTS),
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    random = Math.random,
  } = {},
): Promise<T & { tries: number }> {
  let result!: T;
  for (let n = 1; ; n++) {
    if (n > 1) await sleep(retryDelayMs(n, random));
    try {
      result = await attempt();
    } catch {
      result = { error: { status: 0 } } as T;
    }
    if (!retryableAuthError(result.error)) return { ...result, tries: n };
    const limit = result.error?.status === 429 ? rateLimitedAttempts : attempts;
    if (n >= limit) return { ...result, tries: n };
  }
}
