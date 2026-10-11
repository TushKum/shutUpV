import { describe, expect, test } from "vitest";
import { submissionWords } from "@msim/engine";
import {
  MAX_CONTENT_CHARS,
  afterResult,
  backupKey,
  backupOf,
  closedView,
  contentChars,
  draftPayload,
  editorReducer,
  fieldSpecs,
  fieldsOf,
  initEditor,
  isDirty,
  normaliseTicker,
  parseBackup,
  rowsFor,
  sameFields,
  submitProblem,
  toSnapshot,
  toSubmitted,
  wordStats,
  type DraftSnapshot,
  type EditorAction,
  type EditorState,
} from "./editor";

const snap = (version: number, content: Record<string, unknown>, updatedBy = "c"): DraftSnapshot => ({
  version,
  content,
  updatedAt: `2026-10-10T21:0${version}:00.000Z`,
  updatedBy,
});
const run = (s: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, s);
const edit = (key: string, value: string): EditorAction => ({ type: "edit", key, value });

describe("templates and fields", () => {
  test("the pitch carries the company name and ticker before its sections; the plan has 7 sections, the flash 1", () => {
    expect(fieldSpecs("PITCH").map((f) => f.key)).toEqual(["company_name", "ticker", "problem", "solution", "customers", "business_model", "advantage", "use_of_seed"]);
    expect(fieldSpecs("PITCH").filter((f) => !f.counted).map((f) => f.key)).toEqual(["company_name", "ticker"]);
    expect(fieldSpecs("PLAN")).toHaveLength(7);
    expect(fieldSpecs("FLASH").map((f) => f.label)).toEqual(["Our answer"]);
  });

  test("stored content becomes strings for every known field; only the template's fields are sent", () => {
    expect(fieldsOf("FLASH", { answer: 5, extra: "x" })).toEqual({ answer: "" });
    expect(fieldsOf("FLASH", null)).toEqual({ answer: "" });
    expect(fieldsOf("PITCH", { ticker: "AQS" }).ticker).toBe("AQS");
    expect(draftPayload("FLASH", { answer: "Yes.", sneaky: "no" })).toEqual({ answer: "Yes." });
    expect(Object.keys(draftPayload("PITCH", {}))).toHaveLength(8);
    expect(sameFields("FLASH", { answer: "a" }, { answer: "a", other: "b" })).toBe(true);
    expect(sameFields("FLASH", { answer: "a" }, { answer: "a " })).toBe(false);
  });

  test("a typed ticker: capital letters only, at most four", () => {
    expect(normaliseTicker("aq s1")).toBe("AQS");
    expect(normaliseTicker("abcdef")).toBe("ABCD");
  });
});

describe("word counts (the engine's, which SQL also uses)", () => {
  test("per field and in total, against the limit; the name and ticker do not count", () => {
    const fields = { ...fieldsOf("PITCH", {}), company_name: "Aqua Sense Labs", ticker: "AQS", problem: "Unsafe water — in towns.", solution: "Sensors." };
    const s = wordStats("PITCH", fields);
    expect(s.perField.problem).toBe(4); // "—" alone is not a word
    expect(s.perField.solution).toBe(1);
    expect(s.perField.company_name).toBeUndefined();
    expect(s.total).toBe(5);
    expect(s.total).toBe(submissionWords("PITCH", fields));
    expect(s).toMatchObject({ limit: 400, over: 0 });
    expect(wordStats("FLASH", { answer: "word ".repeat(103) })).toMatchObject({ total: 103, limit: 100, over: 3 });
  });

  test("what Submit would be refused for, as submit_submission says it", () => {
    expect(submitProblem("FLASH", { answer: "  " })).toEqual({ code: "EMPTY", message: "Write something before submitting." });
    expect(submitProblem("FLASH", { answer: "w ".repeat(101) })).toEqual({ code: "TOO_LONG", message: "At most 100 words (you have 101)." });
    expect(submitProblem("FLASH", { answer: "w ".repeat(100) })).toBeNull();
    const pitch = { ...fieldsOf("PITCH", {}), problem: "Unsafe water." };
    expect(submitProblem("PITCH", pitch)?.code).toBe("MISSING_NAME");
    expect(submitProblem("PITCH", { ...pitch, company_name: "AquaSense", ticker: "AQ" })).toEqual({
      code: "BAD_TICKER",
      message: "The ticker is 3 or 4 letters, e.g. AQS.",
    });
    expect(submitProblem("PITCH", { ...pitch, company_name: "AquaSense", ticker: "AQS" })).toBeNull();
  });

  test("the content's jsonb length is never underestimated", () => {
    // Postgres: {"a": "b"} is 10 characters, {"a": "b", "c": "d"} 20.
    expect(contentChars({ a: "b" })).toBe(10);
    expect(contentChars({ a: "b", c: "d" })).toBe(20);
    expect(contentChars({})).toBe(2);
    expect(contentChars({ a: 'say "hi"\n' })).toBe(`{"a": "say \\"hi\\"\\n"}`.length);
    expect(contentChars({ answer: "x".repeat(MAX_CONTENT_CHARS) })).toBeGreaterThan(MAX_CONTENT_CHARS);
  });

  test("textarea rows grow with the text, within bounds", () => {
    expect(rowsFor("")).toBe(3);
    expect(rowsFor("", 5)).toBe(5);
    expect(rowsFor("a\nb\nc\nd")).toBe(5);
    expect(rowsFor("x".repeat(46))).toBe(3);
    expect(rowsFor("x\n".repeat(40))).toBe(16);
  });
});

