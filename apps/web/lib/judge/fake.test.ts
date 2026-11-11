import { describe, expect, test } from "vitest";
import { needsExtraRuns, RUBRICS, SUBMISSION_TYPES, validateJudgeOutput } from "@msim/engine";
import { FAKE_MODEL, fakeJudge, fakeJudgeOutput } from "./fake";
import { fakeJudgeRefusal } from "./index";

const request = (i: number) => `<submission type="PITCH" ticker="AQS">\nPitch number ${i}\n</submission>`;

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
    expect(fakeJudgeOutput("PLAN", request(1), 2)).toEqual(fakeJudgeOutput("PLAN", request(1), 2));
  });

  test("varies by run and by request", () => {
    const runs = [1, 2, 3, 4, 5].map((n) => JSON.stringify(fakeJudgeOutput("PITCH", request(7), n).breakdown));
    expect(new Set(runs).size).toBeGreaterThan(1);
    const requests = Array.from({ length: 10 }, (_, i) => fakeJudgeOutput("PITCH", request(i), 1).total);
    expect(new Set(requests).size).toBeGreaterThan(3);
  });

  test("some submissions spread more than 10 points over runs 1–3 (so rehearsals exercise runs 4 and 5), most do not", () => {
    const spreads = Array.from({ length: 60 }, (_, i) =>
      needsExtraRuns([1, 2, 3].map((n) => fakeJudgeOutput("PITCH", request(i), n).total)),
    );
    expect(spreads.some(Boolean)).toBe(true);
    expect(spreads.filter(Boolean).length).toBeLessThan(30);
  });
});

describe("fakeJudge", () => {
  test("answers like the real judge after the simulated latency", async () => {
    const judge = fakeJudge({ latencyMs: 20 });
    const t0 = Date.now();
    const r = await judge({ type: "FLASH", model: "ignored", system: "S", userText: request(1), requestText: request(1), runNo: 3 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(15);
    expect(r).toMatchObject({ ok: true, model: FAKE_MODEL, attempts: 1 });
    if (r.ok) {
      expect(JSON.parse(r.raw)).toEqual(fakeJudgeOutput("FLASH", request(1), 3));
      expect(r.total).toBe(fakeJudgeOutput("FLASH", request(1), 3).total);
    }
  });

  test("an aborted call goes back to the queue (retryable)", async () => {
    const judge = fakeJudge({ latencyMs: 10_000 });
    const ac = new AbortController();
    const p = judge({ type: "PITCH", model: "x", system: "S", userText: "U", requestText: "U", runNo: 1, signal: ac.signal });
    ac.abort();
    expect(await p).toMatchObject({ ok: false, retryable: true });
  });

  test("is refused on a live event and allowed on a rehearsal", () => {
    expect(fakeJudgeRefusal({ fake: true }, { is_rehearsal: false })).toMatch(/live event/);
    expect(fakeJudgeRefusal({ fake: true }, { is_rehearsal: true })).toBeNull();
    expect(fakeJudgeRefusal({ fake: false }, { is_rehearsal: false })).toBeNull();
  });
});
