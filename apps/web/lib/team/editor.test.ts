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
  mergeFields,
  normaliseTicker,
  parseBackup,
  rowsFor,
  sameFields,
  sectionNames,
  submitProblem,
  theirText,
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

describe("merging section by section", () => {
  const empty = fieldsOf("PLAN", {});
  const plan = (f: Record<string, string>) => ({ ...empty, ...f });

  test("unchanged here takes theirs; unchanged there or the same on both sides keeps mine; changed differently on both sides is a conflict", () => {
    const base = plan({ crisis: "B", new_plan: "B", money: "B", deal: "B", risks: "B" });
    const mine = plan({ crisis: "B", new_plan: "Mine", money: "Same", deal: "Mine", risks: "B" });
    const theirs = plan({ crisis: "Theirs", new_plan: "B", money: "Same", deal: "Theirs", risks: "" });
    expect(mergeFields("PLAN", base, mine, theirs)).toEqual({
      fields: plan({ crisis: "Theirs", new_plan: "Mine", money: "Same", deal: "Mine", risks: "" }),
      taken: ["crisis", "risks"],
      conflicts: ["deal"],
    });
  });

  test("a section already waiting for a choice still waits, unless theirs now matches mine", () => {
    const base = plan({ crisis: "Theirs" });
    const mine = plan({ crisis: "Mine", money: "Mine" });
    expect(mergeFields("PLAN", base, mine, plan({ crisis: "Theirs" }), ["crisis"]).conflicts).toEqual(["crisis"]);
    expect(mergeFields("PLAN", base, mine, plan({ crisis: "Theirs again" }), ["crisis"]).conflicts).toEqual(["crisis"]);
    expect(mergeFields("PLAN", base, mine, plan({ crisis: "Mine" }), ["crisis"])).toMatchObject({ conflicts: [], fields: { crisis: "Mine" } });
  });

  test("sections are named in the template's order", () => {
    expect(sectionNames("PLAN", ["crisis"])).toBe("The crisis");
    expect(sectionNames("PLAN", ["money", "crisis"])).toBe("The crisis and The money");
    expect(sectionNames("PLAN", ["risks", "crisis", "money"])).toBe("The crisis, The money and Risks");
    expect(sectionNames("PITCH", ["ticker"])).toBe("Ticker");
    expect(sectionNames("PLAN", [])).toBe("");
  });
});

