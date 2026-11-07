import { describe, expect, test } from "vitest";
import { submissionWords } from "@msim/engine";
import {
  MAX_CONTENT_CHARS,
  NO_DRAFT,
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
  saveProblem,
  sectionNames,
  theirText,
  tickerNote,
  toSnapshot,
  wordStats,
  type DraftSnapshot,
  type EditorAction,
  type EditorState,
} from "./editor";

// The third argument (who saved) is kept for readability of the scenarios; a team's screens all save as the team.
const snap = (version: number, content: Record<string, unknown>, _screen = "other"): DraftSnapshot => ({
  version,
  content,
  updatedAt: `2026-11-20T16:0${version}:00.000Z`,
});
const run = (s: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, s);
const edit = (key: string, value: string): EditorAction => ({ type: "edit", key, value });

describe("templates and fields", () => {
  test("the PRD carries the company name and ticker before its nine parts; the solution has six", () => {
    expect(fieldSpecs("PRD").map((f) => f.key)).toEqual([
      "company_name", "ticker", "problem", "target_user", "must_have", "should_have", "not_in_v1", "per_pack_maths", "go_to_market", "success_metrics", "risks",
    ]);
    expect(fieldSpecs("PRD").filter((f) => !f.counted).map((f) => f.key)).toEqual(["company_name", "ticker"]);
    expect(fieldSpecs("SOLUTION").map((f) => f.label)).toEqual(["Diagnosis", "Three options", "Recommendation", "Per-pack maths", "Timeline", "Risks"]);
  });

  test("stored content becomes strings for every known field; only the template's fields are sent", () => {
    expect(fieldsOf("SOLUTION", { diagnosis: 5, extra: "x" }).diagnosis).toBe("");
    expect(fieldsOf("SOLUTION", null).risks).toBe("");
    expect(fieldsOf("PRD", { ticker: "MLBT" }).ticker).toBe("MLBT");
    expect(draftPayload("SOLUTION", { diagnosis: "Yes.", sneaky: "no" })).toEqual({ diagnosis: "Yes.", three_options: "", recommendation: "", per_pack_maths: "", timeline: "", risks: "" });
    expect(Object.keys(draftPayload("PRD", {}))).toHaveLength(11);
    expect(sameFields("SOLUTION", { diagnosis: "a" }, { diagnosis: "a", other: "b" })).toBe(true);
    expect(sameFields("SOLUTION", { diagnosis: "a" }, { diagnosis: "a " })).toBe(false);
    expect(NO_DRAFT).toEqual({ version: 0, content: {}, updatedAt: null });
  });

  test("a typed ticker: capital letters only, at most four", () => {
    expect(normaliseTicker("ml b1t")).toBe("MLBT");
    expect(normaliseTicker("abcdef")).toBe("ABCD");
  });
});

