import { describe, expect, it } from "vitest";
import {
  breakdownLines,
  companyLabel,
  companyViews,
  defaultJudgeType,
  judging,
  latency,
  parseJudgeType,
  releaseMessage,
  sealMissingMessage,
  sealedScore,
  spread,
  summarise,
  type JudgeCompanyRow,
  type JudgeRows,
  type JudgeRunRow,
  type JudgeScoreRow,
  type JudgeSubmissionRow,
} from "./judge";

const company = (id: string, ticker: string | null, squad: number | null = null): JudgeCompanyRow => ({ id, ticker, name: ticker ? `${ticker} Inc` : null, squad });

const submission = (id: string, company_id: string, type: JudgeSubmissionRow["type"] = "PITCH"): JudgeSubmissionRow => ({
  id,
  company_id,
  type,
  word_count: 312,
  submitted_at: "2026-10-08T16:55:00Z",
  body_text: "Problem: unsafe water.",
});

let runSeq = 0;
const run = (submission_id: string, company_id: string, run_no: number, total: number | null, over: Partial<JudgeRunRow> = {}): JudgeRunRow => ({
  id: `run-${++runSeq}`,
  submission_id,
  company_id,
  type: "PITCH",
  generation: 1,
  run_no,
  model: "claude-opus-5-5",
  status: total === null ? "QUEUED" : "DONE",
  attempts: 1,
  breakdown: null,
  total,
  rationale: total === null ? null : "One. Two. Three.",
  error: null,
  latency_ms: 900,
  created_at: `2026-10-08T17:00:0${run_no}Z`,
  finished_at: null,
  ...over,
});

const score = (company_id: string, over: Partial<JudgeScoreRow> = {}): JudgeScoreRow => ({
  company_id,
  type: "PITCH",
  submission_id: null,
  generation: 1,
  status: "SEALED",
  run_totals: [64, 66, 68],
  median: 66,
  missing: false,
  capped: false,
  penalty: 0,
  final_score: 66,
  tier_bp: 500,
  breakdown: null,
  rationale: null,
  released_at: null,
  ...over,
});

const rows = (r: Partial<JudgeRows>): JudgeRows => ({ companies: [], submissions: [], runs: [], scores: [], ...r });

describe("which type to show", () => {
  it("reads ?type= in any case, and nothing else", () => {
    expect(parseJudgeType("plan")).toBe("PLAN");
    expect(parseJudgeType("FLASH")).toBe("FLASH");
    expect(parseJudgeType(["pitch", "plan"])).toBe("PITCH");
    expect(parseJudgeType("crisis")).toBeNull();
    expect(parseJudgeType(undefined)).toBeNull();
    expect(parseJudgeType("")).toBeNull();
  });

  it("defaults to what the night is working on", () => {
    expect(defaultJudgeType("SETUP")).toBe("PITCH");
    expect(defaultJudgeType("READING")).toBe("PITCH");
    expect(defaultJudgeType("RESCUE_2")).toBe("PITCH");
    expect(defaultJudgeType("PLANS_PUBLISHED")).toBe("PLAN");
    expect(defaultJudgeType("VERDICTS")).toBe("PLAN");
    expect(defaultJudgeType("ROUNDS_13_21")).toBe("FLASH");
    expect(defaultJudgeType("AWARDS")).toBe("FLASH");
  });
});

describe("spread", () => {
  it("is the highest minus the lowest, with at least two totals", () => {
    expect(spread([64, 66, 68])).toBe(4);
    expect(spread([50, 70, 62])).toBe(20);
    expect(spread([70])).toBeNull();
    expect(spread([])).toBeNull();
  });
});

describe("sealedScore", () => {
  it("counts a sealed or released score and ignores a pending one", () => {
    expect(sealedScore(score("a"))?.status).toBe("SEALED");
    expect(sealedScore(score("a", { status: "RELEASED" }))?.status).toBe("RELEASED");
    expect(sealedScore(score("a", { status: "PENDING" }))).toBeNull();
    expect(sealedScore(score("a", { status: "SCORING" }))).toBeNull();
    expect(sealedScore(undefined)).toBeNull();
  });
});

