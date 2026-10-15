import { describe, expect, it } from "vitest";
import {
  appealChange,
  appealViews,
  applyMessage,
  breakdownLines,
  companyLabel,
  companyViews,
  defaultJudgeType,
  dismissMessage,
  duration,
  effectLines,
  judgeProgress,
  judging,
  latency,
  modelMessage,
  modelSwitch,
  pace,
  parseEffects,
  parseJudgeType,
  perMinuteText,
  refreshInterval,
  releaseMessage,
  rerunBlock,
  rerunMessage,
  retryMessage,
  runIssues,
  runModels,
  scoreWithTier,
  scoringClosed,
  scoringClosesAt,
  sealMissingMessage,
  sealedScore,
  spread,
  startBlock,
  startMessage,
  summarise,
  targetText,
  type JudgeAppealRow,
  type JudgeCompanyRow,
  type JudgeRows,
  type JudgeRunRow,
  type JudgeScoreRow,
  type JudgeSubmissionRow,
  type TargetCheck,
  type TypeSummary,
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

const rows = (r: Partial<JudgeRows>): JudgeRows => ({ companies: [], submissions: [], runs: [], scores: [], appeals: [], ...r });

let appealSeq = 0;
const appeal = (company_id: string, submission_id: string, over: Partial<JudgeAppealRow> = {}): JudgeAppealRow => ({
  id: `appeal-${++appealSeq}`,
  company_id,
  type: "PLAN",
  submission_id,
  generation: 2,
  after_release: true,
  reason: "The judge's answer was cut off.",
  status: "JUDGING",
  requested_at: "2026-10-08T22:10:00Z",
  old_score: { final: 50, median: 50, tier_bp: 0 },
  new_score: null,
  ready_at: null,
  decided_at: null,
  note: null,
  effects: null,
  ...over,
});

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

  it("the page polls every 3 s while any run of the event is in flight, every 15 s until every score is released, then not at all", () => {
    const base = { companies: 2, submissions: 2, sealed: 0, released: 0, missing: 0, unsealed: 2, stale: 0, releasedAt: null };
    const runs = (queued: number) => ({ QUEUED: queued, RUNNING: 0, DONE: 0, FAILED: 0 }) as TypeSummary["runs"];
    const done = [{ status: "DONE" as const }, { status: "FAILED" as const }];
    expect(refreshInterval([{ ...base, type: "PITCH", runs: runs(1) }], [])).toBe(3000);
    expect(refreshInterval([{ ...base, type: "PITCH", runs: runs(0) }], done)).toBe(15_000);
    expect(refreshInterval([{ ...base, type: "PITCH", runs: runs(0), released: 2, unsealed: 0 }], done)).toBeNull();
    expect(refreshInterval([{ ...base, type: "PITCH", runs: runs(0), companies: 0 }], [])).toBeNull();
    // A run of any submission counts (an appeal of a released score, an earlier generation).
    expect(refreshInterval([{ ...base, type: "PLAN", runs: runs(0), released: 2, unsealed: 0 }], [...done, { status: "RUNNING" }])).toBe(3000);
    expect(refreshInterval([{ ...base, type: "PLAN", runs: runs(0), released: 2, unsealed: 0 }], [{ status: "QUEUED" }])).toBe(3000);
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

  it("says what starting, retrying and the model switch did", () => {
    expect(startMessage("PITCH", 150, 50)).toBe("Queued 150 runs for 50 companies.");
    expect(startMessage("FLASH", 3, 1)).toBe("Queued 3 runs for 1 company.");
    expect(startMessage("PLAN", 0, 0)).toBe("Nothing to queue: every current plan submission already has judge runs.");
    expect(retryMessage(1)).toBe("Sent 1 failed run back to the queue.");
    expect(retryMessage(4)).toBe("Sent 4 failed runs back to the queue.");
    expect(retryMessage(0)).toBe("No failed runs to send back to the queue.");
    const models = { PRIMARY: "claude-opus-5-5", BACKUP: "claude-sonnet-5-5" };
    expect(modelSwitch("PRIMARY", models)).toEqual({
      to: "BACKUP",
      label: "Switch to the backup model",
      confirm: "Click again to switch to the backup model (claude-sonnet-5-5)",
    });
    expect(modelSwitch("BACKUP", null)).toEqual({ to: "PRIMARY", label: "Switch back to the primary model", confirm: "Click again to switch back to the primary model" });
    expect(modelMessage("BACKUP", "claude-sonnet-5-5")).toBe(
      "Runs claimed from now on use the backup model (claude-sonnet-5-5); runs already running finish as they are.",
    );
  });

  it("says what a re-run and a dismissal did", () => {
    expect(rerunMessage("KAQ", "PITCH", false, 2)).toBe("Re-running KAQ's pitch: 3 new runs are queued (generation 2). The score is sealed again when they are done.");
    expect(rerunMessage("AQS", "PLAN", true, 3)).toBe(
      "Appeal opened: 3 new runs of AQS's plan are queued (generation 3). The released score stays until you apply or dismiss the new one.",
    );
    expect(dismissMessage("AQS", "FLASH")).toBe("Appeal dismissed: AQS's released flash score stays.");
  });
});

// ───────────────────────────── Progress ─────────────────────────────

const T0 = Date.parse("2026-10-08T17:30:00Z"); // 23:00:00 IST
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

describe("judgeProgress", () => {
  const companies = [company("a", "AAA"), company("b", "BBB"), company("c", "CCC"), company("d", "DDD")];
  const submissions = ["a", "b", "c"].map((c) => submission(`s-${c}`, c));
  const done = (sub: string, c: string, no: number, total: number, finished: number) =>
    run(sub, c, no, total, { created_at: at(0), finished_at: at(finished) });
  const busy = [
    done("s-a", "a", 1, 64, 60),
    done("s-a", "a", 2, 66, 70),
    done("s-a", "a", 3, 68, 80),
    done("s-b", "b", 1, 50, 85),
    done("s-b", "b", 2, 70, 90),
    done("s-b", "b", 3, 62, 95),
    run("s-b", "b", 4, null, { status: "RUNNING", attempts: 1, created_at: at(95) }),
    run("s-b", "b", 5, null, { created_at: at(95) }),
    done("s-c", "c", 1, 60, 110),
    run("s-c", "c", 2, null, { status: "RUNNING", attempts: 1, created_at: at(0) }),
    run("s-c", "c", 3, null, { status: "FAILED", attempts: 5, error: "overloaded", created_at: at(0), finished_at: at(100) }),
  ];
  const scores = [score("a", { submission_id: "s-a" }), score("d", { median: null, missing: true, final_score: 0 })];

  it("counts runs done of runs needed (3 per submission plus the extra runs), companies sealed, and the pace", () => {
    const data = rows({ companies, submissions, runs: busy, scores });
    const p = judgeProgress("PITCH", companyViews("PITCH", data), data.runs, T0 + 120_000);
    expect(p).toMatchObject({
      submissions: 3,
      sealed: 1, // the missing 0 of DDD is not a submission
      notStarted: 0,
      needed: 11,
      done: 7,
      runs: { QUEUED: 1, RUNNING: 2, DONE: 7, FAILED: 1 },
      remaining: 3,
      startedAt: at(0),
      finishedAt: null,
      elapsedMs: 120_000,
    });
    expect(p.perMinute).toBeCloseTo(3.5); // 7 runs done in the last 2 minutes
    expect(p.etaMs).toBeCloseTo((3 / 3.5) * 60_000);
    // The first pass: 9 runs (3 per submission), 7 done; 2 more at 3.5/min end at 23:02:34, before 23:10:00.
    expect(p.target).toMatchObject({ runs: 9, done: 7, startedAt: at(0), deadline: at(600), state: "ON_PACE", tookMs: null });
    expect(targetText(p.target!)).toBe("On pace: done at about 23:02:34, before 23:10:00.");
  });

  it("before Start judging: every submission's 3 runs are still to do, with no timing", () => {
    const data = rows({ companies, submissions });
    const p = judgeProgress("PITCH", companyViews("PITCH", data), data.runs, T0);
    expect(p).toMatchObject({ submissions: 3, notStarted: 3, needed: 9, done: 0, remaining: 9, startedAt: null, elapsedMs: null, perMinute: null, etaMs: null, target: null });
  });

  it("once everything is done the clock stops at the last run, and the target is met or missed", () => {
    const all = [
      ...busy.filter((r) => r.company_id === "a"),
      done("s-b", "b", 1, 64, 200),
      done("s-b", "b", 2, 66, 230),
      done("s-b", "b", 3, 68, 250),
      done("s-c", "c", 1, 60, 300),
      done("s-c", "c", 2, 61, 400),
      done("s-c", "c", 3, 62, 460),
    ];
    const data = rows({ companies, submissions, runs: all });
    const p = judgeProgress("PITCH", companyViews("PITCH", data), data.runs, T0 + 3_600_000);
    expect(p).toMatchObject({ needed: 9, done: 9, remaining: 0, finishedAt: at(460), elapsedMs: 460_000, etaMs: null });
    expect(p.perMinute).toBeCloseTo(1); // 2 runs done in the 2 minutes before 23:07:40 (the last one)
    expect(p.target).toMatchObject({ state: "MET", tookMs: 460_000 });
    expect(targetText(p.target!)).toBe("Met: 9 runs in 7 min 40 s.");

    const slow = rows({ companies, submissions, runs: all.map((r) => (r.run_no === 3 && r.company_id === "c" ? { ...r, finished_at: at(700) } : r)) });
    const q = judgeProgress("PITCH", companyViews("PITCH", slow), slow.runs, T0 + 3_600_000);
    expect(q.target).toMatchObject({ state: "MISSED", tookMs: 700_000 });
    expect(targetText(q.target!)).toBe("Missed: 9 runs took 11 min 40 s.");
  });

  it("the target is judged on runs 1–3 of the first generation: a later re-run does not move it", () => {
    const all = [
      ...["a", "b", "c"].flatMap((c) => [1, 2, 3].map((no) => done(`s-${c}`, c, no, 60, 100 + no))),
      ...[1, 2, 3].map((no) => run("s-a", "a", no, 61, { generation: 2, created_at: at(3000), finished_at: at(3030 + no) })),
    ];
    const data = rows({ companies, submissions, runs: all });
    const p = judgeProgress("PITCH", companyViews("PITCH", data), data.runs, T0 + 4000_000);
    expect(p).toMatchObject({ needed: 9, done: 9, finishedAt: at(3033), elapsedMs: 3033_000 });
    expect(p.target).toMatchObject({ runs: 9, done: 9, state: "MET", tookMs: 103_000 });
  });

  it("behind, missed while running, and no pace yet", () => {
    const slow = [
      done("s-a", "a", 1, 60, 300),
      ...[2, 3].map((no) => run("s-a", "a", no, null, { created_at: at(0) })),
      ...["b", "c"].flatMap((c) => [1, 2, 3].map((no) => run(`s-${c}`, c, no, null, { created_at: at(0) }))),
    ];
    const data = rows({ companies, submissions, runs: slow });
    const views = companyViews("PITCH", data);
    // 1 run done in the last 2 minutes: 8 more take 16 minutes, past 23:10.
    const behind = judgeProgress("PITCH", views, data.runs, T0 + 360_000);
    expect(behind.perMinute).toBeCloseTo(0.5);
    expect(behind.target).toMatchObject({ state: "BEHIND", projectedAt: at(360 + 16 * 60) });
    expect(targetText(behind.target!)).toBe(
      "Behind: at this pace it ends at about 23:22:00, after 23:10:00. Run the judge on more consoles, or switch to the backup model.",
    );
    const none = judgeProgress("PITCH", views, data.runs, T0 + 500_000);
    expect(none.perMinute).toBe(0);
    expect(none.etaMs).toBeNull();
    expect(none.target?.state).toBe("NO_PACE");
    expect(targetText(none.target!)).toBe("No pace yet (no run has finished lately): the target is 23:10:00.");
    const missed = judgeProgress("PITCH", views, data.runs, T0 + 601_000);
    expect(missed.target).toMatchObject({ state: "MISSED", tookMs: null });
    expect(targetText(missed.target!)).toBe("Missed: 10 minutes have passed with 8 of 9 runs still to do.");
  });

  it("measures the pace over the last 2 minutes, or since the start (at least 15 s)", () => {
    const runs = [10, 20, 100, 170].map((s) => ({ status: "DONE" as const, finished_at: at(s) }));
    expect(pace(runs, T0, T0 + 180_000)).toBeCloseTo(1); // 100 and 170 in (60, 180]
    expect(pace(runs, T0, T0 + 30_000)).toBeCloseTo(4); // 10, 20 in 30 s
    expect(pace(runs, T0, T0 + 5_000)).toBe(0); // over 15 s
    expect(pace([{ status: "FAILED", finished_at: at(170) }], T0, T0 + 180_000)).toBe(0);
    expect(pace(runs, T0, T0)).toBeNull();
  });

  it("writes durations and paces", () => {
    expect(duration(42_000)).toBe("42 s");
    expect(duration(460_000)).toBe("7 min 40 s");
    expect(duration(120_000)).toBe("2 min");
    expect(duration(3_900_000)).toBe("1 h 5 min");
    expect(duration(null)).toBe("—");
    expect(perMinuteText(28.4)).toBe("28 runs/min");
    expect(perMinuteText(2.46)).toBe("2.5 runs/min");
    expect(perMinuteText(1)).toBe("1 run/min");
    expect(perMinuteText(null)).toBe("—");
  });

  it("says when the target was met", () => {
    const t: TargetCheck = { runs: 150, done: 150, startedAt: at(0), deadline: at(600), state: "MET", tookMs: 412_000, projectedAt: null };
    expect(targetText(t)).toBe("Met: 150 runs in 6 min 52 s.");
  });
});

// ───────────────────────────── When judging may start ─────────────────────────────

describe("when judging may start", () => {
  const deadlines = { PITCH: at(0), PLAN: at(100), DEAL: at(200), FLASH: at(300) };

  it("after the type's deadline; plans after both the plan and the deal deadlines", () => {
    expect(scoringClosesAt("PITCH", deadlines)).toBe(at(0));
    expect(scoringClosesAt("PLAN", deadlines)).toBe(at(200));
    expect(scoringClosesAt("PLAN", { PLAN: at(300), DEAL: at(200) })).toBe(at(300));
    expect(scoringClosesAt("PLAN", { PLAN: at(300) })).toBeNull();
    expect(scoringClosed("PITCH", deadlines, T0 + 1, null)).toBe(true);
    expect(scoringClosed("PITCH", deadlines, T0, null)).toBe(false);
    expect(scoringClosed("PLAN", deadlines, T0 + 150_000, null)).toBe(false);
    expect(scoringClosed("PLAN", deadlines, T0 + 201_000, null)).toBe(true);
    expect(scoringClosed("FLASH", {}, T0, null)).toBe(false);
  });

  it("a deadline after the pause began has not passed while the event is paused", () => {
    expect(scoringClosed("FLASH", deadlines, T0 + 400_000, at(250))).toBe(false);
    expect(scoringClosed("PITCH", deadlines, T0 + 400_000, at(250))).toBe(true);
  });

  it("says why Start judging is off", () => {
    expect(startBlock("PITCH", { closed: true, released: false, closesAt: at(0) })).toBeNull();
    expect(startBlock("PLAN", { closed: false, released: false, closesAt: at(200) })).toBe("Plan judging starts after the plan and deal deadlines (23:03).");
    expect(startBlock("FLASH", { closed: false, released: false, closesAt: null })).toBe("Flash judging starts after the flash deadline.");
    expect(startBlock("PITCH", { closed: true, released: true, closesAt: at(0) })).toBe("Pitch scores have been released.");
  });
});

// ───────────────────────────── Re-runs and appeals ─────────────────────────────

describe("re-runs and appeals", () => {
  const judged = (over: Partial<JudgeScoreRow> = {}, runs: JudgeRunRow[] = [64, 66, 68].map((t, i) => run("s-a", "a", i + 1, t))) =>
    companyViews("PITCH", rows({ companies: [company("a", "AAA")], submissions: [submission("s-a", "a")], runs, scores: [score("a", { submission_id: "s-a", ...over })] }))[0]!;
  const open = { phase: "READING" as const, closed: true };

  it("a judged submission can be re-run; the reasons it cannot", () => {
    expect(rerunBlock("PITCH", judged(), open)).toBeNull();
    expect(rerunBlock("PLAN", judged({ status: "RELEASED" }), open)).toBeNull(); // a released plan is appealed
    expect(rerunBlock("PITCH", judged({ status: "RELEASED" }), open)).toBe(
      "A released pitch score cannot be re-run: it has set the IPO price and the IPO is allocated.",
    );
    expect(rerunBlock("PITCH", judged(), { phase: "AWARDS", closed: true })).toBe("Appeals are decided before the awards.");
    expect(rerunBlock("PITCH", judged(), { phase: "BUILD", closed: false })).toBe("A submission is judged after its deadline.");
    expect(rerunBlock("PITCH", judged({}, [run("s-a", "a", 1, 60), run("s-a", "a", 2, null, { status: "RUNNING" })]), open)).toBe(
      "The judge is still working on this submission: wait for its runs to finish.",
    );
    expect(rerunBlock("PITCH", judged({}, []), open)).toBe("Not judged yet: Start judging queues its runs.");
    const [none] = companyViews("PITCH", rows({ companies: [company("a", "AAA")] }));
    expect(rerunBlock("PITCH", none!, open)).toBe("No on-time submission to judge again.");
    const ready = companyViews(
      "PLAN",
      rows({
        companies: [company("a", "AAA")],
        submissions: [submission("p-a", "a", "PLAN")],
        runs: [1, 2, 3].map((no) => run("p-a", "a", no, 40, { type: "PLAN", generation: 2 })),
        appeals: [appeal("a", "p-a", { status: "READY", new_score: { final: 40, tier_bp: -1000 } })],
      }),
    )[0]!;
    expect(ready.appeal?.badge).toEqual({ label: "New score ready: apply or dismiss", tone: "amber" });
    expect(rerunBlock("PLAN", ready, open)).toBe("A new score is waiting: apply or dismiss it under Appeals and re-runs first.");
  });

  it("shows the company's latest re-run, and leaves out a dismissed generation's runs", () => {
    const runs = [
      ...[64, 66, 68].map((t, i) => run("p-a", "a", i + 1, t, { type: "PLAN" })),
      ...[1, 2, 3].map((no) => run("p-a", "a", no, null, { type: "PLAN", generation: 2, status: "FAILED", error: "The appeal was dismissed." })),
    ];
    const [v] = companyViews(
      "PLAN",
      rows({
        companies: [company("a", "AAA")],
        submissions: [submission("p-a", "a", "PLAN")],
        runs,
        scores: [score("a", { type: "PLAN", submission_id: "p-a", status: "RELEASED" })],
        appeals: [
          appeal("a", "p-a", { generation: 2, status: "DISMISSED", requested_at: "2026-10-08T22:20:00Z", note: "Judged correctly." }),
          appeal("a", "p-a", { generation: 1, status: "APPLIED", after_release: false, requested_at: "2026-10-08T21:00:00Z" }),
        ],
      }),
    );
    expect(v!.appeal?.badge).toEqual({ label: "Re-run: dismissed", tone: "slate" });
    expect(v!.generation).toBe(1);
    expect(v!.totals).toEqual([64, 66, 68]);
    expect(v!.allRuns.filter((r) => r.dismissed)).toHaveLength(3);
    // The dismissed runs are not failed runs to retry.
    expect(summarise("PLAN", [v!]).runs).toEqual({ QUEUED: 0, RUNNING: 0, DONE: 3, FAILED: 0 });
  });

  it("lists every appeal: waiting for an organiser first, then the judge's, then the decided, newest first", () => {
    const companies = [company("a", "AQS"), company("b", "BBB"), company("c", "CCC")];
    const runs = [
      ...[40, 40, 42].map((t, i) => run("p-a", "a", i + 1, t, { type: "PLAN", generation: 2 })),
      run("f-b", "b", 1, 30, { type: "FLASH", generation: 2 }),
      run("f-b", "b", 2, null, { type: "FLASH", generation: 2, status: "RUNNING" }),
      run("f-b", "b", 3, null, { type: "FLASH", generation: 2, status: "FAILED" }),
    ];
    const effects = {
      score: { from: 66, to: 70 },
      tier_bp: { from: 500, to: 500 },
      ai_price: { from: 1050, to: 1050 },
      closing_price: null,
      short_cover_cents: 0,
      plan_bonus_cents: 0,
      calls: [],
      settled: false,
    };
    const views = appealViews(
      rows({
        companies,
        runs,
        appeals: [
          appeal("c", "s-c", { type: "PITCH", generation: 2, after_release: false, status: "APPLIED", requested_at: "2026-10-08T17:40:00Z", new_score: { final: 70, tier_bp: 500 } }),
          appeal("b", "f-b", { type: "FLASH", status: "JUDGING", requested_at: "2026-10-08T23:00:00Z", old_score: { final: 30, tier_bp: -1000 } }),
          appeal("a", "p-a", { status: "READY", requested_at: "2026-10-08T22:10:00Z", new_score: { final: 40, tier_bp: -1000 } }),
          appeal("c", "p-c", { status: "APPLIED", requested_at: "2026-10-08T22:30:00Z", effects }),
        ],
      }),
    );
    expect(views.map((v) => `${v.label} ${v.type} ${v.status}`)).toEqual(["AQS PLAN READY", "BBB FLASH JUDGING", "CCC PLAN APPLIED", "CCC PITCH APPLIED"]);
    const [ready, judging_, applied, before] = views;
    expect(ready).toMatchObject({ canApply: true, canDismiss: true, runs: { done: 3, failed: 0, inFlight: 0, total: 3 }, from: { final: 50, tier_bp: 0 }, to: { final: 40, tier_bp: -1000 } });
    expect(judging_).toMatchObject({ canApply: false, canDismiss: true, runs: { done: 1, failed: 1, inFlight: 1, total: 3 }, to: null });
    expect(applied!.effects).toEqual(effects);
    expect(before).toMatchObject({ afterRelease: false, canApply: false, canDismiss: false });
    expect(scoreWithTier(ready!.from)).toBe("50 (0%)");
    expect(scoreWithTier(ready!.to)).toBe("40 (−10%)");
    expect(scoreWithTier(judging_!.to)).toBe("—");
    expect(appealChange(ready!)).toBe("AQS plan 50 → 40");
  });

  it("says what an applied appeal changed", () => {
    const e = parseEffects({
      score: { from: 50, to: 40 },
      tier_bp: { from: 0, to: -1000 },
      ai_price: { from: 850, to: 765 },
      closing_price: { from: 815, to: 773 },
      short_cover_cents: -4200,
      plan_bonus_cents: -500000,
      calls: [{ team_id: "t1", cents: -250000 }, { team_id: "t2", cents: "250000" }, { cents: 5 }],
      settled: true,
    })!;
    expect(e.calls).toEqual([{ team_id: "t1", cents: -250000 }, { team_id: "t2", cents: 250000 }]);
    expect(effectLines(e)).toEqual([
      "Score 50 → 40",
      "Tier 0% → −10%",
      "AI price $8.50 → $7.65",
      "Closing price $8.15 → $7.73",
      "Shorts covered at the close get $42.00 back",
      "Consultant's plan bonus −$5,000.00",
      "Consultant call 3 judged again: 2 calls changed ($0.00)",
      "Results and rankings computed again",
    ]);
    expect(applyMessage("CCRT", "PLAN", e)).toBe(
      "Applied: CCRT plan score 50 → 40; tier 0% → −10%; AI price $8.50 → $7.65; closing price $8.15 → $7.73; shorts covered at the close get $42.00 back; consultant's plan bonus −$5,000.00; consultant call 3 judged again: 2 calls changed ($0.00); results and rankings computed again.",
    );
    const before = parseEffects({ score: { from: 30, to: 45 }, tier_bp: { from: -1000, to: 0 }, ai_price: { from: 900, to: 1000 }, closing_price: null, short_cover_cents: 1200, plan_bonus_cents: 0, calls: [], settled: false })!;
    expect(applyMessage("AQS", "FLASH", before)).toBe("Applied: AQS flash score 30 → 45; tier −10% → 0%; AI price $9.00 → $10.00; shorts covered at the close pay $12.00 more.");
    expect(applyMessage("AQS", "FLASH", null)).toBe("Applied the new AQS flash score.");
    expect(parseEffects(null)).toBeNull();
  });
});

describe("the Runs column", () => {
  it("names the models used and the runs that failed or wait to be tried again", () => {
    const runs = [
      run("s", "a", 1, 60, { model: "claude-opus-5-5" }),
      run("s", "a", 2, null, { status: "FAILED", attempts: 5, error: "overloaded (529)", model: "claude-opus-5-5" }),
      run("s", "a", 3, null, { status: "QUEUED", attempts: 1, error: "rate limited (429)", model: null }),
      run("s", "a", 4, null, { status: "RUNNING", attempts: 2, model: "claude-sonnet-5-5" }),
      run("s", "a", 5, null, { status: "QUEUED", attempts: 0, model: null }),
    ];
    expect(runModels(runs)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
    expect(runIssues(runs)).toEqual([
      { runNo: 2, text: "Run 2 failed after 5 attempts: overloaded (529)", tone: "red" },
      { runNo: 3, text: "Run 3 waits to be tried again (attempt 1 of 5 failed: rate limited (429))", tone: "amber" },
      { runNo: 4, text: "Run 4: attempt 2 of 5", tone: "slate" },
    ]);
  });
});