describe("word counts (the engine's, which SQL also uses)", () => {
  test("per field and in total, against the limit; the name and ticker do not count", () => {
    const fields = { ...fieldsOf("PRD", {}), company_name: "Masala Labs Bites", ticker: "MLBT", problem: "Snacks go stale — in humid towns.", target_user: "Students." };
    const s = wordStats("PRD", fields);
    expect(s.perField.problem).toBe(6); // "—" alone is not a word
    expect(s.perField.target_user).toBe(1);
    expect(s.perField.company_name).toBeUndefined();
    expect(s.total).toBe(7);
    expect(s.total).toBe(submissionWords("PRD", fields));
    expect(s).toMatchObject({ limit: 800, over: 0 });
    expect(wordStats("SOLUTION", { diagnosis: "word ".repeat(503) })).toMatchObject({ total: 503, limit: 500, over: 3 });
  });

  test("what a save would be refused for, as save_draft says it; the ticker note", () => {
    expect(saveProblem("SOLUTION", { diagnosis: "  " })).toBeNull();
    expect(saveProblem("SOLUTION", { diagnosis: "w ".repeat(501) })).toEqual({ code: "TOO_LONG", message: "At most 500 words (you have 501)." });
    expect(saveProblem("SOLUTION", { diagnosis: "w ".repeat(500) })).toBeNull();
    expect(saveProblem("PRD", { ticker: "MLB" })).toEqual({ code: "BAD_TICKER", message: "The ticker is exactly four letters, e.g. MLBT." });
    expect(saveProblem("PRD", { ticker: "MLBT", company_name: "x".repeat(61) })?.code).toBe("BAD_NAME");
    expect(tickerNote("PRD", { ticker: "" })).toMatch(/claimed by the first team/);
    expect(tickerNote("PRD", { ticker: "ML" })).toBe("The ticker is exactly four letters.");
    expect(tickerNote("PRD", { ticker: "MLBT" })).toBeNull();
    expect(tickerNote("SOLUTION", {})).toBeNull();
  });

  test("the content's jsonb length is never underestimated", () => {
    // Postgres: {"a": "b"} is 10 characters, {"a": "b", "c": "d"} 20.
    expect(contentChars({ a: "b" })).toBe(10);
    expect(contentChars({ a: "b", c: "d" })).toBe(20);
    expect(contentChars({})).toBe(2);
    expect(contentChars({ a: 'say "hi"\n' })).toBe(`{"a": "say \\"hi\\"\\n"}`.length);
    expect(contentChars({ diagnosis: "x".repeat(MAX_CONTENT_CHARS) })).toBeGreaterThan(MAX_CONTENT_CHARS);
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
  const empty = fieldsOf("SOLUTION", {});
  const plan = (f: Record<string, string>) => ({ ...empty, ...f });

  test("unchanged here takes theirs; unchanged there or the same on both sides keeps mine; changed differently on both sides is a conflict", () => {
    const base = plan({ diagnosis: "B", three_options: "B", recommendation: "B", per_pack_maths: "B", risks: "B" });
    const mine = plan({ diagnosis: "B", three_options: "Mine", recommendation: "Same", per_pack_maths: "Mine", risks: "B" });
    const theirs = plan({ diagnosis: "Theirs", three_options: "B", recommendation: "Same", per_pack_maths: "Theirs", risks: "" });
    expect(mergeFields("SOLUTION", base, mine, theirs)).toEqual({
      fields: plan({ diagnosis: "Theirs", three_options: "Mine", recommendation: "Same", per_pack_maths: "Mine", risks: "" }),
      taken: ["diagnosis", "risks"],
      conflicts: ["per_pack_maths"],
    });
  });

  test("a section already waiting for a choice still waits, unless theirs now matches mine", () => {
    const base = plan({ diagnosis: "Theirs" });
    const mine = plan({ diagnosis: "Mine", recommendation: "Mine" });
    expect(mergeFields("SOLUTION", base, mine, plan({ diagnosis: "Theirs" }), ["diagnosis"]).conflicts).toEqual(["diagnosis"]);
    expect(mergeFields("SOLUTION", base, mine, plan({ diagnosis: "Theirs again" }), ["diagnosis"]).conflicts).toEqual(["diagnosis"]);
    expect(mergeFields("SOLUTION", base, mine, plan({ diagnosis: "Mine" }), ["diagnosis"])).toMatchObject({ conflicts: [], fields: { diagnosis: "Mine" } });
  });

  test("sections are named in the template's order", () => {
    expect(sectionNames("SOLUTION", ["diagnosis"])).toBe("Diagnosis");
    expect(sectionNames("SOLUTION", ["recommendation", "diagnosis"])).toBe("Diagnosis and Recommendation");
    expect(sectionNames("SOLUTION", ["risks", "diagnosis", "recommendation"])).toBe("Diagnosis, Recommendation and Risks");
    expect(sectionNames("PRD", ["ticker"])).toBe("Ticker");
    expect(sectionNames("SOLUTION", [])).toBe("");
  });
});

describe("the editor when several screens save the same draft", () => {
  const v1 = snap(1, { diagnosis: "First diagnosis." }, "p");
  const start = () => initEditor("SOLUTION", v1);

  test("a newer version is shown at once when nothing was typed here", () => {
    const s = run(start(), { type: "server", draft: snap(2, { diagnosis: "Their diagnosis." }) });
    expect(s.fields.diagnosis).toBe("Their diagnosis.");
    expect(s.base.version).toBe(2);
    expect(s.conflicts).toEqual([]);
    expect(s.notice).toEqual({ kind: "updated", draft: snap(2, { diagnosis: "Their diagnosis." }) });
    expect(isDirty(s)).toBe(false);
  });

  test("an older or equal version from a stale refresh changes nothing", () => {
    const s = run(start(), edit("diagnosis", "Mine."));
    expect(run(s, { type: "server", draft: v1 })).toBe(s);
    expect(run(s, { type: "server", draft: snap(0, {}) })).toBe(s);
  });

  test("B1: the two teams' edits to different sections merge on their own; the next save sends both", () => {
    // Product and Consulting both open the empty plan. Consulting types in The new plan; Product types in The diagnosis and saves.
    const v0 = snap(0, {});
    let consulting = run(initEditor("SOLUTION", v0), edit("three_options", "License the sensors to councils."));
    const productV1 = snap(1, { ...fieldsOf("SOLUTION", {}), diagnosis: "Our supplier stopped deliveries." }, "p");
    consulting = run(consulting, { type: "server", draft: productV1 });
    expect(consulting.fields).toMatchObject({ diagnosis: "Our supplier stopped deliveries.", three_options: "License the sensors to councils." });
    expect(consulting).toMatchObject({ base: { version: 1 }, conflicts: [], notice: { kind: "merged", draft: productV1, keys: ["diagnosis"] } });
    // Only Consulting's own section is unsaved now, and the next save names version 1 with both sections.
    expect(isDirty(consulting)).toBe(true);
    expect(backupOf(consulting)?.baseVersion).toBe(1);
    expect(draftPayload("SOLUTION", consulting.fields)).toMatchObject({ diagnosis: "Our supplier stopped deliveries.", three_options: "License the sensors to councils." });
  });

  test("the same section changed differently on both screens is a real conflict; the other sections still merge", () => {
    const v1plan = snap(1, { ...fieldsOf("SOLUTION", {}), diagnosis: "Supplier stopped." }, "p");
    const typed = run(initEditor("SOLUTION", v1plan), edit("recommendation", "The fund pays for one year."), edit("three_options", "Sell to councils."));
    const v2plan = snap(2, { ...fieldsOf("SOLUTION", {}), diagnosis: "Supplier stopped.", recommendation: "Six months.", risks: "Councils may refuse." }, "p");
    const s = run(typed, { type: "server", draft: v2plan });
    expect(s.conflicts).toEqual(["recommendation"]);
    expect(s.fields).toMatchObject({ recommendation: "The fund pays for one year.", three_options: "Sell to councils.", risks: "Councils may refuse." });
    expect(theirText(s, "recommendation")).toBe("Six months.");
    expect(s.base.version).toBe(2);
    expect(s.notice).toEqual({ kind: "merged", draft: v2plan, keys: ["risks"] });
  });

  test("local edits survive a merge, also through later versions while a choice waits", () => {
    let s = run(start(), edit("diagnosis", "My new diagnosis."), { type: "server", draft: snap(2, { diagnosis: "Their diagnosis." }) });
    expect(s).toMatchObject({ fields: { diagnosis: "My new diagnosis." }, base: { version: 2 }, conflicts: ["diagnosis"] });
    expect(isDirty(s)).toBe(true);
    // A refusal for the version already merged changes nothing; a still newer one keeps the choice waiting.
    expect(run(s, { type: "conflict", draft: snap(2, { diagnosis: "Their diagnosis." }), action: "save" })).toEqual(s);
    s = run(s, { type: "server", draft: snap(3, { diagnosis: "Newer." }) });
    expect(s).toMatchObject({ fields: { diagnosis: "My new diagnosis." }, base: { version: 3 }, conflicts: ["diagnosis"] });
    // A version with this screen's text needs no choice; typing back to their text does not either.
    expect(run(s, { type: "server", draft: snap(4, { diagnosis: "My new diagnosis." }) })).toMatchObject({ conflicts: [], base: { version: 4 } });
    expect(run(s, edit("diagnosis", "Newer.")).conflicts).toEqual([]);
  });

  test("unchanged sections take theirs, even emptied ones; sections typed in keep the typed text", () => {
    const base = snap(1, { ...fieldsOf("SOLUTION", {}), diagnosis: "C1", recommendation: "M1", risks: "R1" }, "p");
    const s = run(initEditor("SOLUTION", base), edit("risks", "R mine"), { type: "server", draft: snap(2, { diagnosis: "C2", recommendation: "", risks: "R1" }, "c") });
    expect(s.fields).toMatchObject({ diagnosis: "C2", recommendation: "", risks: "R mine" });
    expect(s).toMatchObject({ conflicts: [], notice: { kind: "merged", keys: ["diagnosis", "recommendation"] } });
  });

  test("a save refused for a newer version (VERSION_CONFLICT) merges it and keeps the typed text", () => {
    const typed = run(start(), edit("diagnosis", "Mine."));
    const s = run(typed, { type: "saving", fields: { diagnosis: "Mine." } }, { type: "conflict", draft: snap(2, { diagnosis: "Theirs." }), action: "save" });
    expect(s).toMatchObject({ fields: { diagnosis: "Mine." }, base: { version: 2 }, conflicts: ["diagnosis"], saving: null });
  });

  test("F2: a screen with nothing typed shows the newer version a save was refused for, and offers no choice", () => {
    const v2 = snap(2, { diagnosis: "Theirs." }, "c");
    const s = run(start(), afterResult({ code: "VERSION_CONFLICT", draft: v2 }));
    expect(s).toMatchObject({ fields: { diagnosis: "Theirs." }, base: v2, conflicts: [], notice: { kind: "refused", draft: v2, action: "save" } });
    expect(isDirty(s)).toBe(false);
    // Nothing is left to send: the old text cannot replace theirs by accident.
    expect(backupOf(s)).toBeNull();
    expect(run(s, { type: "keepMine" })).toBe(s);
  });

  test("use their text: the typed text of that section is set aside and can be put back; the next save then names their version", () => {
    let s = run(start(), edit("diagnosis", "Mine."), { type: "server", draft: snap(2, { diagnosis: "Theirs." }) }, { type: "useTheirs", keys: ["diagnosis"] });
    expect(s.fields.diagnosis).toBe("Theirs.");
    expect(s).toMatchObject({ base: { version: 2 }, conflicts: [] });
    expect(s.stash).toEqual({ fields: { diagnosis: "Mine." }, basedOn: 2, why: "loaded" });
    expect(isDirty(s)).toBe(false);
    s = run(s, { type: "restoreStash" });
    expect(s.fields.diagnosis).toBe("Mine.");
    expect(s.stash).toBeNull();
    expect(isDirty(s)).toBe(true);
    expect(s.base.version).toBe(2); // a save now names version 2
    expect(run(s, { type: "dropStash" }).stash).toBeNull();
  });

  test("putting set-aside text back changes only its sections", () => {
    const v1plan = snap(1, { ...fieldsOf("SOLUTION", {}), diagnosis: "C1" }, "p");
    let s = run(initEditor("SOLUTION", v1plan), edit("diagnosis", "C mine"), { type: "server", draft: snap(2, { diagnosis: "C2" }, "c") }, { type: "useTheirs" });
    s = run(s, { type: "server", draft: snap(3, { diagnosis: "C2", recommendation: "M3" }, "c") });
    expect(s.fields).toMatchObject({ diagnosis: "C2", recommendation: "M3" });
    s = run(s, { type: "restoreStash" });
    expect(s.fields).toMatchObject({ diagnosis: "C mine", recommendation: "M3" });
  });

  test("keep my text: chosen section by section; the next save replaces their text there only", () => {
    const v1plan = snap(1, fieldsOf("SOLUTION", {}), "p");
    const both = run(initEditor("SOLUTION", v1plan), edit("diagnosis", "C mine"), edit("recommendation", "M mine"), {
      type: "server",
      draft: snap(2, { diagnosis: "C theirs", recommendation: "M theirs", risks: "R theirs" }, "c"),
    });
    expect(both.conflicts).toEqual(["diagnosis", "recommendation"]);
    const one = run(both, { type: "keepMine", keys: ["diagnosis"] });
    expect(one).toMatchObject({ conflicts: ["recommendation"], notice: { kind: "kept", keys: ["diagnosis"] } });
    const s = run(one, { type: "useTheirs", keys: ["recommendation"] });
    expect(s.conflicts).toEqual([]);
    expect(draftPayload("SOLUTION", s.fields)).toMatchObject({ diagnosis: "C mine", recommendation: "M theirs", risks: "R theirs" });
    expect(s.base.version).toBe(2);
    // Every section at once (replace their version with mine where both changed).
    expect(run(both, { type: "keepMine" })).toMatchObject({ conflicts: [], fields: { diagnosis: "C mine", recommendation: "M mine", risks: "R theirs" } });
    expect(run(both, { type: "useTheirs" }).stash?.fields).toEqual({ diagnosis: "C mine", recommendation: "M mine" });
  });

  test("a save coming back with a refresh before its diagnosis is not a conflict, even if more was typed meanwhile", () => {
    let s = run(start(), edit("diagnosis", "Mine."), { type: "saving", fields: { diagnosis: "Mine." } }, edit("diagnosis", "Mine. More."));
    s = run(s, { type: "server", draft: snap(2, { diagnosis: "Mine." }, "p") });
    expect(s).toMatchObject({ base: { version: 2 }, conflicts: [], fields: { diagnosis: "Mine. More." } });
    s = run(s, { type: "saved", draft: snap(2, { diagnosis: "Mine." }, "p") });
    expect(s).toMatchObject({ base: { version: 2 }, saving: null });
    expect(isDirty(s)).toBe(true);
  });

  test("saved: the saved version is the base; an diagnosis older than a version already merged does not move it back", () => {
    const typed = run(start(), edit("diagnosis", "Mine."));
    expect(run(typed, { type: "saved", draft: snap(2, { diagnosis: "Mine." }, "p") })).toMatchObject({ base: { version: 2 }, conflicts: [], notice: null });
    const merged = run(typed, { type: "server", draft: snap(3, { diagnosis: "Theirs." }) });
    expect(run(merged, { type: "saved", draft: snap(2, { diagnosis: "Mine." }, "p") })).toMatchObject({ base: { version: 3 }, conflicts: ["diagnosis"] });
    expect(run(typed, { type: "saving", fields: { diagnosis: "Mine." } }, { type: "failed" }).saving).toBeNull();
  });

  test("the same text saved elsewhere is simply taken as the base", () => {
    const s = run(start(), edit("diagnosis", "Same."), { type: "server", draft: snap(2, { diagnosis: "Same." }) });
    expect(s).toMatchObject({ base: { version: 2 }, conflicts: [], notice: null });
    expect(isDirty(s)).toBe(false);
  });

  test("a result: a newer version refused for is merged or shown; any other result with a draft makes it the base", () => {
    expect(afterResult({ code: "VERSION_CONFLICT", draft: snap(3, {}) })).toEqual({ type: "conflict", draft: snap(3, {}), action: "save" });
    expect(afterResult({ draft: snap(2, {}) })).toEqual({ type: "saved", draft: snap(2, {}) });
    // A result that carries a draft this screen saved makes it the base, whatever its code.
    expect(afterResult({ code: "TICKER_TAKEN", draft: snap(2, {}) })).toEqual({ type: "saved", draft: snap(2, {}) });
    expect(afterResult({ code: "DEADLINE_PASSED" })).toEqual({ type: "failed" });
    expect(afterResult({ code: "VERSION_CONFLICT" })).toEqual({ type: "failed" });
    // So a refresh bringing that version back later is not taken for someone else's, even with more typed since.
    let s = run(start(), edit("diagnosis", "Mine."), { type: "saving", fields: { diagnosis: "Mine." } });
    s = run(s, afterResult({ code: "TICKER_TAKEN", draft: snap(2, { diagnosis: "Mine." }, "p") }), edit("diagnosis", "Mine. More."));
    s = run(s, { type: "server", draft: snap(2, { diagnosis: "Mine." }, "p") });
    expect(s).toMatchObject({ base: { version: 2 }, conflicts: [], fields: { diagnosis: "Mine. More." } });
  });

  test("closed: the latest saved version is shown, and text typed here that was never saved is kept apart", () => {
    expect(closedView(start())).toMatchObject({ shown: v1, fields: { diagnosis: "First diagnosis." }, unsaved: null });
    expect(closedView(run(start(), edit("diagnosis", "Mine.")))).toMatchObject({ shown: v1, fields: { diagnosis: "First diagnosis." }, unsaved: { diagnosis: "Mine." } });
    const waiting = run(start(), edit("diagnosis", "Mine."), { type: "server", draft: snap(2, { diagnosis: "Theirs." }) });
    expect(closedView(waiting)).toMatchObject({ shown: { version: 2 }, fields: { diagnosis: "Theirs." }, unsaved: { diagnosis: "Mine." } });
    // Nothing typed here, and a newer version shown after a refused save: nothing is unsaved.
    const refused = run(start(), { type: "conflict", draft: snap(2, { diagnosis: "Theirs." }), action: "save" });
    expect(closedView(refused)).toMatchObject({ shown: { version: 2 }, unsaved: null });
  });

  test("edits of the ticker are normalised; the PRD's name and ticker merge like its parts", () => {
    const s = run(initEditor("PRD", snap(0, {})), edit("ticker", "ml-bt"));
    expect(s.fields.ticker).toBe("MLBT");
    const merged = run(s, { type: "server", draft: snap(1, { company_name: "Masala", ticker: "MLBX" }, "p") });
    expect(merged).toMatchObject({ fields: { company_name: "Masala", ticker: "MLBT" }, conflicts: ["ticker"], notice: { kind: "merged", keys: ["company_name"] } });
  });
});

describe("this device's backup of unsaved text", () => {
  const v2 = snap(2, { diagnosis: "Saved." });
  test("kept only while something is unsaved, with the text it was based on and the sections waiting for a choice", () => {
    const s = initEditor("SOLUTION", v2);
    expect(backupOf(s)).toBeNull();
    expect(backupOf(run(s, edit("diagnosis", "Typed.")))).toMatchObject({ baseVersion: 2, fields: { diagnosis: "Typed." }, baseFields: { diagnosis: "Saved." }, conflicts: [] });
    const waiting = run(s, edit("diagnosis", "Typed."), { type: "server", draft: snap(3, { diagnosis: "Theirs." }) });
    expect(backupOf(waiting)).toMatchObject({ baseVersion: 3, fields: { diagnosis: "Typed." }, baseFields: { diagnosis: "Theirs." }, conflicts: ["diagnosis"] });
    expect(backupKey("tm", "SOLUTION")).toBe("primus:draft:tm:SOLUTION");
  });

  test("restored as typed text when it was based on the version shown, with its choices still waiting", () => {
    const s = initEditor("SOLUTION", v2);
    expect(run(s, { type: "backup", backup: { baseVersion: 2, fields: { diagnosis: "Typed." } }, editable: true })).toMatchObject({
      fields: { diagnosis: "Typed." },
      conflicts: [],
      notice: { kind: "restored", merged: [] },
      backupChecked: true,
    });
    const waiting = { baseVersion: 2, fields: { diagnosis: "Typed." }, baseFields: { diagnosis: "Saved." }, conflicts: ["diagnosis"] };
    expect(run(s, { type: "backup", backup: waiting, editable: true })).toMatchObject({ fields: { diagnosis: "Typed." }, conflicts: ["diagnosis"] });
    // Closed, the same as the screen, or none: nothing to do. Only the first look counts.
    expect(run(s, { type: "backup", backup: { baseVersion: 2, fields: { diagnosis: "Typed." } }, editable: false }).fields.diagnosis).toBe("Saved.");
    expect(run(s, { type: "backup", backup: { baseVersion: 2, fields: { diagnosis: "Saved." } }, editable: true }).notice).toBeNull();
    const checked = run(s, { type: "backup", backup: null, editable: true });
    expect(checked.backupChecked).toBe(true);
    expect(run(checked, { type: "backup", backup: { baseVersion: 2, fields: { diagnosis: "Typed." } }, editable: true })).toBe(checked);
  });

  test("based on an older version: merged with the saved one section by section", () => {
    const saved = snap(3, { ...fieldsOf("SOLUTION", {}), diagnosis: "C3", recommendation: "M3" }, "c");
    const s = initEditor("SOLUTION", saved);
    const backup = { baseVersion: 2, baseFields: { ...fieldsOf("SOLUTION", {}), diagnosis: "C2", recommendation: "M2" }, fields: { ...fieldsOf("SOLUTION", {}), diagnosis: "C2", recommendation: "M mine", risks: "R mine" } };
    expect(run(s, { type: "backup", backup, editable: true })).toMatchObject({
      fields: { diagnosis: "C3", recommendation: "M mine", risks: "R mine" },
      conflicts: ["recommendation"],
      notice: { kind: "restored", merged: ["diagnosis"] },
      stash: null,
    });
  });

  test("an older backup without the text it was based on is set aside, only where it differs", () => {
    const s = initEditor("SOLUTION", snap(3, { ...fieldsOf("SOLUTION", {}), diagnosis: "C3" }));
    const r = run(s, { type: "backup", backup: { baseVersion: 1, fields: { ...fieldsOf("SOLUTION", {}), diagnosis: "C3", recommendation: "Old typed." } }, editable: true });
    expect(r).toMatchObject({ fields: { diagnosis: "C3", recommendation: "" }, stash: { fields: { recommendation: "Old typed." }, basedOn: 1, why: "backup" } });
    expect(run(r, { type: "restoreStash" }).fields).toMatchObject({ diagnosis: "C3", recommendation: "Old typed." });
  });

  test("a stored backup is read defensively", () => {
    expect(parseBackup("SOLUTION", null)).toBeNull();
    expect(parseBackup("SOLUTION", "{not json")).toBeNull();
    expect(parseBackup("SOLUTION", JSON.stringify({ baseVersion: "2", fields: {} }))).toBeNull();
    expect(parseBackup("SOLUTION", JSON.stringify({ baseVersion: 2, fields: { diagnosis: "A", x: 1 } }))).toMatchObject({ baseVersion: 2, fields: { diagnosis: "A" } });
    expect(parseBackup("SOLUTION", JSON.stringify({ baseVersion: 2, fields: { diagnosis: "A" }, baseFields: { diagnosis: "B" }, conflicts: ["diagnosis", "x", 3] }))).toMatchObject({
      baseVersion: 2,
      fields: { diagnosis: "A" },
      baseFields: { diagnosis: "B" },
      conflicts: ["diagnosis"],
    });
  });
});

describe("results of the game functions", () => {
  test("a draft row (save_draft's result, or a row read through RLS)", () => {
    expect(toSnapshot({ version: 3, content: { diagnosis: "A" }, updated_at: "t", id: "x" })).toEqual({ version: 3, content: { diagnosis: "A" }, updatedAt: "t" });
    expect(toSnapshot({ version: 0, content: null, updated_at: null })).toEqual({ version: 0, content: {}, updatedAt: null });
    expect(toSnapshot({ version: "3" })).toBeNull();
    expect(toSnapshot(undefined)).toBeNull();
  });
});
