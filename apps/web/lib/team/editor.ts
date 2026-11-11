// The draft editor's logic, kept apart from React so it can be tested: the fields of each template, word counts
// (the engine's counting, which is also the database's), what Submit would be refused for, and the editor's state
// when the squad edits the same draft from several screens.
//
// Optimistic concurrency: every save names the version it was based on (save_draft's p_expected_version). A newer
// version saved elsewhere arrives either with a page refresh or as the refusal of a save or submit (VERSION_CONFLICT,
// with the newer draft). If nothing was typed here, the newer version is simply shown (also after a refused submit:
// sending the old text again would overwrite the newer one). If something was typed, the two are merged section by
// section from the version the typed text was based on: the other screen's changes to sections not typed in here
// are taken at once, the typed text stays, and only a section changed differently on both sides waits for a choice
// (keep the typed text, so the next save replaces theirs there, or use theirs, setting the typed text aside).

import { RULES, TEMPLATES, submissionWords, validateSubmission, wordCount, type SubmissionType } from "@msim/engine";

export type Fields = Record<string, string>;

/** A saved version of the squad's draft, as the database returned it. */
export interface DraftSnapshot {
  version: number;
  content: Record<string, unknown>;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface FieldSpec {
  key: string;
  label: string;
  /** Counted against the word limit (the company name and ticker are not). */
  counted: boolean;
}

/** The pitch also carries the company name and the ticker claim, which save_draft keeps for a pitch only. */
export function fieldSpecs(type: SubmissionType): FieldSpec[] {
  const head: FieldSpec[] =
    type === "PITCH"
      ? [
          { key: "company_name", label: "Company name", counted: false },
          { key: "ticker", label: "Ticker", counted: false },
        ]
      : [];
  return [...head, ...TEMPLATES[type].map((f) => ({ key: f.key, label: f.label, counted: true }))];
}

/** The editor's fields from stored content: each known field as a string (missing or not a string: empty). */
export function fieldsOf(type: SubmissionType, content: Record<string, unknown> | null | undefined): Fields {
  const out: Fields = {};
  for (const f of fieldSpecs(type)) {
    const v = content?.[f.key];
    out[f.key] = typeof v === "string" ? v : "";
  }
  return out;
}

export function sameFields(type: SubmissionType, a: Fields, b: Fields): boolean {
  return fieldSpecs(type).every((f) => (a[f.key] ?? "") === (b[f.key] ?? ""));
}

/** What is sent to save_draft: exactly the template's fields, as strings. */
export function draftPayload(type: SubmissionType, fields: Fields): Fields {
  return Object.fromEntries(fieldSpecs(type).map((f) => [f.key, typeof fields[f.key] === "string" ? fields[f.key]! : ""]));
}

/** A typed ticker: capital letters only, at most 4 (TICKER_RE is checked again on submit by the database). */
export function normaliseTicker(v: string): string {
  return v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
}

export interface WordStats {
  perField: Record<string, number>;
  total: number;
  limit: number;
  /** Words above the limit (0 when within it). */
  over: number;
}

export function wordStats(type: SubmissionType, fields: Fields): WordStats {
  const perField: Record<string, number> = {};
  for (const f of TEMPLATES[type]) perField[f.key] = wordCount(fields[f.key] ?? "");
  const total = submissionWords(type, fields);
  const limit = RULES.WORD_LIMIT[type];
  return { perField, total, limit, over: Math.max(0, total - limit) };
}

/** Why submit_submission would refuse this text (the engine's checks, the same as SQL), or null. */
export function submitProblem(type: SubmissionType, fields: Fields): { code: string; message: string } | null {
  const check = validateSubmission(type, draftPayload(type, fields));
  return check.ok ? null : { code: check.code, message: check.message };
}

/** save_draft refuses content whose jsonb text is longer than this. */
export const MAX_CONTENT_CHARS = 20_000;

/**
 * An upper bound on the length of the content's jsonb text (`{"k": "v", …}`): JSON.stringify escapes as Postgres
 * does, and counts UTF-16 units where Postgres counts characters, so this is never below the real length.
 */
export function contentChars(payload: Fields): number {
  const entries = Object.entries(payload);
  if (entries.length === 0) return 2;
  return 2 + entries.reduce((n, [k, v]) => n + JSON.stringify(k).length + 2 + JSON.stringify(v).length, 0) + 2 * (entries.length - 1);
}

// ───────────── Merging section by section ─────────────

export interface Merge {
  fields: Fields;
  /** Sections where the saved version's text was taken (nothing was typed in them here). */
  taken: string[];
  /** Sections changed here and, differently, in the saved version: the typed text stays until a choice is made. */
  conflicts: string[];
}

/**
 * A three-way merge, section by section, of the text typed here (`mine`) and a newer saved version (`theirs`), both
 * from the version the typed text was based on (`base`). A section unchanged here takes theirs; a section unchanged
 * there, or changed to the same text on both sides, keeps mine; only a section changed differently on both sides is
 * a conflict (mine stays on screen until a choice is made). `pending` sections were already waiting for a choice
 * against `base`: they still are, unless theirs now matches mine.
 */
export function mergeFields(type: SubmissionType, base: Fields, mine: Fields, theirs: Fields, pending: readonly string[] = []): Merge {
  const out: Merge = { fields: {}, taken: [], conflicts: [] };
  for (const { key } of fieldSpecs(type)) {
    const b = base[key] ?? "";
    const m = mine[key] ?? "";
    const t = theirs[key] ?? "";
    if (m === t) {
      out.fields[key] = m;
    } else if (m === b) {
      out.fields[key] = t;
      out.taken.push(key);
    } else {
      out.fields[key] = m;
      if (t !== b || pending.includes(key)) out.conflicts.push(key);
    }
  }
  return out;
}

/** "The crisis", "The crisis and The money", "The crisis, The money and Risks" (in the template's order). */
export function sectionNames(type: SubmissionType, keys: readonly string[]): string {
  const labels = fieldSpecs(type)
    .filter((f) => keys.includes(f.key))
    .map((f) => f.label);
  return labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

// ───────────── Editor state ─────────────

export interface Stash {
  /** Only the sections set aside: putting them back leaves every other section as it is. */
  fields: Fields;
  /** The version the set-aside text was based on. */
  basedOn: number;
  /** "loaded": the saved version's text was chosen over it; "backup": found in this tab's backup, too old to merge. */
  why: "loaded" | "backup";
}

/** Which action a refusal (VERSION_CONFLICT) answered. */
export type Refused = "save" | "submit";

export type EditorNotice =
  /** Nothing was typed here: the newer version is shown. */
  | { kind: "updated"; draft: DraftSnapshot }
  /** Nothing was typed here and a save or submit was refused for a newer version: that version is shown, not the old one sent. */
  | { kind: "refused"; draft: DraftSnapshot; action: Refused }
  /** A newer version's changes to `keys` were merged into the text typed here. */
  | { kind: "merged"; draft: DraftSnapshot; keys: string[] }
  /** The text typed here was kept in `keys`: the next save replaces the saved version's text there. */
  | { kind: "kept"; draft: DraftSnapshot; keys: string[] }
  /** This tab's unsaved text was put back after a reload; a newer version's changes to `merged` were merged into it. */
  | { kind: "restored"; merged: string[] };

export interface EditorState {
  type: SubmissionType;
  fields: Fields;
  /** The latest saved version seen here: the text on screen is based on it, and the next save names its version. */
  base: DraftSnapshot;
  /**
   * Sections changed here and, differently, in `base` by another save: the text typed here is still on screen and
   * waits for a choice (keep it, so the next save replaces theirs; or use theirs, setting it aside). Save and Submit
   * wait for every choice. Never a section whose text equals the saved one.
   */
  conflicts: string[];
  /** Typed text set aside when the saved version's text was chosen (or found in this device's backup). */
  stash: Stash | null;
  notice: EditorNotice | null;
  /** The text of a save in flight (a refresh may bring that version back before the save's answer does). */
  saving: Fields | null;
  /** This device's backup has been looked at (once, after the first render in the browser). */
  backupChecked: boolean;
}

export type EditorAction =
  | { type: "edit"; key: string; value: string }
  | { type: "server"; draft: DraftSnapshot }
  | { type: "saving"; fields: Fields }
  | { type: "saved"; draft: DraftSnapshot }
  | { type: "conflict"; draft: DraftSnapshot; action: Refused }
  | { type: "failed" }
  /** Keep the typed text in these conflicting sections (all of them when omitted): the next save replaces theirs. */
  | { type: "keepMine"; keys?: string[] }
  /** Use the saved version's text in these conflicting sections (all of them when omitted); the typed text is set aside. */
  | { type: "useTheirs"; keys?: string[] }
  | { type: "restoreStash" }
  | { type: "dropStash" }
  | { type: "dismissNotice" }
  | { type: "backup"; backup: Backup | null; editable: boolean };

export function initEditor(type: SubmissionType, draft: DraftSnapshot): EditorState {
  return { type, fields: fieldsOf(type, draft.content), base: draft, conflicts: [], stash: null, notice: null, saving: null, backupChecked: false };
}

/** Text typed here that the base version does not have. */
export function isDirty(s: EditorState): boolean {
  return !sameFields(s.type, s.fields, fieldsOf(s.type, s.base.content));
}

/** The saved version's text of each conflicting section (what "their text" is). */
export function theirText(s: EditorState, key: string): string {
  return fieldsOf(s.type, s.base.content)[key] ?? "";
}

/** A newer saved version arrived: from a refresh, or as the refusal of this screen's save or submit. */
function newer(s: EditorState, draft: DraftSnapshot, refused: Refused | null): EditorState {
  if (draft.version <= s.base.version) return s;
  const theirs = fieldsOf(s.type, draft.content);
  // Our own save coming back with the refresh (before its answer): its text is the base, and what was typed since stays.
  if (s.saving && s.conflicts.length === 0 && sameFields(s.type, s.saving, theirs)) return { ...s, base: draft };
  // Nothing typed here: the newer version is shown, whatever was refused (sending the old text again would overwrite it).
  if (!isDirty(s)) {
    if (!refused && sameFields(s.type, s.fields, theirs)) return { ...s, base: draft, conflicts: [] };
    return { ...s, fields: theirs, base: draft, conflicts: [], notice: refused ? { kind: "refused", draft, action: refused } : { kind: "updated", draft } };
  }
  // Typed text: merged section by section. Their changes to sections not typed in here are taken at once; only a
  // section changed differently on both sides waits for a choice. The next save names the newer version.
  const m = mergeFields(s.type, fieldsOf(s.type, s.base.content), s.fields, theirs, s.conflicts);
  const notice: EditorNotice | null = m.taken.length > 0 ? { kind: "merged", draft, keys: m.taken } : m.conflicts.length > 0 ? null : s.notice;
  return { ...s, fields: m.fields, base: draft, conflicts: m.conflicts, notice };
}

/** The conflicting sections an action names (all of them when it names none). */
const chosen = (s: EditorState, keys: string[] | undefined) => (keys ? s.conflicts.filter((k) => keys.includes(k)) : s.conflicts);

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case "edit": {
      const value = a.key === "ticker" ? normaliseTicker(a.value) : a.value;
      // A conflicting section typed back to the saved text needs no choice any more.
      const conflicts = s.conflicts.includes(a.key) && value === theirText(s, a.key) ? s.conflicts.filter((k) => k !== a.key) : s.conflicts;
      return { ...s, fields: { ...s.fields, [a.key]: value }, conflicts };
    }
    case "server":
      return newer(s, a.draft, null);
    case "saving":
      return { ...s, saving: a.fields };
    case "saved": {
      // A save answered after a newer version arrived does not move the base back.
      if (a.draft.version < s.base.version) return { ...s, saving: null };
      return { ...s, base: a.draft, saving: null, conflicts: [], notice: null };
    }
    case "conflict":
      return newer({ ...s, saving: null }, a.draft, a.action);
    case "failed":
      return { ...s, saving: null };
    case "keepMine": {
      const keys = chosen(s, a.keys);
      if (keys.length === 0) return s;
      return { ...s, conflicts: s.conflicts.filter((k) => !keys.includes(k)), notice: { kind: "kept", draft: s.base, keys } };
    }
    case "useTheirs": {
      const keys = chosen(s, a.keys);
      if (keys.length === 0) return s;
      const saved = fieldsOf(s.type, s.base.content);
      const aside: Fields = Object.fromEntries(keys.map((k) => [k, s.fields[k] ?? ""]));
      const fields = { ...s.fields, ...Object.fromEntries(keys.map((k) => [k, saved[k] ?? ""])) };
      // Set aside with what was already set aside (a section set aside twice keeps the latest text).
      const stash: Stash = s.stash ? { ...s.stash, fields: { ...s.stash.fields, ...aside } } : { fields: aside, basedOn: s.base.version, why: "loaded" };
      return { ...s, fields, conflicts: s.conflicts.filter((k) => !keys.includes(k)), stash, notice: null };
    }
    case "restoreStash": {
      if (!s.stash) return s;
      const fields = { ...s.fields, ...s.stash.fields };
      const saved = fieldsOf(s.type, s.base.content);
      return { ...s, fields, conflicts: s.conflicts.filter((k) => fields[k] !== saved[k]), stash: null, notice: null };
    }
    case "dropStash":
      return { ...s, stash: null };
    case "dismissNotice":
      return { ...s, notice: null };
    case "backup":
      return s.backupChecked ? s : restoreBackup({ ...s, backupChecked: true }, a.editable ? a.backup : null);
  }
}

