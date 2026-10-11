import { describe, expect, test } from "vitest";
import {
  canonical,
  currentSubmission,
  deadlineFrozen,
  deadlinePassed,
  mayWrite,
  otherSaver,
  pickState,
  planCap,
  roleOf,
  sameContent,
  submissionStatus,
  submissionWindow,
  submittedLate,
  whoLabel,
  type DraftRow,
  type SubmissionRow,
  type WindowInput,
} from "./squad";

const T = (iso: string) => Date.parse(iso);
const NOW = "2026-10-10T17:00:00.000Z"; // 22:30 IST
const running = { paused: false, pausedAt: null };
const squad = { product_team_id: "p", consulting_team_id: "c", finance_team_id: "f" };

describe("deadlines (app.deadline_passed)", () => {
  test("passed strictly after the deadline, by the server clock; no deadline never passes", () => {
    expect(deadlinePassed(null, T(NOW), running)).toBe(false);
    expect(deadlinePassed(NOW, T(NOW), running)).toBe(false);
    expect(deadlinePassed(NOW, T(NOW) + 1, running)).toBe(true);
    expect(deadlinePassed(NOW, T(NOW) - 1000, running)).toBe(false);
  });

  test("while paused, a deadline after the pause began does not pass; one before it has passed", () => {
    const paused = { paused: true, pausedAt: "2026-10-10T16:59:00.000Z" };
    expect(deadlineFrozen(NOW, paused)).toBe(true);
    expect(deadlinePassed(NOW, T(NOW) + 60_000, paused)).toBe(false);
    expect(deadlinePassed("2026-10-10T16:58:00.000Z", T(NOW), paused)).toBe(true);
    expect(deadlineFrozen(NOW, running)).toBe(false);
  });
});

describe("the squad's teams", () => {
  test("roles, and who did something from this team's point of view", () => {
    expect(roleOf(squad, "p")).toBe("PRODUCT");
    expect(roleOf(squad, "c")).toBe("CONSULTING");
    expect(roleOf(squad, "f")).toBe("FINANCE");
    expect(roleOf(squad, "x")).toBeNull();
    expect(roleOf(squad, null)).toBeNull();
    expect(whoLabel(squad, "p", "p")).toBe("your team");
    expect(whoLabel(squad, "p", "c")).toBe("Consulting");
    expect(whoLabel(squad, "p", null)).toBe("—");
    expect(otherSaver(squad, "p", "c")).toBe("The Consulting team");
    expect(otherSaver(squad, "p", "p")).toBe("Your team (on another device)");
  });

  test("Product writes the pitch; Product and Consulting write the plan and the flash answer; Finance writes none", () => {
    expect(mayWrite("PITCH", "PRODUCT")).toBe(true);
    expect(mayWrite("PITCH", "CONSULTING")).toBe(false);
    for (const t of ["PLAN", "FLASH"] as const) {
      expect(mayWrite(t, "PRODUCT")).toBe(true);
      expect(mayWrite(t, "CONSULTING")).toBe(true);
      expect(mayWrite(t, "FINANCE")).toBe(false);
    }
    expect(mayWrite("PITCH", "FINANCE")).toBe(false);
  });
});

const base: WindowInput = {
  ...running,
  phase: "BUILD",
  drawn: true,
  nowMs: T(NOW) - 60_000,
  deadlines: { PITCH: NOW, PLAN: "2026-10-10T21:30:00.000Z", FLASH_BULLETIN: "2026-10-10T22:30:00.000Z", FLASH: "2026-10-10T22:45:00.000Z" },
  flashPublishedAt: null,
  flashReleased: false,
};

