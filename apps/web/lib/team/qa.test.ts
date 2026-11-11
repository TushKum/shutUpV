import { describe, expect, test } from "vitest";
import { answerCheck, boardRole, boardState, parseQaQuery, qaHref, questionCheck, threads, unanswered } from "./qa";

describe("limits, as the database checks them", () => {
  test("questions: 1 to 1,000 characters after trimming, counted as characters (not UTF-16 units)", () => {
    expect(questionCheck("   ")).toMatchObject({ ok: false, chars: 0 });
    expect(questionCheck("What is your churn?")).toEqual({ ok: true, chars: 19 });
    expect(questionCheck("x".repeat(1000)).ok).toBe(true);
    expect(questionCheck("x".repeat(1001))).toMatchObject({ ok: false, message: "Questions are at most 1,000 characters (this one has 1,001)." });
    expect(questionCheck("😀".repeat(1000))).toMatchObject({ ok: true, chars: 1000 });
  });
  test("answers: 1 to 100 words (the engine's word count: punctuation alone is not a word)", () => {
    expect(answerCheck("")).toMatchObject({ ok: false, words: 0 });
    expect(answerCheck("— ... !")).toMatchObject({ ok: false, words: 0 });
    expect(answerCheck("We sell to councils — yearly.")).toEqual({ ok: true, words: 5 });
    expect(answerCheck(Array(100).fill("word").join(" "))).toEqual({ ok: true, words: 100 });
    expect(answerCheck(Array(101).fill("word").join(" "))).toMatchObject({ ok: false, words: 101, message: "Answers are at most 100 words (this one has 101)." });
    expect(answerCheck(`${"a".repeat(1501)}`)).toMatchObject({ ok: false, words: 1 });
  });
});

describe("the board", () => {
  test("opens at Reading, closes at the close; Finance asks, Product answers, Consulting reads", () => {
    expect(boardState("BUILD")).toBe("NOT_YET");
    expect(boardState("READING")).toBe("OPEN");
    expect(boardState("ROUNDS_13_21")).toBe("OPEN");
    expect(boardState("CLOSE")).toBe("CLOSED");
    expect(boardState("AWARDS")).toBe("CLOSED");
    expect([boardRole("FINANCE"), boardRole("PRODUCT"), boardRole("CONSULTING")]).toEqual(["ASK", "ANSWER", "READ"]);
  });
  test("each question with its answers, oldest answer first; the unanswered queue is oldest first", () => {
    const qs = [
      { id: "q2", company_id: "a", body: "Second?", created_at: "2026-10-08T17:10:00Z" },
      { id: "q1", company_id: "a", body: "First?", created_at: "2026-10-08T17:05:00Z" },
      { id: "q3", company_id: "a", body: "Third?", created_at: "2026-10-08T17:20:00Z" },
    ];
    const as = [
      { id: "b", question_id: "q2", company_id: "a", body: "Later.", word_count: 1, created_at: "2026-10-08T17:30:00Z" },
      { id: "a", question_id: "q2", company_id: "a", body: "Sooner.", word_count: 1, created_at: "2026-10-08T17:15:00Z" },
    ];
    const t = threads(qs, as);
    expect(t.map((x) => x.question.id)).toEqual(["q2", "q1", "q3"]);
    expect(t[0]!.answers.map((a) => a.body)).toEqual(["Sooner.", "Later."]);
    expect(t[1]!.answers).toEqual([]);
    expect(unanswered(qs, as).map((q) => q.id)).toEqual(["q1", "q3"]);
  });
  test("the filter in the address: a ticker and a page; anything else is ignored", () => {
    expect(parseQaQuery({ company: "aqs", page: "3" })).toEqual({ company: "AQS", page: 3 });
    expect(parseQaQuery({ company: "x'; drop", page: "-1" })).toEqual({ company: null, page: 1 });
    expect(parseQaQuery({})).toEqual({ company: null, page: 1 });
    const q = { company: "AQS", page: 2 };
    expect(qaHref("/team/qa", q)).toBe("/team/qa?company=AQS&page=2");
    expect(qaHref("/team/qa", q, { company: null })).toBe("/team/qa");
    expect(qaHref("/team/qa", q, { page: 3 })).toBe("/team/qa?company=AQS&page=3");
  });
});
