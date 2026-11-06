import { describe, expect, test } from "vitest";
import { RUMOUR_TOO_EARLY, bulletinFromForm, qaThreads, sortBulletins, twistState, type BulletinRow } from "./content-bulletins";

const row = (id: string, kind: BulletinRow["kind"], published_at: string | null, created_at = "2026-11-20T15:00:00Z"): BulletinRow => ({
  id,
  kind,
  title: id,
  body: "",
  published_at,
  created_at,
});

describe("the composer", () => {
  test("general, rumour and fairness bulletins; trimmed text", () => {
    expect(bulletinFromForm({ kind: "RUMOUR", title: "  A rival is hiring ", body: " Unconfirmed.\r\n" }, "RESCUE")).toEqual({
      ok: true,
      value: { kind: "RUMOUR", title: "A rival is hiring", body: "Unconfirmed." },
    });
    expect(bulletinFromForm({ kind: "GENERAL", title: "Dinner", body: "" }, "BUILD").ok).toBe(true);
  });

  test("refuses the twist, the game's own kinds, an early rumour and bad text", () => {
    expect(bulletinFromForm({ kind: "TWIST", title: "t", body: "" })).toEqual({ ok: false, message: "Write the twist under Content; it goes out at 22:15." });
    expect(bulletinFromForm({ kind: "CRISIS", title: "t", body: "" }).ok).toBe(false);
    expect(bulletinFromForm({ kind: "RUMOUR", title: "t", body: "" }, "CRISIS_QA")).toEqual({ ok: false, message: RUMOUR_TOO_EARLY });
    expect(bulletinFromForm({ kind: "GENERAL", title: " ", body: "" })).toEqual({ ok: false, message: "A bulletin needs a title." });
    expect(bulletinFromForm({ kind: "GENERAL", title: "x".repeat(141), body: "" })).toEqual({ ok: false, message: "The title is at most 140 characters." });
    expect(bulletinFromForm({ kind: "GENERAL", title: "t", body: "b".repeat(4001) })).toEqual({ ok: false, message: "The body is at most 4,000 characters." });
  });
});

test("bulletins sort newest first, drafts by when they were written", () => {
  const rows = [row("a", "GENERAL", "2026-11-20T16:00:00Z"), row("b", "TWIST", null, "2026-11-20T17:00:00Z"), row("c", "RUMOUR", "2026-11-20T19:00:00Z")];
  expect(sortBulletins(rows).map((r) => r.id)).toEqual(["c", "b", "a"]);
});

describe("the twist", () => {
  test("not written, written (before and after the draw), published", () => {
    expect(twistState([], true).blocked).toMatch(/write it under Content/);
    expect(twistState([row("t", "TWIST", null)], false).blocked).toMatch(/after the problem cards are dealt/);
    expect(twistState([row("t", "TWIST", null)], true)).toMatchObject({ published: false, blocked: null });
    expect(twistState([row("t", "TWIST", "2026-11-20T16:45:00Z")], true)).toMatchObject({ published: true, blocked: "The twist has already been published." });
  });
});

test("Q&A threads: newest question first, answers in order, with ticker and both team codes", () => {
  const threads = qaThreads(
    [
      { id: "q1", company_id: "c", asker_team_id: "r", body: "Pouch cost?", hidden: false, created_at: "2026-11-20T18:16:00Z" },
      { id: "q2", company_id: "c", asker_team_id: "r", body: "Rude", hidden: true, created_at: "2026-11-20T18:20:00Z" },
    ],
    [
      { id: "a2", question_id: "q1", body: "And tins three.", created_at: "2026-11-20T18:30:00Z" },
      { id: "a1", question_id: "q1", body: "1.50 a pack.", created_at: "2026-11-20T18:18:00Z" },
    ],
    [{ id: "c", ticker: "MLBT", founder_team_id: "f" }],
    [
      { id: "r", code: "T002" },
      { id: "f", code: "T001" },
    ],
  );
  expect(threads.map((t) => [t.id, t.ticker, t.asker, t.founder, t.hidden, t.answers.map((a) => a.id)])).toEqual([
    ["q2", "MLBT", "T002", "T001", true, []],
    ["q1", "MLBT", "T002", "T001", false, ["a1", "a2"]],
  ]);
});