describe("the editor when several screens save the same draft", () => {
  const v1 = snap(1, { answer: "First answer." }, "p");
  const start = () => initEditor("FLASH", v1);

  test("a newer version is shown at once when nothing was typed here", () => {
    const s = run(start(), { type: "server", draft: snap(2, { answer: "Their answer." }) });
    expect(s.fields.answer).toBe("Their answer.");
    expect(s.base.version).toBe(2);
    expect(s.theirs).toBeNull();
    expect(s.notice).toEqual({ kind: "updated", draft: snap(2, { answer: "Their answer." }) });
    expect(isDirty(s)).toBe(false);
  });

  test("an older or equal version from a stale refresh changes nothing", () => {
    const s = run(start(), edit("answer", "Mine."));
    expect(run(s, { type: "server", draft: v1 })).toBe(s);
    expect(run(s, { type: "server", draft: snap(0, {}) })).toBe(s);
  });

  test("typed text is never replaced: a newer version is offered instead", () => {
    const s = run(start(), edit("answer", "My new answer."), { type: "server", draft: snap(2, { answer: "Their answer." }) });
    expect(s.fields.answer).toBe("My new answer.");
    expect(s.base.version).toBe(1);
    expect(s.theirs?.version).toBe(2);
    expect(isDirty(s)).toBe(true);
    // A refusal for a version already offered changes nothing; a still newer one replaces the offer.
    expect(run(s, { type: "conflict", draft: snap(2, { answer: "Their answer." }) })).toEqual(s);
    expect(run(s, { type: "server", draft: snap(3, { answer: "Newer." }) }).theirs?.version).toBe(3);
  });

  test("a save refused for a newer version (VERSION_CONFLICT) offers that version and keeps the typed text", () => {
    const typed = run(start(), edit("answer", "Mine."));
    const s = run(typed, { type: "saving", fields: { answer: "Mine." } }, { type: "conflict", draft: snap(2, { answer: "Theirs." }) });
    expect(s).toMatchObject({ fields: { answer: "Mine." }, theirs: { version: 2 }, saving: null });
  });

  test("load their version: the typed text is set aside and can be put back; the next save then replaces their version", () => {
    let s = run(start(), edit("answer", "Mine."), { type: "server", draft: snap(2, { answer: "Theirs." }) }, { type: "loadTheirs" });
    expect(s.fields.answer).toBe("Theirs.");
    expect(s.base.version).toBe(2);
    expect(s.theirs).toBeNull();
    expect(s.stash).toEqual({ fields: { answer: "Mine." }, basedOn: 1, why: "loaded" });
    expect(s.notice?.kind).toBe("loaded");
    expect(isDirty(s)).toBe(false);
    s = run(s, { type: "restoreStash" });
    expect(s.fields.answer).toBe("Mine.");
    expect(s.stash).toBeNull();
    expect(isDirty(s)).toBe(true);
    expect(s.base.version).toBe(2); // a save now names version 2
    expect(run(s, { type: "dropStash" }).stash).toBeNull();
  });

  test("keep my text: the offered version becomes the base, so the next save replaces it", () => {
    const s = run(start(), edit("answer", "Mine."), { type: "server", draft: snap(2, { answer: "Theirs." }) }, { type: "keepMine" });
    expect(s).toMatchObject({ fields: { answer: "Mine." }, base: { version: 2 }, theirs: null, notice: { kind: "kept" } });
    expect(isDirty(s)).toBe(true);
  });

  test("a save coming back with a refresh before its answer is not a conflict, even if more was typed meanwhile", () => {
    let s = run(start(), edit("answer", "Mine."), { type: "saving", fields: { answer: "Mine." } }, edit("answer", "Mine. More."));
    s = run(s, { type: "server", draft: snap(2, { answer: "Mine." }, "p") });
    expect(s).toMatchObject({ base: { version: 2 }, theirs: null, fields: { answer: "Mine. More." } });
    s = run(s, { type: "saved", draft: snap(2, { answer: "Mine." }, "p") });
    expect(s).toMatchObject({ base: { version: 2 }, saving: null });
    expect(isDirty(s)).toBe(true);
  });

  test("saved: the saved version is the base; an offer older than it is dropped, a newer one kept", () => {
    const typed = run(start(), edit("answer", "Mine."));
    expect(run(typed, { type: "saved", draft: snap(2, { answer: "Mine." }, "p") })).toMatchObject({ base: { version: 2 }, theirs: null, notice: null });
    const offered = { ...typed, theirs: snap(3, { answer: "Theirs." }) };
    expect(run(offered, { type: "saved", draft: snap(2, { answer: "Mine." }, "p") }).theirs?.version).toBe(3);
    expect(run(typed, { type: "saving", fields: { answer: "Mine." } }, { type: "failed" }).saving).toBeNull();
  });

  test("the same text saved elsewhere is simply taken as the base", () => {
    const s = run(start(), edit("answer", "Same."), { type: "server", draft: snap(2, { answer: "Same." }) });
    expect(s).toMatchObject({ base: { version: 2 }, theirs: null });
    expect(isDirty(s)).toBe(false);
  });

  test("a result: a newer version refused for is offered; any other result with a draft makes it the base", () => {
    expect(afterResult({ code: "VERSION_CONFLICT", draft: snap(3, {}) })).toEqual({ type: "conflict", draft: snap(3, {}) });
    expect(afterResult({ draft: snap(2, {}) })).toEqual({ type: "saved", draft: snap(2, {}) });
    // Submit saved version 2, then submit_submission refused (TICKER_TAKEN): version 2 is still this screen's save.
    expect(afterResult({ code: "TICKER_TAKEN", draft: snap(2, {}) })).toEqual({ type: "saved", draft: snap(2, {}) });
    expect(afterResult({ code: "DEADLINE_PASSED" })).toEqual({ type: "failed" });
    expect(afterResult({ code: "VERSION_CONFLICT" })).toEqual({ type: "failed" });
    // So a refresh bringing that version back later is not offered as someone else's, even with more typed since.
    let s = run(start(), edit("answer", "Mine."), { type: "saving", fields: { answer: "Mine." } });
    s = run(s, afterResult({ code: "TICKER_TAKEN", draft: snap(2, { answer: "Mine." }, "p") }), edit("answer", "Mine. More."));
    s = run(s, { type: "server", draft: snap(2, { answer: "Mine." }, "p") });
    expect(s).toMatchObject({ base: { version: 2 }, theirs: null, fields: { answer: "Mine. More." } });
  });

  test("closed: the latest saved version is shown, and text typed here that was never saved is kept apart", () => {
    expect(closedView(start())).toEqual({ shown: v1, fields: { answer: "First answer." }, unsaved: null });
    expect(closedView(run(start(), edit("answer", "Mine.")))).toEqual({ shown: v1, fields: { answer: "First answer." }, unsaved: { answer: "Mine." } });
    const offered = run(start(), edit("answer", "Mine."), { type: "server", draft: snap(2, { answer: "Theirs." }) });
    expect(closedView(offered)).toMatchObject({ shown: { version: 2 }, fields: { answer: "Theirs." }, unsaved: { answer: "Mine." } });
    // Nothing typed here, but a newer version offered after a refused submit: nothing is unsaved.
    const refused = run(start(), { type: "conflict", draft: snap(2, { answer: "Theirs." }) });
    expect(closedView(refused)).toMatchObject({ shown: { version: 2 }, unsaved: null });
  });

  test("edits of the ticker are normalised", () => {
    const s = run(initEditor("PITCH", snap(0, {})), edit("ticker", "aq-s"));
    expect(s.fields.ticker).toBe("AQS");
  });
});