/**
 * This tab's unsaved text, found after a reload (the screen shows the saved version, nothing typed yet). Based on
 * the version shown: put back as it was, with its sections still waiting for a choice. Based on an older version
 * whose text it kept: merged with the saved version like any other newer version. Otherwise set aside, to put back
 * by hand.
 */
function restoreBackup(s: EditorState, b: Backup | null): EditorState {
  if (!b || sameFields(s.type, b.fields, s.fields)) return s;
  const saved = fieldsOf(s.type, s.base.content);
  if (b.baseVersion === s.base.version) {
    const fields = { ...s.fields, ...b.fields };
    return { ...s, fields, conflicts: (b.conflicts ?? []).filter((k) => fields[k] !== saved[k]), notice: { kind: "restored", merged: [] } };
  }
  if (b.baseFields && b.baseVersion < s.base.version) {
    const m = mergeFields(s.type, b.baseFields, b.fields, saved, b.conflicts ?? []);
    if (sameFields(s.type, m.fields, saved)) return s;
    return { ...s, fields: m.fields, conflicts: m.conflicts, notice: { kind: "restored", merged: m.taken } };
  }
  const aside = Object.fromEntries(Object.entries(b.fields).filter(([k, v]) => v !== (s.fields[k] ?? "")));
  return { ...s, stash: { fields: aside, basedOn: b.baseVersion, why: "backup" } };
}