describe("submission windows (app.submission_window)", () => {
  test("the pitch: from the draw through Build until its deadline; Product edits, Consulting reads", () => {
    expect(submissionWindow("PITCH", "PRODUCT", { ...base, phase: "BRIEFING", drawn: false })).toMatchObject({
      stage: "BEFORE",
      editable: false,
      note: "The pitch card opens at the squad draw.",
    });
    expect(submissionWindow("PITCH", "PRODUCT", { ...base, phase: "SQUAD_DRAW" })).toMatchObject({ stage: "OPEN", editable: true, note: "" });
    expect(submissionWindow("PITCH", "PRODUCT", base)).toMatchObject({ stage: "OPEN", editable: true, deadline: NOW });
    expect(submissionWindow("PITCH", "CONSULTING", base)).toMatchObject({
      stage: "OPEN",
      mayWrite: false,
      editable: false,
      note: "The Product team writes the pitch card; you can read it here.",
    });
    expect(submissionWindow("PITCH", "PRODUCT", { ...base, nowMs: T(NOW) + 1 })).toMatchObject({
      stage: "CLOSED",
      editable: false,
      note: "The pitch card closed at 22:30.",
    });
    // Reading publishes the pitches: closed whatever the clock says.
    expect(submissionWindow("PITCH", "PRODUCT", { ...base, phase: "READING" })).toMatchObject({ stage: "CLOSED", editable: false });
    // Paused before the deadline: still open after it.
    expect(submissionWindow("PITCH", "PRODUCT", { ...base, nowMs: T(NOW) + 60_000, paused: true, pausedAt: "2026-10-10T16:59:00.000Z" }).editable).toBe(
      true,
    );
  });

  test("the plan: from the crisis to the end of Rescue 2 and its deadline, for Product and Consulting", () => {
    const at = { ...base, nowMs: T("2026-10-10T20:00:00.000Z") };
    expect(submissionWindow("PLAN", "PRODUCT", { ...at, phase: "ROUNDS_1_4" })).toMatchObject({
      stage: "BEFORE",
      note: "The rescue plan opens when the crisis is published.",
    });
    for (const phase of ["CRISIS", "RESCUE_1", "BREAK", "RESCUE_2"] as const) {
      expect(submissionWindow("PLAN", "PRODUCT", { ...at, phase }).editable).toBe(true);
      expect(submissionWindow("PLAN", "CONSULTING", { ...at, phase }).editable).toBe(true);
      expect(submissionWindow("PLAN", "FINANCE", { ...at, phase }).editable).toBe(false);
    }
    expect(submissionWindow("PLAN", "CONSULTING", { ...at, phase: "PLANS_PUBLISHED" })).toMatchObject({ stage: "CLOSED", note: "The rescue plan closed at 03:00." });
    expect(submissionWindow("PLAN", "CONSULTING", { ...at, phase: "RESCUE_2", nowMs: T("2026-10-10T21:30:00.001Z") }).stage).toBe("CLOSED");
  });

  test("the flash answer: from the bulletin's publication until its deadline or the release of the flash scores", () => {
    const at = { ...base, phase: "ROUNDS_13_21" as const, nowMs: T("2026-10-10T22:35:00.000Z") };
    expect(submissionWindow("FLASH", "CONSULTING", at)).toMatchObject({
      stage: "BEFORE",
      note: "The flash answer opens when the flash bulletin is published (planned for 04:00).",
    });
    expect(submissionWindow("FLASH", "CONSULTING", { ...at, flashPublishedAt: "2026-10-10T22:36:00.000Z" }).stage).toBe("BEFORE");
    expect(submissionWindow("FLASH", "CONSULTING", { ...at, flashPublishedAt: "2026-10-10T22:30:00.000Z" })).toMatchObject({ stage: "OPEN", editable: true });
    expect(submissionWindow("FLASH", "PRODUCT", { ...at, flashPublishedAt: "2026-10-10T22:30:00.000Z" }).editable).toBe(true);
    expect(submissionWindow("FLASH", "PRODUCT", { ...at, flashPublishedAt: "2026-10-10T22:30:00.000Z", flashReleased: true }).stage).toBe("CLOSED");
    expect(submissionWindow("FLASH", "PRODUCT", { ...at, flashPublishedAt: "2026-10-10T22:30:00.000Z", nowMs: T("2026-10-10T22:45:01.000Z") })).toMatchObject({
      stage: "CLOSED",
      note: "The flash answer closed at 04:15.",
    });
  });
});

describe("the problem card pick", () => {
  const pick = { ...running, nowMs: T(NOW) - 1000, deadline: NOW, dealt: ["a", "b", "c"], chosenId: null, byDefault: false };

  test("Product picks until the deadline (and may change its pick); Consulting sees it", () => {
    expect(pickState({ ...pick, track: "PRODUCT" })).toMatchObject({
      open: true,
      canPick: true,
      chosenId: null,
      note: "Pick one of the three cards by 22:30. If you do not pick, the first card is chosen for you.",
    });
    expect(pickState({ ...pick, track: "PRODUCT", chosenId: "b" })).toMatchObject({
      canPick: true,
      chosenId: "b",
      byDefault: false,
      note: "You can change your pick until the pick closes at 22:30.",
    });
    expect(pickState({ ...pick, track: "CONSULTING" })).toMatchObject({
      open: true,
      mayPick: false,
      canPick: false,
      note: "The Product team picks one card by 22:30. If it does not pick, the first card is chosen.",
    });
  });

  test("after the deadline: the pick, or the first card dealt by default (shown at once, before the heartbeat applies it)", () => {
    const after = { ...pick, track: "PRODUCT" as const, nowMs: T(NOW) + 1 };
    expect(pickState({ ...after, chosenId: "b" })).toMatchObject({ open: false, canPick: false, chosenId: "b", byDefault: false, note: "The pick has closed." });
    expect(pickState(after)).toMatchObject({ open: false, chosenId: "a", byDefault: true, defaultPending: true });
    expect(pickState({ ...after, chosenId: "a", byDefault: true })).toMatchObject({
      chosenId: "a",
      byDefault: true,
      defaultPending: false,
      note: "No card was picked before the pick closed, so the first card dealt was chosen by default.",
    });
  });
});

