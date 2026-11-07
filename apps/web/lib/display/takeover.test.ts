import { describe, expect, test } from "vitest";
import { activeTakeover, TAKEOVER_MIN_SECONDS, TAKEOVER_SECONDS, takeoverMs, type TakeoverMoments } from "./takeover";

const T0 = Date.parse("2026-11-20T16:45:00.000Z"); // 22:15 IST
const iso = (ms: number) => new Date(ms).toISOString();
const NONE: TakeoverMoments = { twistAt: null, pricesAt: null, crisisAt: null, revealAt: null, closedAt: null, awardsAt: null };

describe("activeTakeover", () => {
  test("nothing has happened: the main screen", () => {
    expect(activeTakeover(NONE, T0)).toBeNull();
  });

  test("the twist shows for its whole window, then the main screen", () => {
    const m = { ...NONE, twistAt: iso(T0) };
    expect(activeTakeover(m, T0)).toEqual({ kind: "TWIST", at: iso(T0), until: iso(T0 + TAKEOVER_SECONDS.TWIST * 1000) });
    expect(activeTakeover(m, T0 + TAKEOVER_SECONDS.TWIST * 1000 - 1)?.kind).toBe("TWIST");
    expect(activeTakeover(m, T0 + TAKEOVER_SECONDS.TWIST * 1000)).toBeNull();
  });

  test("a moment in the future (clock skew) is not shown yet", () => {
    expect(activeTakeover({ ...NONE, pricesAt: iso(T0 + 5000) }, T0)).toBeNull();
  });

  test("a reload in the middle of a takeover shows the rest of it", () => {
    expect(activeTakeover({ ...NONE, crisisAt: iso(T0) }, T0 + 60_000)).toMatchObject({ kind: "CRISIS", until: iso(T0 + TAKEOVER_SECONDS.CRISIS * 1000) });
  });

  test("the newest takeover replaces an older one; the older one never comes back", () => {
    // In a rehearsal the 23:30 prices and the 23:45 crisis can be seconds apart.
    const m = { ...NONE, pricesAt: iso(T0), crisisAt: iso(T0 + 30_000) };
    expect(activeTakeover(m, T0 + 10_000)?.kind).toBe("PRICES");
    expect(activeTakeover(m, T0 + 40_000)?.kind).toBe("CRISIS");
    expect(activeTakeover(m, T0 + 30_000 + TAKEOVER_SECONDS.CRISIS * 1000)).toBeNull();
  });

  test("equal times: the later stage of the night wins", () => {
    expect(activeTakeover({ ...NONE, revealAt: iso(T0), closedAt: iso(T0) }, T0)?.kind).toBe("CLOSING_BELL");
  });

  test("the awards stay up", () => {
    const m = { ...NONE, closedAt: iso(T0), awardsAt: iso(T0 + 1000) };
    expect(activeTakeover(m, T0 + 10 * 3_600_000)).toEqual({ kind: "AWARDS", at: iso(T0 + 1000), until: null });
  });
});

describe("takeoverMs", () => {
  test("a rehearsal's faster clock shortens takeovers, never below the minimum", () => {
    expect(takeoverMs("REVEAL")).toBe(TAKEOVER_SECONDS.REVEAL * 1000);
    expect(takeoverMs("REVEAL", 2)).toBe((TAKEOVER_SECONDS.REVEAL / 2) * 1000);
    expect(takeoverMs("TWIST", 60)).toBe(TAKEOVER_MIN_SECONDS * 1000);
    expect(takeoverMs("CRISIS", Number.NaN)).toBe(TAKEOVER_SECONDS.CRISIS * 1000);
    expect(takeoverMs("AWARDS", 10)).toBeNull();
  });
});