describe("companyViews", () => {
  it("says what each company is waiting for", () => {
    const companies = [
      company("none", "NONE"),
      company("fresh", "FRSH"),
      company("busy", "BUSY"),
      company("fail", "FAIL"),
      company("wide", "WIDE"),
      company("four", "FOUR"),
      company("done", "DONE"),
    ];
    const submissions = companies.filter((c) => c.id !== "none").map((c) => submission(`s-${c.id}`, c.id));
    const runs = [
      run("s-busy", "busy", 1, 60),
      run("s-busy", "busy", 2, 62),
      run("s-busy", "busy", 3, null, { status: "RUNNING" }),
      run("s-fail", "fail", 1, 60),
      run("s-fail", "fail", 2, null, { status: "FAILED", error: "rate limited", attempts: 3 }),
      run("s-fail", "fail", 3, 61),
      run("s-wide", "wide", 1, 50),
      run("s-wide", "wide", 2, 70),
      run("s-wide", "wide", 3, 62),
      run("s-four", "four", 1, 50),
      run("s-four", "four", 2, 70),
      run("s-four", "four", 3, 62),
      run("s-four", "four", 4, 60),
      run("s-done", "done", 1, 64),
      run("s-done", "done", 2, 66),
      run("s-done", "done", 3, 68),
    ];
    const views = companyViews("PITCH", rows({ companies, submissions, runs }));
    const by = Object.fromEntries(views.map((v) => [v.company.id, v]));
    expect(by.none!.status).toEqual({ label: "No submission", tone: "amber" });
    expect(by.fresh!.status).toEqual({ label: "Not judged", tone: "slate" });
    expect(by.busy!.status).toEqual({ label: "Judging: 2 of 3 runs done", tone: "blue" });
    expect(by.fail!.status).toEqual({ label: "Run failed", tone: "red" });
    expect(by.wide!.status).toEqual({ label: "Spread over 10: needs 2 more runs", tone: "amber" });
    expect(by.four!.status).toEqual({ label: "Runs incomplete", tone: "amber" });
    expect(by.done!.status).toEqual({ label: "Judged, not sealed", tone: "slate" });

    expect(by.wide!.spread).toBe(20);
    expect(by.wide!.median).toBeNull();
    expect(by.done!.totals).toEqual([64, 66, 68]);
    expect(by.done!.median).toEqual({ value: 66, sealed: false });
    expect(by.busy!.totals).toEqual([60, 62]);
    expect(by.busy!.spread).toBe(2);
  });

  it("takes the median of 5 runs once the 2 extra runs are in", () => {
    const sub = submission("s1", "a");
    const runs = [50, 70, 62, 60, 61].map((t, i) => run("s1", "a", i + 1, t));
    const [v] = companyViews("PITCH", rows({ companies: [company("a", "AAA")], submissions: [sub], runs }));
    expect(v!.median).toEqual({ value: 61, sealed: false });
    expect(v!.spread).toBe(20);
    expect(v!.status.label).toBe("Judged, not sealed");
  });

  it("shows a sealed score's median, final score and status; a missing one is 0 with no median", () => {
    const [sealed, missing, released] = companyViews(
      "PITCH",
      rows({
        companies: [company("a", "AAA"), company("b", "BBB"), company("c", "CCC")],
        submissions: [submission("s-a", "a"), submission("s-c", "c")],
        runs: [64, 66, 68].map((t, i) => run("s-a", "a", i + 1, t)),
        scores: [
          score("a", { submission_id: "s-a" }),
          score("b", { run_totals: [], median: null, missing: true, final_score: 0, tier_bp: -1000 }),
          score("c", { submission_id: "s-c", status: "RELEASED", released_at: "2026-10-08T17:46:00Z" }),
        ],
      }),
    );
    expect(sealed!.median).toEqual({ value: 66, sealed: true });
    expect(sealed!.status).toEqual({ label: "Sealed", tone: "blue" });
    expect(sealed!.stale).toBe(false);
    expect(missing!.median).toBeNull();
    expect(missing!.score?.final_score).toBe(0);
    expect(missing!.status).toEqual({ label: "Sealed: missing (0)", tone: "amber" });
    expect(missing!.stale).toBe(false);
    expect(released!.status).toEqual({ label: "Released", tone: "green" });
  });

  it("treats a pending score row as no score yet", () => {
    const [v] = companyViews(
      "PITCH",
      rows({
        companies: [company("a", "AAA")],
        submissions: [submission("s-a", "a")],
        runs: [64, 66, 68].map((t, i) => run("s-a", "a", i + 1, t)),
        scores: [score("a", { status: "PENDING", submission_id: "s-a", median: null, final_score: null })],
      }),
    );
    expect(v!.score).toBeNull();
    expect(v!.median).toEqual({ value: 66, sealed: false });
    expect(v!.status.label).toBe("Judged, not sealed");
  });

  it("flags a sealed score whose submission is no longer the current one", () => {
    const [v] = companyViews(
      "PITCH",
      rows({ companies: [company("a", "AAA")], submissions: [submission("s-new", "a")], scores: [score("a", { submission_id: "s-old" })] }),
    );
    expect(v!.stale).toBe(true);
    const [released] = companyViews(
      "PITCH",
      rows({ companies: [company("a", "AAA")], submissions: [submission("s-new", "a")], scores: [score("a", { submission_id: "s-old", status: "RELEASED" })] }),
    );
    expect(released!.stale).toBe(false);
  });

  it("shows the latest generation of the current submission, and lists every run (current first, newest generation first)", () => {
    const runs = [
      run("s-old", "a", 1, 40),
      run("s-cur", "a", 2, 70),
      run("s-cur", "a", 1, 50),
      run("s-cur", "a", 3, 62),
      run("s-cur", "a", 1, 64, { generation: 2 }),
      run("s-cur", "a", 2, 66, { generation: 2 }),
      run("s-cur", "a", 3, 68, { generation: 2 }),
    ];
    const [v] = companyViews("PITCH", rows({ companies: [company("a", "AAA")], submissions: [submission("s-cur", "a")], runs }));
    expect(v!.generation).toBe(2);
    expect(v!.runs.map((r) => r.total)).toEqual([64, 66, 68]);
    expect(v!.allRuns.map((r) => `${r.current ? "cur" : "old"} g${r.generation} r${r.run_no} ${r.total}`)).toEqual([
      "cur g2 r1 64",
      "cur g2 r2 66",
      "cur g2 r3 68",
      "cur g1 r1 50",
      "cur g1 r2 70",
      "cur g1 r3 62",
      "old g1 r1 40",
    ]);
  });

  it("keeps to one type and sorts by ticker, then squad for companies with no ticker yet", () => {
    const companies = [company("z", "ZED", 1), company("n2", null, 2), company("a", "ABC", 3), company("n1", null, 1)];
    const views = companyViews(
      "PLAN",
      rows({
        companies,
        submissions: [submission("s-a", "a", "PITCH"), submission("p-a", "a", "PLAN")],
        runs: [run("s-a", "a", 1, 60)],
        scores: [score("a")],
      }),
    );
    expect(views.map(companyLabel)).toEqual(["ABC", "ZED", "Squad 1", "Squad 2"]);
    expect(views[0]!.submission?.id).toBe("p-a");
    expect(views[0]!.runs).toEqual([]);
    expect(views[0]!.score).toBeNull();
  });
});

