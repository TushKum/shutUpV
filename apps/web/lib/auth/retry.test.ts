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

  test("waits are random, grow and are capped: about 12 s at most over 6 tries", () => {
    expect(retryDelayMs(2, () => 0)).toBe(500);
    expect(retryDelayMs(3, () => 1)).toBe(2400);
    expect(retryDelayMs(6, () => 1)).toBe(3000);
    expect([2, 3, 4, 5, 6].reduce((t, n) => t + retryDelayMs(n, () => 1), 0)).toBeLessThanOrEqual(13_000);
  });

  test("'too many requests' gets 6 tries; an outage 4", async () => {
    let calls = 0;
    const busy = await signInWithRetry(async () => (calls++, { error: { status: 429 } }), noWait);
    expect(busy).toEqual({ error: { status: 429 }, tries: 6 });
    expect(calls).toBe(6);
    calls = 0;
    const down = await signInWithRetry(async () => (calls++, { error: { status: 503 } }), noWait);
    expect(down.tries).toBe(4);
    const late = [{ error: { status: 429 } }, { error: { status: 429 } }, { error: { status: 429 } }, { error: { status: 429 } }, { error: null }];
    expect(await signInWithRetry(async () => late.shift()!, noWait)).toEqual({ error: null, tries: 5 });
  });
});