/**
 * What a save or submit result does to the editor. A refusal for a newer version brings that version (merged with
 * what was typed here, or shown if nothing was). Any other result that carries a draft carries one this screen
 * saved (Submit saves first; submit_submission may still refuse, e.g. TICKER_TAKEN), so it becomes the base: a
 * refresh bringing it back is then not mistaken for another save.
 */
export function afterResult(r: { code?: string; draft?: DraftSnapshot }, action: Refused = "save"): EditorAction {
  if (r.code === "VERSION_CONFLICT" && r.draft) return { type: "conflict", draft: r.draft, action };
  if (r.draft) return { type: "saved", draft: r.draft };
  return { type: "failed" };
}

/**
 * What a closed editor (deadline passed, or this team does not write it) shows: the latest saved version, and the
 * text typed here that was never saved (null when there is none), so it is not mistaken for the saved draft.
 */
export function closedView(s: EditorState): { shown: DraftSnapshot; fields: Fields; unsaved: Fields | null } {
  return { shown: s.base, fields: fieldsOf(s.type, s.base.content), unsaved: isDirty(s) ? s.fields : null };
}

// ───────────── This device's backup of unsaved text ─────────────

/** Unsaved text kept in this browser tab (sessionStorage), so a reload or a phone that drops the tab loses nothing. */
export interface Backup {
  baseVersion: number;
  fields: Fields;
  /** The text of the base version, so a newer saved version can be merged with it (absent in an older backup). */
  baseFields?: Fields;
  /** Sections still waiting for a choice between the typed text and the base version's. */
  conflicts?: string[];
}