describe("the editor when several screens save the same draft", () => {
  const v1 = snap(1, { answer: "First answer." }, "p");
  const start = () => initEditor("FLASH", v1);

  test("a newer version is shown at once when nothing was typed here", () => {
    const s = run(start(), { type: "server", draft: snap(2, { answer: "Their answer." }) });
    expect(s.fields.answer).toBe("Their answer.");
    expect(s.base.version).toBe(2);
    expect(s.conflicts).toEqual([]);
    expect(s.notice).toEqual({ kind: "updated", draft: snap(2, { answer: "Their answer." }) });
    expect(isDirty(s)).toBe(false);
  });

  test("an older or equal version from a stale refresh changes nothing", () => {
    const s = run(start(), edit("answer", "Mine."));
    expect(run(s, { type: "server", draft: v1 })).toBe(s);
    expect(run(s, { type: "server", draft: snap(0, {}) })).toBe(s);
  });

  test("B1: the two teams' edits to different sections merge on their own; the next save sends both", () => {
    // Product and Consulting both open the empty plan. Consulting types in The new plan; Product types in The crisis and saves.
    const v0 = snap(0, {});
    let consulting = run(initEditor("PLAN", v0), edit("new_plan", "License the sensors to councils."));
    const productV1 = snap(1, { ...fieldsOf("PLAN", {}), crisis: "Our supplier stopped deliveries." }, "p");
    consulting = run(consulting, { type: "server", draft: productV1 });
    expect(consulting.fields).toMatchObject({ crisis: "Our supplier stopped deliveries.", new_plan: "License the sensors to councils." });
    expect(consulting).toMatchObject({ base: { version: 1 }, conflicts: [], notice: { kind: "merged", draft: productV1, keys: ["crisis"] } });
    // Only Consulting's own section is unsaved now, and the next save names version 1 with both sections.
    expect(isDirty(consulting)).toBe(true);
    expect(backupOf(consulting)?.baseVersion).toBe(1);
    expect(draftPayload("PLAN", consulting.fields)).toMatchObject({ crisis: "Our supplier stopped deliveries.", new_plan: "License the sensors to councils." });
  });

  test("the same section changed differently on both screens is a real conflict; the other sections still merge", () => {
    const v1plan = snap(1, { ...fieldsOf("PLAN", {}), crisis: "Supplier stopped." }, "p");
    const typed = run(initEditor("PLAN", v1plan), edit("money", "The fund pays for one year."), edit("new_plan", "Sell to councils."));
    const v2plan = snap(2, { ...fieldsOf("PLAN", {}), crisis: "Supplier stopped.", money: "Six months.", risks: "Councils may refuse." }, "p");
    const s = run(typed, { type: "server", draft: v2plan });
    expect(s.conflicts).toEqual(["money"]);
    expect(s.fields).toMatchObject({ money: "The fund pays for one year.", new_plan: "Sell to councils.", risks: "Councils may refuse." });
    expect(theirText(s, "money")).toBe("Six months.");
    expect(s.base.version).toBe(2);
    expect(s.notice).toEqual({ kind: "merged", draft: v2plan, keys: ["risks"] });
  });

  test("local edits survive a merge, also through later versions while a choice waits", () => {
    let s = run(start(), edit("answer", "My new answer."), { type: "server", draft: snap(2, { answer: "Their answer." }) });
    expect(s).toMatchObject({ fields: { answer: "My new answer." }, base: { version: 2 }, conflicts: ["answer"] });
    expect(isDirty(s)).toBe(true);
    // A refusal for the version already merged changes nothing; a still newer one keeps the choice waiting.
    expect(run(s, { type: "conflict", draft: snap(2, { answer: "Their answer." }), action: "save" })).toEqual(s);
    s = run(s, { type: "server", draft: snap(3, { answer: "Newer." }) });
    expect(s).toMatchObject({ fields: { answer: "My new answer." }, base: { version: 3 }, conflicts: ["answer"] });
    // A version with this screen's text needs no choice; typing back to their text does not either.
    expect(run(s, { type: "server", draft: snap(4, { answer: "My new answer." }) })).toMatchObject({ conflicts: [], base: { version: 4 } });
    expect(run(s, edit("answer", "Newer.")).conflicts).toEqual([]);
  });

  test("unchanged sections take theirs, even emptied ones; sections typed in keep the typed text", () => {
    const base = snap(1, { ...fieldsOf("PLAN", {}), crisis: "C1", money: "M1", risks: "R1" }, "p");
    const s = run(initEditor("PLAN", base), edit("risks", "R mine"), { type: "server", draft: snap(2, { crisis: "C2", money: "", risks: "R1" }, "c") });
    expect(s.fields).toMatchObject({ crisis: "C2", money: "", risks: "R mine" });
    expect(s).toMatchObject({ conflicts: [], notice: { kind: "merged", keys: ["crisis", "money"] } });
  });

  test("a save refused for a newer version (VERSION_CONFLICT) merges it and keeps the typed text", () => {
    const typed = run(start(), edit("answer", "Mine."));
    const s = run(typed, { type: "saving", fields: { answer: "Mine." } }, { type: "conflict", draft: snap(2, { answer: "Theirs." }), action: "save" });
    expect(s).toMatchObject({ fields: { answer: "Mine." }, base: { version: 2 }, conflicts: ["answer"], saving: null });
  });

  test("F2: a screen with nothing typed shows the newer version a submit was refused for, and offers no choice", () => {
    const v2 = snap(2, { answer: "Theirs." }, "c");
    const s = run(start(), afterResult({ code: "VERSION_CONFLICT", draft: v2 }, "submit"));
    expect(s).toMatchObject({ fields: { answer: "Theirs." }, base: v2, conflicts: [], notice: { kind: "refused", draft: v2, action: "submit" } });
    expect(isDirty(s)).toBe(false);
    // Nothing is left to send: the old text cannot replace theirs by accident.
    expect(backupOf(s)).toBeNull();
    expect(run(s, { type: "keepMine" })).toBe(s);
  });

  test("use their text: the typed text of that section is set aside and can be put back; the next save then names their version", () => {
    let s = run(start(), edit("answer", "Mine."), { type: "server", draft: snap(2, { answer: "Theirs." }) }, { type: "useTheirs", keys: ["answer"] });
    expect(s.fields.answer).toBe("Theirs.");
    expect(s).toMatchObject({ base: { version: 2 }, conflicts: [] });
    expect(s.stash).toEqual({ fields: { answer: "Mine." }, basedOn: 2, why: "loaded" });
    expect(isDirty(s)).toBe(false);
    s = run(s, { type: "restoreStash" });
    expect(s.fields.answer).toBe("Mine.");
    expect(s.stash).toBeNull();
    expect(isDirty(s)).toBe(true);
    expect(s.base.version).toBe(2); // a save now names version 2
    expect(run(s, { type: "dropStash" }).stash).toBeNull();
  });

  test("putting set-aside text back changes only its sections", () => {
    const v1plan = snap(1, { ...fieldsOf("PLAN", {}), crisis: "C1" }, "p");
    let s = run(initEditor("PLAN", v1plan), edit("crisis", "C mine"), { type: "server", draft: snap(2, { crisis: "C2" }, "c") }, { type: "useTheirs" });
    s = run(s, { type: "server", draft: snap(3, { crisis: "C2", money: "M3" }, "c") });
    expect(s.fields).toMatchObject({ crisis: "C2", money: "M3" });
    s = run(s, { type: "restoreStash" });
    expect(s.fields).toMatchObject({ crisis: "C mine", money: "M3" });
  });

  test("keep my text: chosen section by section; the next save replaces their text there only", () => {
    const v1plan = snap(1, fieldsOf("PLAN", {}), "p");
    const both = run(initEditor("PLAN", v1plan), edit("crisis", "C mine"), edit("money", "M mine"), {
      type: "server",
      draft: snap(2, { crisis: "C theirs", money: "M theirs", risks: "R theirs" }, "c"),
    });
    expect(both.conflicts).toEqual(["crisis", "money"]);
    const one = run(both, { type: "keepMine", keys: ["crisis"] });
    expect(one).toMatchObject({ conflicts: ["money"], notice: { kind: "kept", keys: ["crisis"] } });
    const s = run(one, { type: "useTheirs", keys: ["money"] });
    expect(s.conflicts).toEqual([]);
    expect(draftPayload("PLAN", s.fields)).toMatchObject({ crisis: "C mine", money: "M theirs", risks: "R theirs" });
    expect(s.base.version).toBe(2);
    // Every section at once (replace their version with mine where both changed).
    expect(run(both, { type: "keepMine" })).toMatchObject({ conflicts: [], fields: { crisis: "C mine", money: "M mine", risks: "R theirs" } });
    expect(run(both, { type: "useTheirs" }).stash?.fields).toEqual({ crisis: "C mine", money: "M mine" });
  });

  test("a save coming back with a refresh before its answer is not a conflict, even if more was typed meanwhile", () => {
    let s = run(start(), edit("answer", "Mine."), { type: "saving", fields: { answer: "Mine." } }, edit("answer", "Mine. More."));
    s = run(s, { type: "server", draft: snap(2, { answer: "Mine." }, "p") });
    expect(s).toMatchObject({ base: { version: 2 }, conflicts: [], fields: { answer: "Mine. More." } });
    s = run(s, { type: "saved", draft: snap(2, { answer: "Mine." }, "p") });
    expect(s).toMatchObject({ base: { version: 2 }, saving: null });
    expect(isDirty(s)).toBe(true);
  });

  test("saved: the saved version is the base; an answer older than a version already merged does not move it back", () => {
    const typed = run(start(), edit("answer", "Mine."));
    expect(run(typed, { type: "saved", draft: snap(2, { answer: "Mine." }, "p") })).toMatchObject({ base: { version: 2 }, conflicts: [], notice: null });
    const merged = run(typed, { type: "server", draft: snap(3, { answer: "Theirs." }) });
    expect(run(merged, { type: "saved", draft: snap(2, { answer: "Mine." }, "p") })).toMatchObject({ base: { version: 3 }, conflicts: ["answer"] });
    expect(run(typed, { type: "saving", fields: { answer: "Mine." } }, { type: "failed" }).saving).toBeNull();
  });

  test("the same text saved elsewhere is simply taken as the base", () => {
    const s = run(start(), edit("answer", "Same."), { type: "server", draft: snap(2, { answer: "Same." }) });
    expect(s).toMatchObject({ base: { version: 2 }, conflicts: [], notice: null });
    expect(isDirty(s)).toBe(false);
  });

  test("a result: a newer version refused for is merged or shown; any other result with a draft makes it the base", () => {
    expect(afterResult({ code: "VERSION_CONFLICT", draft: snap(3, {}) })).toEqual({ type: "conflict", draft: snap(3, {}), action: "save" });
    expect(afterResult({ code: "VERSION_CONFLICT", draft: snap(3, {}) }, "submit")).toEqual({ type: "conflict", draft: snap(3, {}), action: "submit" });
    expect(afterResult({ draft: snap(2, {}) })).toEqual({ type: "saved", draft: snap(2, {}) });
    // Submit saved version 2, then submit_submission refused (TICKER_TAKEN): version 2 is still this screen's save.
    expect(afterResult({ code: "TICKER_TAKEN", draft: snap(2, {}) })).toEqual({ type: "saved", draft: snap(2, {}) });
    expect(afterResult({ code: "DEADLINE_PASSED" })).toEqual({ type: "failed" });
    expect(afterResult({ code: "VERSION_CONFLICT" })).toEqual({ type: "failed" });
    // So a refresh bringing that version back later is not taken for someone else's, even with more typed since.
    let s = run(start(), edit("answer", "Mine."), { type: "saving", fields: { answer: "Mine." } });
    s = run(s, afterResult({ code: "TICKER_TAKEN", draft: snap(2, { answer: "Mine." }, "p") }), edit("answer", "Mine. More."));
    s = run(s, { type: "server", draft: snap(2, { answer: "Mine." }, "p") });
    expect(s).toMatchObject({ base: { version: 2 }, conflicts: [], fields: { answer: "Mine. More." } });
  });

  test("closed: the latest saved version is shown, and text typed here that was never saved is kept apart", () => {
    expect(closedView(start())).toEqual({ shown: v1, fields: { answer: "First answer." }, unsaved: null });
    expect(closedView(run(start(), edit("answer", "Mine.")))).toEqual({ shown: v1, fields: { answer: "First answer." }, unsaved: { answer: "Mine." } });
    const waiting = run(start(), edit("answer", "Mine."), { type: "server", draft: snap(2, { answer: "Theirs." }) });
    expect(closedView(waiting)).toMatchObject({ shown: { version: 2 }, fields: { answer: "Theirs." }, unsaved: { answer: "Mine." } });
    // Nothing typed here, and a newer version shown after a refused submit: nothing is unsaved.
    const refused = run(start(), { type: "conflict", draft: snap(2, { answer: "Theirs." }), action: "submit" });
    expect(closedView(refused)).toMatchObject({ shown: { version: 2 }, unsaved: null });
  });

  test("edits of the ticker are normalised; the pitch's name and ticker merge like its sections", () => {
    const s = run(initEditor("PITCH", snap(0, {})), edit("ticker", "aq-s"));
    expect(s.fields.ticker).toBe("AQS");
    const merged = run(s, { type: "server", draft: snap(1, { company_name: "Aqua", ticker: "AQX" }, "p") });
    expect(merged).toMatchObject({ fields: { company_name: "Aqua", ticker: "AQS" }, conflicts: ["ticker"], notice: { kind: "merged", keys: ["company_name"] } });
  });
});