describe("summarise", () => {
  it("counts companies, submissions, current runs by status and scores", () => {
    const companies = [company("a", "AAA"), company("b", "BBB"), company("c", "CCC"), company("d", "DDD")];
    const views = companyViews(
      "PITCH",
      rows({
        companies,
        submissions: [submission("s-a", "a"), submission("s-b", "b"), submission("s-c", "c")],
        runs: [
          run("s-a", "a", 1, 64),
          run("s-a", "a", 2, 66),
          run("s-a", "a", 3, 68),
          run("s-b", "b", 1, null),
          run("s-b", "b", 2, null, { status: "RUNNING" }),
          run("s-b", "b", 3, null, { status: "FAILED" }),
          run("s-old", "c", 1, null), // an earlier submission's run is not counted
        ],
        scores: [score("a", { submission_id: "s-a" }), score("d", { median: null, missing: true, final_score: 0 })],
      }),
    );
    const s = summarise("PITCH", views);
    expect(s).toEqual({
      type: "PITCH",
      companies: 4,
      submissions: 3,
      runs: { QUEUED: 1, RUNNING: 1, DONE: 3, FAILED: 1 },
      sealed: 2,
      released: 0,
      missing: 1,
      unsealed: 2,
      stale: 0,
      releasedAt: null,
    });
    expect(judging([s])).toBe(true);
  });

  it("gives the release time and says when nothing is being judged", () => {
    const views = companyViews(
      "FLASH",
      rows({
        companies: [company("a", "AAA"), company("b", "BBB")],
        scores: [
          score("a", { type: "FLASH", status: "RELEASED", released_at: "2026-10-08T22:50:00.1Z" }),
          score("b", { type: "FLASH", status: "RELEASED", released_at: "2026-10-08T22:50:00.2Z", missing: true }),
        ],
      }),
    );
    const s = summarise("FLASH", views);
    expect(s.released).toBe(2);
    expect(s.unsealed).toBe(0);
    expect(s.missing).toBe(1);
    expect(s.releasedAt).toBe("2026-10-08T22:50:00.2Z");
    expect(judging([s])).toBe(false);
  });
});

describe("run detail", () => {
  it("lists the rubric lines in order with the run's points and maxima, then any unknown line", () => {
    expect(breakdownLines("FLASH", { clear: 15, responds_to_news: "40", bonus: 5 })).toEqual([
      { key: "responds_to_news", label: "Responds directly to the news", value: 40, max: 50 },
      { key: "realistic", label: "Realistic", value: null, max: 30 },
      { key: "clear", label: "Clear", value: 15, max: 20 },
      { key: "bonus", label: "bonus", value: 5, max: null },
    ]);
    expect(breakdownLines("PITCH", null)).toEqual([]);
  });

  it("writes the latency in ms or seconds", () => {
    expect(latency(850)).toBe("850 ms");
    expect(latency(12_400)).toBe("12.4 s");
    expect(latency(null)).toBe("—");
  });
});

describe("messages", () => {
  it("says what sealing did", () => {
    expect(sealMissingMessage("PLAN", 0)).toBe("No missing plan scores to seal: every company has an on-time submission or a score.");
    expect(sealMissingMessage("PITCH", 1)).toBe("Sealed 1 missing pitch score as 0.");
    expect(sealMissingMessage("FLASH", 3)).toBe("Sealed 3 missing flash scores as 0.");
  });

  it("says what the release did", () => {
    expect(releaseMessage("PITCH", 50)).toBe("Released 50 pitch scores; IPO prices are set.");
    expect(releaseMessage("PLAN", 1)).toBe("Released 1 plan score; the tiers moved the market and AI prices.");
  });
});
