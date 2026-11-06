import { describe, expect, test } from "vitest";
import { judgeLines, judgeProgress, parseJudgeType, pickType, type JudgeRows } from "./judge";

const rows = (): JudgeRows => ({
  companies: [
    { id: "a", ticker: "MLBT", name: "Masala Labs Bites", founder_team_id: "t1", rescuer_team_id: "t2" },
    { id: "b", ticker: "CHAI", name: "Chai Co", founder_team_id: "t2", rescuer_team_id: "t3" },
    { id: "c", ticker: "QAAC", name: "Company T003", founder_team_id: "t3", rescuer_team_id: "t1" },
  ],
  teams: [
    { id: "t1", code: "T001" },
    { id: "t2", code: "T002" },
    { id: "t3", code: "T003" },
  ],
  submissions: [
    { id: "s-a", company_id: "a", team_id: "t1", type: "PRD", word_count: 640, saved_at: "2026-11-20T17:29:59Z" },
    { id: "s-b", company_id: "b", team_id: "t2", type: "PRD", word_count: 800, saved_at: "2026-11-20T17:29:00Z" },
  ],
  runs: [
    { submission_id: "s-a", generation: 1, run_no: 1, status: "DONE", total: 70, error: null },
    { submission_id: "s-a", generation: 1, run_no: 2, status: "DONE", total: 78, error: null },
    { submission_id: "s-a", generation: 1, run_no: 3, status: "DONE", total: 90, error: null },
    { submission_id: "s-b", generation: 1, run_no: 1, status: "DONE", total: 60, error: null },
    { submission_id: "s-b", generation: 1, run_no: 2, status: "FAILED", total: null, error: "invalid JSON" },
    { submission_id: "s-b", generation: 1, run_no: 3, status: "QUEUED", total: null, error: null },
  ],
  scores: [
    { company_id: "a", team_id: "t1", type: "PRD", status: "SEALED", missing: false, median: 78, penalty: 0, final_score: 78, rationale: "x" },
    { company_id: "b", team_id: "t2", type: "PRD", status: "PENDING", missing: false, median: null, penalty: 0, final_score: null, rationale: null },
    { company_id: "c", team_id: "t3", type: "PRD", status: "SEALED", missing: true, median: null, penalty: 0, final_score: 0, rationale: "No saved PRD at the lock." },
  ],
  hits: { "s-a": 1, "s-b": 0 },
});

describe("progress", () => {
  test("submissions, readings by status, sealed and revealed; the gate opens only when every company is sealed", () => {
    expect(judgeProgress(rows(), "PRD")).toEqual({
      companies: 3,
      submissions: 2,
      missing: 1,
      readings: { total: 6, done: 4, failed: 1, queued: 1, running: 0 },
      sealed: 2,
      revealed: 0,
      complete: false,
    });
    const r = rows();
    r.scores[1] = { ...r.scores[1]!, status: "SEALED", median: 60, final_score: 60 };
    expect(judgeProgress(r, "PRD").complete).toBe(true);
  });

  test("only the latest generation of readings counts", () => {
    const r = rows();
    r.runs.push({ submission_id: "s-a", generation: 2, run_no: 1, status: "QUEUED", total: null, error: null });
    expect(judgeProgress(r, "PRD").readings).toEqual({ total: 4, done: 1, failed: 1, queued: 2, running: 0 });
  });

  test("solutions are judged only for companies with a rescuer", () => {
    const r = rows();
    r.companies[2] = { ...r.companies[2]!, rescuer_team_id: null };
    expect(judgeProgress(r, "SOLUTION").companies).toBe(2);
  });
});

describe("one line per company", () => {
  test("by ticker: author, words, readings, median, penalty, final, lines removed and what it waits for", () => {
    const lines = judgeLines(rows(), "PRD");
    expect(lines.map((l) => l.ticker)).toEqual(["CHAI", "MLBT", "QAAC"]);
    expect(lines[1]).toMatchObject({
      author: "T001",
      words: 640,
      readings: [
        { runNo: 1, status: "DONE", total: 70, error: null },
        { runNo: 2, status: "DONE", total: 78, error: null },
        { runNo: 3, status: "DONE", total: 90, error: null },
      ],
      median: 78,
      final: 78,
      removed: 1,
      status: "SEALED",
      waiting: "",
    });
    expect(lines[0]).toMatchObject({ status: "PENDING", waiting: "1 reading failed" });
    expect(lines[2]).toMatchObject({ missing: true, final: 0, waiting: "No submission: scores 0", words: null, removed: null });
  });

  test("before the lock; a solution's author is the rescuer", () => {
    const lines = judgeLines(rows(), "SOLUTION");
    expect(lines.every((l) => l.status === "NOT_LOCKED" && l.waiting === "Not locked yet")).toBe(true);
    expect(lines.find((l) => l.ticker === "MLBT")!.author).toBe("T002");
  });
});

test("the type to show", () => {
  expect(parseJudgeType("PRD")).toBe("PRD");
  expect(parseJudgeType("PITCH")).toBeNull();
  expect(pickType("solution", false)).toBe("SOLUTION");
  expect(pickType(undefined, false)).toBe("PRD");
  expect(pickType("nonsense", true)).toBe("SOLUTION");
});