describe("this device's backup of unsaved text", () => {
  const v2 = snap(2, { answer: "Saved." });
  test("kept only while something is unsaved, with the text it was based on and the sections waiting for a choice", () => {
    const s = initEditor("FLASH", v2);
    expect(backupOf(s)).toBeNull();
    expect(backupOf(run(s, edit("answer", "Typed.")))).toEqual({ baseVersion: 2, fields: { answer: "Typed." }, baseFields: { answer: "Saved." }, conflicts: [] });
    const waiting = run(s, edit("answer", "Typed."), { type: "server", draft: snap(3, { answer: "Theirs." }) });
    expect(backupOf(waiting)).toEqual({ baseVersion: 3, fields: { answer: "Typed." }, baseFields: { answer: "Theirs." }, conflicts: ["answer"] });
    expect(backupKey("sq", "tm", "PLAN")).toBe("msim:draft:sq:tm:PLAN");
  });

  test("restored as typed text when it was based on the version shown, with its choices still waiting", () => {
    const s = initEditor("FLASH", v2);
    expect(run(s, { type: "backup", backup: { baseVersion: 2, fields: { answer: "Typed." } }, editable: true })).toMatchObject({
      fields: { answer: "Typed." },
      conflicts: [],
      notice: { kind: "restored", merged: [] },
      backupChecked: true,
    });
    const waiting = { baseVersion: 2, fields: { answer: "Typed." }, baseFields: { answer: "Saved." }, conflicts: ["answer"] };
    expect(run(s, { type: "backup", backup: waiting, editable: true })).toMatchObject({ fields: { answer: "Typed." }, conflicts: ["answer"] });
    // Closed, the same as the screen, or none: nothing to do. Only the first look counts.
    expect(run(s, { type: "backup", backup: { baseVersion: 2, fields: { answer: "Typed." } }, editable: false }).fields.answer).toBe("Saved.");
    expect(run(s, { type: "backup", backup: { baseVersion: 2, fields: { answer: "Saved." } }, editable: true }).notice).toBeNull();
    const checked = run(s, { type: "backup", backup: null, editable: true });
    expect(checked.backupChecked).toBe(true);
    expect(run(checked, { type: "backup", backup: { baseVersion: 2, fields: { answer: "Typed." } }, editable: true })).toBe(checked);
  });

  test("based on an older version: merged with the saved one section by section", () => {
    const saved = snap(3, { ...fieldsOf("PLAN", {}), crisis: "C3", money: "M3" }, "c");
    const s = initEditor("PLAN", saved);
    const backup = { baseVersion: 2, baseFields: { ...fieldsOf("PLAN", {}), crisis: "C2", money: "M2" }, fields: { ...fieldsOf("PLAN", {}), crisis: "C2", money: "M mine", risks: "R mine" } };
    expect(run(s, { type: "backup", backup, editable: true })).toMatchObject({
      fields: { crisis: "C3", money: "M mine", risks: "R mine" },
      conflicts: ["money"],
      notice: { kind: "restored", merged: ["crisis"] },
      stash: null,
    });
  });

  test("an older backup without the text it was based on is set aside, only where it differs", () => {
    const s = initEditor("PLAN", snap(3, { ...fieldsOf("PLAN", {}), crisis: "C3" }));
    const r = run(s, { type: "backup", backup: { baseVersion: 1, fields: { ...fieldsOf("PLAN", {}), crisis: "C3", money: "Old typed." } }, editable: true });
    expect(r).toMatchObject({ fields: { crisis: "C3", money: "" }, stash: { fields: { money: "Old typed." }, basedOn: 1, why: "backup" } });
    expect(run(r, { type: "restoreStash" }).fields).toMatchObject({ crisis: "C3", money: "Old typed." });
  });

  test("a stored backup is read defensively", () => {
    expect(parseBackup("FLASH", null)).toBeNull();
    expect(parseBackup("FLASH", "{not json")).toBeNull();
    expect(parseBackup("FLASH", JSON.stringify({ baseVersion: "2", fields: {} }))).toBeNull();
    expect(parseBackup("FLASH", JSON.stringify({ baseVersion: 2, fields: { answer: "A", x: 1 } }))).toEqual({ baseVersion: 2, fields: { answer: "A" } });
    expect(parseBackup("FLASH", JSON.stringify({ baseVersion: 2, fields: { answer: "A" }, baseFields: { answer: "B" }, conflicts: ["answer", "x", 3] }))).toEqual({
      baseVersion: 2,
      fields: { answer: "A" },
      baseFields: { answer: "B" },
      conflicts: ["answer"],
    });
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