export function backupKey(squadId: string, teamId: string, type: SubmissionType): string {
  return `msim:draft:${squadId}:${teamId}:${type}`;
}

/** What to keep in the backup: the unsaved text and its base, or null when there is nothing unsaved. */
export function backupOf(s: EditorState): Backup | null {
  if (!isDirty(s)) return null;
  return {
    baseVersion: s.base.version,
    fields: draftPayload(s.type, s.fields),
    baseFields: fieldsOf(s.type, s.base.content),
    conflicts: [...s.conflicts],
  };
}

export function parseBackup(type: SubmissionType, raw: string | null): Backup | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return null;
    const { baseVersion, fields, baseFields, conflicts } = v as { baseVersion?: unknown; fields?: unknown; baseFields?: unknown; conflicts?: unknown };
    if (!Number.isSafeInteger(baseVersion) || !fields || typeof fields !== "object") return null;
    const out: Backup = { baseVersion: baseVersion as number, fields: fieldsOf(type, fields as Record<string, unknown>) };
    if (baseFields && typeof baseFields === "object" && !Array.isArray(baseFields)) out.baseFields = fieldsOf(type, baseFields as Record<string, unknown>);
    if (Array.isArray(conflicts)) {
      const known = fieldSpecs(type).map((f) => f.key);
      out.conflicts = conflicts.filter((k): k is string => typeof k === "string" && known.includes(k));
    }
    return out;
  } catch {
    return null;
  }
}