describe("content comparison (jsonb equality)", () => {
  test("key order and undefined do not matter; values do", () => {
    expect(canonical({ b: "2", a: "1" })).toBe('{"a":"1","b":"2"}');
    expect(sameContent({ a: "1", b: "2" }, { b: "2", a: "1" })).toBe(true);
    expect(sameContent({ a: "1", x: undefined }, { a: "1" })).toBe(true);
    expect(sameContent({ a: "1" }, { a: "1", b: "" })).toBe(false);
    expect(sameContent({ a: { y: [1, "2"], x: null } }, { a: { x: null, y: [1, "2"] } })).toBe(true);
    expect(sameContent(null, {})).toBe(true);
  });
});

describe("submission status (overview)", () => {
  const open = submissionWindow("PITCH", "PRODUCT", base);
  const closed = submissionWindow("PITCH", "PRODUCT", { ...base, phase: "READING" });
  const draft = (version: number, content: Record<string, unknown> = { problem: "Water is unsafe." }): DraftRow => ({
    type: "PITCH",
    content,
    version,
    updated_at: "2026-10-10T16:50:00.000Z",
    updated_by_team: "p",
  });
  const sub = (over: Partial<SubmissionRow>): SubmissionRow => ({
    id: "s1",
    type: "PITCH",
    content: { problem: "Water is unsafe." },
    word_count: 3,
    submitted_at: "2026-10-10T16:55:00.000Z",
    submitted_by_team: "p",
    superseded_at: null,
    ...over,
  });

  test("not started, draft only, submitted, changed since, and missing after the deadline", () => {
    expect(submissionStatus("PITCH", draft(0, {}), [], open, running)).toMatchObject({ draft: null, current: null, state: { text: "Not started" } });
    expect(submissionStatus("PITCH", draft(2), [], open, running)).toMatchObject({
      draft: { version: 2, words: 3, by: "p", savedAt: "2026-10-10T16:50:00.000Z" },
      state: { text: "Draft saved · not submitted", tone: "amber" },
    });
    const s = submissionStatus("PITCH", draft(2), [sub({}), sub({ id: "s0", superseded_at: "2026-10-10T16:55:00.000Z" })], open, running);
    expect(s).toMatchObject({
      current: { submittedAt: "2026-10-10T16:55:00.000Z", by: "p", words: 3, late: false },
      superseded: 1,
      changedSinceSubmit: false,
      state: { text: "Submitted", tone: "green" },
    });
    expect(submissionStatus("PITCH", draft(3, { problem: "Changed." }), [sub({})], open, running)).toMatchObject({
      changedSinceSubmit: true,
      state: { text: "Submitted · draft changed since", tone: "amber" },
    });
    // After the deadline the submitted version stands (green), and a squad with none scores 0.
    expect(submissionStatus("PITCH", draft(3, { problem: "Changed." }), [sub({})], closed, running).state).toEqual({ text: "Submitted", tone: "green" });
    expect(submissionStatus("PITCH", draft(2), [], closed, running).state).toEqual({ text: "Not submitted · scores 0", tone: "red" });
    expect(submissionStatus("PLAN", undefined, [sub({})], submissionWindow("PLAN", "PRODUCT", base), running)).toMatchObject({
      current: null,
      state: { text: "Not open yet" },
    });
  });

  test("current submission and lateness", () => {
    expect(currentSubmission([sub({ superseded_at: "x" }), sub({ id: "s2" })], "PITCH")?.id).toBe("s2");
    expect(currentSubmission([sub({})], "PLAN")).toBeNull();
    expect(submittedLate("2026-10-10T17:00:00.001Z", NOW, running)).toBe(true);
    expect(submittedLate("2026-10-10T17:00:00.000Z", NOW, running)).toBe(false);
    expect(submittedLate("2026-10-10T17:00:01.000Z", NOW, { paused: true, pausedAt: "2026-10-10T16:59:00.000Z" })).toBe(false);
    expect(submittedLate("2026-10-10T17:00:01.000Z", null, running)).toBe(false);
  });
});

describe("the plan's cap (deal signed by the deadline)", () => {
  const deadline = "2026-10-10T21:30:00.000Z"; // 03:00 IST
  test("fully signed in time: no cap; otherwise the cap at 50 is spelled out with the signatures so far", () => {
    expect(planCap({ executed_at: "2026-10-10T21:00:00.000Z", signed_product_at: "x", signed_consulting_at: "x", signed_finance_at: "x" }, deadline)).toEqual({
      safe: true,
      text: "The deal was fully signed at 02:30: the plan score is not capped.",
      tone: "green",
    });
    expect(planCap({ executed_at: null, signed_product_at: "x", signed_consulting_at: null, signed_finance_at: "x" }, deadline)).toEqual({
      safe: false,
      text: "The deal is not fully signed (2 of 3 signatures). If it is not fully signed by 03:00, the plan score is capped at 50.",
      tone: "amber",
    });
    expect(planCap(null, deadline).text).toContain("(0 of 3 signatures)");
    expect(planCap({ executed_at: "2026-10-10T21:30:00.001Z", signed_product_at: "x", signed_consulting_at: "x", signed_finance_at: "x" }, deadline).safe).toBe(false);
  });
});