describe("this device's backup of unsaved text", () => {
  const v2 = snap(2, { answer: "Saved." });
  test("kept only while something is unsaved", () => {
    const s = initEditor("FLASH", v2);
    expect(backupOf(s)).toBeNull();
    expect(backupOf(run(s, edit("answer", "Typed.")))).toEqual({ baseVersion: 2, fields: { answer: "Typed." } });
    expect(backupKey("sq", "tm", "PLAN")).toBe("msim:draft:sq:tm:PLAN");
  });

  test("restored as typed text when it was based on the version shown; set aside when the draft has moved on", () => {
    const s = initEditor("FLASH", v2);
    expect(run(s, { type: "backup", backup: { baseVersion: 2, fields: { answer: "Typed." } }, editable: true })).toMatchObject({
      fields: { answer: "Typed." },
      notice: { kind: "restored" },
      backupChecked: true,
    });
    expect(run(s, { type: "backup", backup: { baseVersion: 1, fields: { answer: "Old typed." } }, editable: true })).toMatchObject({
      fields: { answer: "Saved." },
      stash: { fields: { answer: "Old typed." }, basedOn: 1, why: "backup" },
    });
    // Closed, the same as the screen, or none: nothing to do. Only the first look counts.
    expect(run(s, { type: "backup", backup: { baseVersion: 2, fields: { answer: "Typed." } }, editable: false }).fields.answer).toBe("Saved.");
    expect(run(s, { type: "backup", backup: { baseVersion: 2, fields: { answer: "Saved." } }, editable: true }).notice).toBeNull();
    const checked = run(s, { type: "backup", backup: null, editable: true });
    expect(checked.backupChecked).toBe(true);
    expect(run(checked, { type: "backup", backup: { baseVersion: 2, fields: { answer: "Typed." } }, editable: true })).toBe(checked);
  });

  test("a stored backup is read defensively", () => {
    expect(parseBackup("FLASH", null)).toBeNull();
    expect(parseBackup("FLASH", "{not json")).toBeNull();
    expect(parseBackup("FLASH", JSON.stringify({ baseVersion: "2", fields: {} }))).toBeNull();
    expect(parseBackup("FLASH", JSON.stringify({ baseVersion: 2, fields: { answer: "A", x: 1 } }))).toEqual({ baseVersion: 2, fields: { answer: "A" } });
  });
});

describe("results of the game functions", () => {
  test("a draft row (save_draft's result, or a row read through RLS)", () => {
    expect(toSnapshot({ version: 3, content: { answer: "A" }, updated_at: "t", updated_by_team: "c", id: "x" })).toEqual({
      version: 3,
      content: { answer: "A" },
      updatedAt: "t",
      updatedBy: "c",
    });
    expect(toSnapshot({ version: 0, content: null, updated_at: null, updated_by_team: null })).toEqual({ version: 0, content: {}, updatedAt: null, updatedBy: null });
    expect(toSnapshot({ version: "3" })).toBeNull();
    expect(toSnapshot(undefined)).toBeNull();
  });

  test("a submission row (submit_submission's result)", () => {
    expect(toSubmitted({ content: { answer: "A" }, submitted_at: "t", word_count: 1 })).toEqual({ content: { answer: "A" }, submittedAt: "t", words: 1 });
    expect(toSubmitted({ submitted_at: "t" })).toBeNull();
    expect(toSubmitted(null)).toBeNull();
  });
});