// ───────────── Results of the game functions ─────────────

/** A draft row from a game function's result (save_draft returns it on success and on VERSION_CONFLICT). */
export function toSnapshot(raw: unknown): DraftSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (!Number.isSafeInteger(d.version)) return null;
  return {
    version: d.version as number,
    content: d.content && typeof d.content === "object" && !Array.isArray(d.content) ? (d.content as Record<string, unknown>) : {},
    updatedAt: typeof d.updated_at === "string" ? d.updated_at : null,
    updatedBy: typeof d.updated_by_team === "string" ? d.updated_by_team : null,
  };
}

/** The submission row in submit_submission's result. */
export interface SubmittedRow {
  content: Record<string, unknown>;
  submittedAt: string;
  words: number;
}

export function toSubmitted(raw: unknown): SubmittedRow | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.submitted_at !== "string" || !Number.isSafeInteger(s.word_count)) return null;
  return {
    content: s.content && typeof s.content === "object" ? (s.content as Record<string, unknown>) : {},
    submittedAt: s.submitted_at,
    words: s.word_count as number,
  };
}

/** Rows for a textarea: enough for its text (about 45 characters a line on a phone), between `min` and 16. */
export function rowsFor(text: string, min = 3): number {
  const lines = text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 45)), 0);
  return Math.min(16, Math.max(min, lines + 1));
}
