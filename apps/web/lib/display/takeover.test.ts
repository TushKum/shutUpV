import { describe, expect, test } from "vitest";
import { activeTakeover, TAKEOVER_MIN_SECONDS, TAKEOVER_SECONDS, takeoverMs, type TakeoverMoments } from "./takeover";

const T0 = Date.parse("2026-10-14T15:30:00.000Z"); // 21:00 IST
const iso = (ms: number) => new Date(ms).toISOString();
const NONE: TakeoverMoments = { drawnAt: null, crisisAt: null, verdicts: [], flashAt: null, closedAt: null, awardsAt: null };

describe("activeTakeover", () => {
  test("nothing has happened: the board", () => {
    expect(activeTakeover(NONE, T0)).toBeNull();
  });

  test("the draw shows for its whole window, then the board", () => {
    const m = { ...NONE, drawnAt: iso(T0) };
    expect(activeTakeover(m, T0)).toEqual({ kind: "DRAW", at: iso(T0), until: iso(T0 + TAKEOVER_SECONDS.DRAW * 1000) });
    expect(activeTakeover(m, T0 + TAKEOVER_SECONDS.DRAW * 1000 - 1)?.kind).toBe("DRAW");
    expect(activeTakeover(m, T0 + TAKEOVER_SECONDS.DRAW * 1000)).toBeNull();
  });

  test("a moment in the future (clock skew) is not shown yet", () => {
    expect(activeTakeover({ ...NONE, drawnAt: iso(T0 + 5000) }, T0)).toBeNull();
  });

  test("a reload in the middle of a takeover shows the rest of it", () => {
    const m = { ...NONE, crisisAt: iso(T0) };
    const t = activeTakeover(m, T0 + 60_000);
    expect(t).toMatchObject({ kind: "CRISIS", until: iso(T0 + TAKEOVER_SECONDS.CRISIS * 1000) });
  });

  test("the newest takeover replaces an older one that is still running", () => {
    const m = { ...NONE, flashAt: iso(T0), verdicts: [{ type: "FLASH" as const, at: iso(T0 + 30_000) }] };
    expect(activeTakeover(m, T0 + 10_000)?.kind).toBe("FLASH");
    expect(activeTakeover(m, T0 + 40_000)).toMatchObject({ kind: "VERDICTS", type: "FLASH" });
    // Once the verdicts end, the flash news (older, and already over) does not come back.
    expect(activeTakeover(m, T0 + 30_000 + TAKEOVER_SECONDS.VERDICTS * 1000)).toBeNull();
  });

  test("each score release is its own verdict takeover", () => {
    const m = {
      ...NONE,
      verdicts: [
        { type: "PITCH" as const, at: iso(T0) },
        { type: "PLAN" as const, at: iso(T0 + 3_600_000) },
      ],
    };
    expect(activeTakeover(m, T0 + 1000)).toMatchObject({ kind: "VERDICTS", type: "PITCH" });
    expect(activeTakeover(m, T0 + 3_600_000 + 1000)).toMatchObject({ kind: "VERDICTS", type: "PLAN" });
    expect(activeTakeover(m, T0 + 1_800_000)).toBeNull();
  });

  test("the awards stay up for the rest of the night", () => {
    const m = { ...NONE, closedAt: iso(T0), awardsAt: iso(T0 + 2_700_000) };
    expect(activeTakeover(m, T0 + 1000)?.kind).toBe("CLOSING_BELL");
    expect(activeTakeover(m, T0 + 2_000_000)).toBeNull();
    expect(activeTakeover(m, T0 + 2_700_000)).toEqual({ kind: "AWARDS", at: iso(T0 + 2_700_000), until: null });
    expect(activeTakeover(m, T0 + 86_400_000)?.kind).toBe("AWARDS");
  });

  test("two moments at the same time: the later stage of the night wins", () => {
    const m = { ...NONE, crisisAt: iso(T0), verdicts: [{ type: "PLAN" as const, at: iso(T0) }] };
    expect(activeTakeover(m, T0)?.kind).toBe("VERDICTS");
  });

  test("an unreadable time is ignored", () => {
    expect(activeTakeover({ ...NONE, drawnAt: "not a time" }, T0)).toBeNull();
  });

  test("an older takeover never comes back once a newer one has run out", () => {
    // The pitch scores were released 10 s after the draw: the draw would still have time left when the verdicts end.
    const m = { ...NONE, drawnAt: iso(T0), verdicts: [{ type: "PITCH" as const, at: iso(T0 + 10_000) }] };
    expect(activeTakeover(m, T0 + 5_000)?.kind).toBe("DRAW");
    expect(activeTakeover(m, T0 + 20_000)?.kind).toBe("VERDICTS");
    expect(activeTakeover(m, T0 + 10_000 + TAKEOVER_SECONDS.VERDICTS * 1000 + 5_000)).toBeNull();
  });

  test("a rehearsal's faster clock shortens takeovers in proportion, but not below the minimum", () => {
    expect(takeoverMs("DRAW", 1)).toBe(180_000);
    expect(takeoverMs("DRAW", 2)).toBe(90_000);
    expect(takeoverMs("DRAW", 10)).toBe(TAKEOVER_MIN_SECONDS * 1000);
    expect(takeoverMs("FLASH", 10)).toBe(TAKEOVER_MIN_SECONDS * 1000);
    expect(takeoverMs("AWARDS", 10)).toBeNull();
    // A nonsense speed counts as real time.
    expect(takeoverMs("CRISIS", 0)).toBe(120_000);
    const m = { ...NONE, verdicts: [{ type: "PLAN" as const, at: iso(T0) }] };
    expect(activeTakeover(m, T0 + 29_000, 10)).toMatchObject({ kind: "VERDICTS", until: iso(T0 + 30_000) });
    expect(activeTakeover(m, T0 + 30_000, 10)).toBeNull();
    expect(activeTakeover({ ...NONE, awardsAt: iso(T0) }, T0 + 86_400_000, 10)?.kind).toBe("AWARDS");
  });
});
