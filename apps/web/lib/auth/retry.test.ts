import { describe, expect, test } from "vitest";
import { retryDelayMs, retryableAuthError, signInWithRetry } from "./retry";

const noWait = { sleep: async () => {}, random: () => 0.5 };

describe("signing in when Auth is busy", () => {
  test("busy, overloaded or unreachable is retried; a wrong password is not", () => {
    expect(retryableAuthError({ status: 429 })).toBe(true);
    expect(retryableAuthError({ status: 500 })).toBe(true);
    expect(retryableAuthError({ status: 0 })).toBe(true);
    expect(retryableAuthError({})).toBe(true);
    expect(retryableAuthError({ status: 400, code: "invalid_credentials" })).toBe(false);
    expect(retryableAuthError(null)).toBe(false);
  });

  test("a sign-in that is refused twice for load succeeds on the third try", async () => {
    const answers = [{ error: { status: 500 } }, { error: { status: 429 } }, { error: null }];
    const r = await signInWithRetry(async () => answers.shift()!, noWait);
    expect(r).toEqual({ error: null, tries: 3 });
  });

  test("a wrong password is answered at once, and a thrown network error counts as busy", async () => {
    let calls = 0;
    expect(await signInWithRetry(async () => (calls++, { error: { status: 400 } }), noWait)).toEqual({ error: { status: 400 }, tries: 1 });
    expect(calls).toBe(1);
    const r = await signInWithRetry(async () => { throw new Error("socket hang up"); }, noWait);
    expect(r).toEqual({ error: { status: 0 }, tries: 4 });
  });

  test("waits are random and grow, a few seconds in all", () => {
    expect(retryDelayMs(2, () => 0)).toBe(400);
    expect(retryDelayMs(4, () => 1)).toBe(3600);
    expect([2, 3, 4].reduce((t, n) => t + retryDelayMs(n, () => 1), 0)).toBeLessThanOrEqual(7200);
  });
});
