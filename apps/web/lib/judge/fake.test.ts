import { describe, expect, test } from "vitest";
import { RUBRICS, SUBMISSION_TYPES, validateJudgeOutput } from "@msim/engine";
import { FAKE_MODEL, fakeJudge, fakeJudgeOutput } from "./fake";
import { fakeJudgeRefusal } from "./index";

const request = (i: number) => `<submission type="PRD" ticker="AQSX">\nPRD number ${i}\n</submission>`;

describe("fakeJudgeOutput", () => {
  test.each(SUBMISSION_TYPES)("%s: every run is a valid answer (lines within their maximum, total = sum, three sentences)", (type) => {
    for (let i = 0; i < 40; i++) {
      for (let run = 1; run <= 5; run++) {
        const out = fakeJudgeOutput(type, request(i), run);
        const check = validateJudgeOutput(type, JSON.stringify(out));
        expect(check.ok).toBe(true);
        expect(Object.keys(out.breakdown)).toEqual(RUBRICS[type].map((l) => l.key));
        expect(out.rationale.match(/\. /g)?.length).toBe(2);
      }
    }
  });

  test("deterministic: the same request and run always give the same answer", () => {
    expect(fakeJudgeOutput("SOLUTION", request(1), 2)).toEqual(fakeJudgeOutput("SOLUTION", request(1), 2));
  });

  test("varies by run and by request", () => {
    const runs = [1, 2, 3, 4, 5].map((n) => JSON.stringify(fakeJudgeOutput("PRD", request(7), n).breakdown));
    expect(new Set(runs).size).toBeGreaterThan(1);
    const requests = Array.from({ length: 10 }, (_, i) => fakeJudgeOutput("PRD", request(i), 1).total);
    expect(new Set(requests).size).toBeGreaterThan(3);
  });

  test("the three readings of a submission differ a little, as a real judge's do", () => {
    const spreads = Array.from({ length: 30 }, (_, i) => {
      const t = [1, 2, 3].map((n) => fakeJudgeOutput("PRD", request(i), n).total);
      return Math.max(...t) - Math.min(...t);
    });
    expect(spreads.some((s) => s > 0)).toBe(true);
    expect(Math.max(...spreads)).toBeLessThanOrEqual(36);
  });
});

describe("fakeJudge", () => {
  test("answers like the real judge after the simulated latency", async () => {
    const judge = fakeJudge({ latencyMs: 20 });
    const t0 = Date.now();
    const r = await judge({ type: "SOLUTION", model: "ignored", system: "S", userText: request(1), requestText: request(1), runNo: 3 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(15);
    expect(r).toMatchObject({ ok: true, model: FAKE_MODEL, attempts: 1 });
    if (r.ok) {
      expect(JSON.parse(r.raw)).toEqual(fakeJudgeOutput("SOLUTION", request(1), 3));
      expect(r.total).toBe(fakeJudgeOutput("SOLUTION", request(1), 3).total);
    }
  });

  test("an aborted call goes back to the queue (retryable)", async () => {
    const judge = fakeJudge({ latencyMs: 10_000 });
    const ac = new AbortController();
    const p = judge({ type: "PRD", model: "x", system: "S", userText: "U", requestText: "U", runNo: 1, signal: ac.signal });
    ac.abort();
    expect(await p).toMatchObject({ ok: false, retryable: true });
  });

  test("is refused on a live event and allowed on a rehearsal", () => {
    expect(fakeJudgeRefusal({ fake: true }, { is_rehearsal: false })).toMatch(/live event/);
    expect(fakeJudgeRefusal({ fake: true }, { is_rehearsal: true })).toBeNull();
    expect(fakeJudgeRefusal({ fake: false }, { is_rehearsal: false })).toBeNull();
  });
});
