import { describe, expect, test } from "vitest";
import { answerCheck, answerState, askState, parseQaQuery, qaHref, questionCheck, threads, unanswered, type BoardFacts } from "./qa";

describe("limits, as the database checks them", () => {
  test("questions: 1 to 300 characters after trimming, counted as characters (not UTF-16 units)", () => {
    expect(questionCheck("   ")).toMatchObject({ ok: false, chars: 0 });
    expect(questionCheck("What does the pouch cost?")).toEqual({ ok: true, chars: 25 });
    expect(questionCheck("x".repeat(300)).ok).toBe(true);
    expect(questionCheck("x".repeat(301))).toMatchObject({ ok: false, message: "Questions are at most 300 characters (this one has 301)." });
    expect(questionCheck("😀".repeat(300))).toMatchObject({ ok: true, chars: 300 });
  });
  test("answers: 1 to 150 words (the engine's word count: punctuation alone is not a word)", () => {
    expect(answerCheck("")).toMatchObject({ ok: false, words: 0 });
    expect(answerCheck("— ... !")).toMatchObject({ ok: false, words: 0 });
    expect(answerCheck("One rupee fifty — per pack.")).toEqual({ ok: true, words: 5 });
    expect(answerCheck(Array(150).fill("word").join(" "))).toEqual({ ok: true, words: 150 });
    expect(answerCheck(Array(151).fill("word").join(" "))).toMatchObject({ ok: false, words: 151, message: "Answers are at most 150 words (this one has 151)." });
    expect(answerCheck(`${"a".repeat(1501)}`)).toMatchObject({ ok: false, words: 1 });
  });
});

describe("the windows", () => {
  const f: BoardFacts = {
    phase: "CRISIS_QA",
    paused: false,
    pausedAt: null,
    nowMs: Date.parse("2026-11-20T18:30:00Z"),
    crisisApplied: true,
    qaClose: "2026-11-20T18:45:00Z",
    solutionLock: "2026-11-20T20:15:00Z",
  };
  test("questions from the crisis until 00:15; answers until 01:45", () => {
    expect([askState(f), answerState(f)]).toEqual(["OPEN", "OPEN"]);
    expect([askState({ ...f, crisisApplied: false }), answerState({ ...f, crisisApplied: false })]).toEqual(["NOT_YET", "NOT_YET"]);
    const after = { ...f, phase: "RESCUE" as const, nowMs: Date.parse("2026-11-20T19:00:00Z") };
    expect([askState(after), answerState(after)]).toEqual(["CLOSED", "OPEN"]);
    expect(askState({ ...f, nowMs: Date.parse(f.qaClose!) })).toBe("CLOSED");
    expect(answerState({ ...after, nowMs: Date.parse(f.solutionLock!) })).toBe("CLOSED");
    expect(answerState({ ...after, phase: "JUDGING_2" })).toBe("CLOSED");
    expect(askState({ ...f, paused: true, pausedAt: "2026-11-20T18:20:00Z" })).toBe("CLOSED");
  });
});

describe("the board", () => {
  test("each question with its answers, oldest answer first; the unanswered queue is oldest first", () => {
    const qs = [
      { id: "q2", company_id: "a", asker_team_id: "r", body: "Second?", created_at: "2026-11-20T18:20:00Z" },
      { id: "q1", company_id: "a", asker_team_id: "r", body: "First?", created_at: "2026-11-20T18:16:00Z" },
      { id: "q3", company_id: "a", asker_team_id: "r", body: "Third?", created_at: "2026-11-20T18:30:00Z" },
    ];
    const as = [
      { id: "b", question_id: "q2", company_id: "a", body: "Later.", word_count: 1, created_at: "2026-11-20T18:40:00Z" },
      { id: "a", question_id: "q2", company_id: "a", body: "Sooner.", word_count: 1, created_at: "2026-11-20T18:25:00Z" },
    ];
    const t = threads(qs, as);
    expect(t.map((x) => x.question.id)).toEqual(["q2", "q1", "q3"]);
    expect(t[0]!.answers.map((a) => a.body)).toEqual(["Sooner.", "Later."]);
    expect(t[1]!.answers).toEqual([]);
    expect(unanswered(qs, as).map((q) => q.id)).toEqual(["q1", "q3"]);
  });
  test("the filter in the address: a four-letter ticker and a page; anything else is ignored", () => {
    expect(parseQaQuery({ company: "mlbt", page: "3" })).toEqual({ company: "MLBT", page: 3 });
    expect(parseQaQuery({ company: "x'; drop", page: "-1" })).toEqual({ company: null, page: 1 });
    expect(parseQaQuery({ company: "AQS" })).toEqual({ company: null, page: 1 });
    const q = { company: "MLBT", page: 2 };
    expect(qaHref("/team/qa", q)).toBe("/team/qa?company=MLBT&page=2");
    expect(qaHref("/team/qa", q, { company: null })).toBe("/team/qa");
    expect(qaHref("/team/qa", q, { page: 3 })).toBe("/team/qa?company=MLBT&page=3");
  });
});
