// The draft editor's logic, kept apart from React so it can be tested: the fields of each template, word counts
// (the engine's counting, which is also the database's), what Submit would be refused for, and the editor's state
// when the squad edits the same draft from several screens.
//
// Optimistic concurrency: every save names the version it was based on (save_draft's p_expected_version). A newer
// version saved elsewhere arrives either with a page refresh or as the refusal of a save (VERSION_CONFLICT, with the
// newer draft). If nothing was typed here, the newer version is simply shown; if something was typed, the typed text
// stays and the screen offers to load the other version (the typed text is then set aside, not lost, and can be put
// back) or to keep the typed text (the next save replaces the other version).

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

// ───────────── Editor state ─────────────

export interface Stash {
  fields: Fields;
  /** The version the set-aside text was based on. */
  basedOn: number;
  why: "loaded" | "backup";
}

export type EditorNotice =
  | { kind: "updated"; draft: DraftSnapshot }
  | { kind: "loaded"; draft: DraftSnapshot }
  | { kind: "kept"; draft: DraftSnapshot }
  | { kind: "restored" };

export interface EditorState {
  type: SubmissionType;
  fields: Fields;
  /** The saved version the text on screen is based on: the next save names its version. */
  base: DraftSnapshot;
  /** A newer saved version not shown, because text was typed here meanwhile. */
  theirs: DraftSnapshot | null;
  /** Typed text set aside when the other version was loaded (or found in this device's backup). */
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
  | { type: "conflict"; draft: DraftSnapshot }
  | { type: "failed" }
  | { type: "loadTheirs" }
  | { type: "keepMine" }
  | { type: "restoreStash" }
  | { type: "dropStash" }
  | { type: "dismissNotice" }
  | { type: "backup"; backup: Backup | null; editable: boolean };

export function initEditor(type: SubmissionType, draft: DraftSnapshot): EditorState {
  return { type, fields: fieldsOf(type, draft.content), base: draft, theirs: null, stash: null, notice: null, saving: null, backupChecked: false };
}

/** Text typed here that the base version does not have. */
export function isDirty(s: EditorState): boolean {
  return !sameFields(s.type, s.fields, fieldsOf(s.type, s.base.content));
}

/** A newer saved version arrived (from a refresh or a refused save). */
function newer(s: EditorState, draft: DraftSnapshot, fromConflict: boolean): EditorState {
  if (draft.version <= s.base.version || (s.theirs && draft.version <= s.theirs.version)) return s;
  const theirFields = fieldsOf(s.type, draft.content);
  // Our own save coming back with the refresh, or the same text saved elsewhere: nothing to resolve.
  if ((s.saving && sameFields(s.type, s.saving, theirFields)) || sameFields(s.type, s.fields, theirFields)) {
    return { ...s, base: draft, theirs: null };
  }
  if (!isDirty(s) && !fromConflict) {
    return { ...s, fields: theirFields, base: draft, theirs: null, notice: { kind: "updated", draft } };
  }
  return { ...s, theirs: draft };
}

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case "edit":
      return { ...s, fields: { ...s.fields, [a.key]: a.key === "ticker" ? normaliseTicker(a.value) : a.value } };
    case "server":
      return newer(s, a.draft, false);
    case "saving":
      return { ...s, saving: a.fields };
    case "saved": {
      const base = a.draft.version >= s.base.version ? a.draft : s.base;
      return { ...s, base, saving: null, theirs: s.theirs && s.theirs.version > base.version ? s.theirs : null, notice: null };
    }
    case "conflict":
      return newer({ ...s, saving: null }, a.draft, true);
    case "failed":
      return { ...s, saving: null };
    case "loadTheirs": {
      if (!s.theirs) return s;
      const theirFields = fieldsOf(s.type, s.theirs.content);
      const keep = !sameFields(s.type, s.fields, theirFields) && !sameFields(s.type, s.fields, fieldsOf(s.type, s.base.content));
      return {
        ...s,
        fields: theirFields,
        base: s.theirs,
        theirs: null,
        stash: keep ? { fields: s.fields, basedOn: s.base.version, why: "loaded" } : s.stash,
        notice: { kind: "loaded", draft: s.theirs },
      };
    }
    case "keepMine":
      return s.theirs ? { ...s, base: s.theirs, theirs: null, notice: { kind: "kept", draft: s.theirs } } : s;
    case "restoreStash":
      return s.stash ? { ...s, fields: { ...s.stash.fields }, stash: null, notice: null } : s;
    case "dropStash":
      return { ...s, stash: null };
    case "dismissNotice":
      return { ...s, notice: null };
    case "backup": {
      if (s.backupChecked) return s;
      const done = { ...s, backupChecked: true };
      const b = a.backup;
      if (!b || !a.editable || sameFields(s.type, b.fields, s.fields)) return done;
      if (b.baseVersion === s.base.version) return { ...done, fields: { ...s.fields, ...b.fields }, notice: { kind: "restored" } };
      return { ...done, stash: { fields: { ...s.fields, ...b.fields }, basedOn: b.baseVersion, why: "backup" } };
    }
  }
}

/**
 * What a save or submit result does to the editor. A refusal for a newer version offers that version. Any other
 * result that carries a draft carries one this screen saved (Submit saves first; submit_submission may still refuse,
 * e.g. TICKER_TAKEN), so it becomes the base: a refresh bringing it back is then not mistaken for another save.
 */
export function afterResult(r: { code?: string; draft?: DraftSnapshot }): EditorAction {
  if (r.code === "VERSION_CONFLICT" && r.draft) return { type: "conflict", draft: r.draft };
  if (r.draft) return { type: "saved", draft: r.draft };
  return { type: "failed" };
}

/**
 * What a closed editor (deadline passed, or this team does not write it) shows: the latest saved version, and the
 * text typed here that was never saved (null when there is none), so it is not mistaken for the saved draft.
 */
export function closedView(s: EditorState): { shown: DraftSnapshot; fields: Fields; unsaved: Fields | null } {
  const shown = s.theirs ?? s.base;
  const fields = fieldsOf(s.type, shown.content);
  return { shown, fields, unsaved: isDirty(s) && !sameFields(s.type, s.fields, fields) ? s.fields : null };
}

// ───────────── This device's backup of unsaved text ─────────────

/** Unsaved text kept in this browser tab (sessionStorage), so a reload or a phone that drops the tab loses nothing. */
export interface Backup {
  baseVersion: number;
  fields: Fields;
}

export function backupKey(squadId: string, teamId: string, type: SubmissionType): string {
  return `msim:draft:${squadId}:${teamId}:${type}`;
}

/** What to keep in the backup: the unsaved text and its base version, or null when there is nothing unsaved. */
export function backupOf(s: EditorState): Backup | null {
  return isDirty(s) ? { baseVersion: s.base.version, fields: draftPayload(s.type, s.fields) } : null;
}

export function parseBackup(type: SubmissionType, raw: string | null): Backup | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return null;
    const { baseVersion, fields } = v as { baseVersion?: unknown; fields?: unknown };
    if (!Number.isSafeInteger(baseVersion) || !fields || typeof fields !== "object") return null;
    return { baseVersion: baseVersion as number, fields: fieldsOf(type, fields as Record<string, unknown>) };
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
