// Submission templates, the text the judge reads, and word limits.
// The database stores the same text (app.submission_text) and counts words the same way (app.word_count).

import { RULES } from "./rules";
import type { SubmissionType } from "./types";

export interface TemplateField {
  key: string;
  label: string;
}

export const TEMPLATES: Record<SubmissionType, readonly TemplateField[]> = {
  PRD: [
    { key: "problem", label: "Problem" },
    { key: "target_user", label: "Target user" },
    { key: "must_have", label: "Must have" },
    { key: "should_have", label: "Should have" },
    { key: "not_in_v1", label: "Not in version 1" },
    { key: "per_pack_maths", label: "Per-pack maths" },
    { key: "go_to_market", label: "Go to market" },
    { key: "success_metrics", label: "Success metrics" },
    { key: "risks", label: "Risks" },
  ],
  SOLUTION: [
    { key: "diagnosis", label: "Diagnosis" },
    { key: "three_options", label: "Three options" },
    { key: "recommendation", label: "Recommendation" },
    { key: "per_pack_maths", label: "Per-pack maths" },
    { key: "timeline", label: "Timeline" },
    { key: "risks", label: "Risks" },
  ],
};

/** Exactly four capital letters, unique per event (claimed by the first team to save it). */
export const TICKER_RE = /^[A-Z]{4}$/;

export const COMPANY_NAME_MAX = 60;

/**
 * A word is a token between ASCII whitespace with at least one character that is not punctuation:
 * "—" or "..." alone are not words. SQL (app.word_count) uses the same explicit sets so counts always agree.
 */
const WHITESPACE = /[ \t\n\r\f\v]+/;
const NOT_PUNCTUATION = /[^ \t\n\r\f\v!-/:-@[-`{-~\u00A0-\u00BF\u00D7\u00F7\u2010-\u2027]/u;

export function trimAscii(text: string): string {
  return text.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, "");
}

/**
 * Invisible format characters (soft hyphen, zero-width spaces and joiners, direction marks, BOM) count as
 * spaces, so words glued together with them are still counted one by one.
 */
export const FORMAT_CHARS = /[\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF]/g;

export function wordCount(text: string): number {
  return trimAscii(text.replace(FORMAT_CHARS, " "))
    .split(WHITESPACE)
    .filter((w) => w !== "" && NOT_PUNCTUATION.test(w)).length;
}

type Content = Readonly<Record<string, unknown>>;

const field = (content: Content, key: string): string => {
  const v = content[key];
  return typeof v === "string" ? trimAscii(v) : "";
};

/** Words counted against the limit: the template parts only (not the company name or ticker). */
export function submissionWords(type: SubmissionType, content: Content): number {
  return TEMPLATES[type].reduce((n, f) => n + wordCount(field(content, f.key)), 0);
}

/** The text stored with the submission and given to the judge (after anonymising and stripping). */
export function submissionText(type: SubmissionType, content: Content): string {
  const sections = TEMPLATES[type]
    .map((f) => ({ label: f.label, text: field(content, f.key) }))
    .filter((s) => s.text !== "")
    .map((s) => `${s.label}:\n${s.text}`);
  if (type === "PRD") {
    const head = `${field(content, "company_name")} (${field(content, "ticker").toUpperCase()})`;
    return [head, ...sections].join("\n\n");
  }
  return sections.join("\n\n");
}

export type SubmissionRejection = "TOO_LONG" | "BAD_NAME" | "BAD_TICKER";

export type DraftCheck =
  | { ok: true; words: number }
  | { ok: false; code: SubmissionRejection; words: number; message: string };

/**
 * Checks a draft at save time. There is no submit button: the last version saved before the lock is judged, so an
 * empty or half-filled draft saves fine; only more than the word limit, a name over 60 characters or a ticker that
 * is not four letters is refused. (A draft may leave the name and ticker blank until they are chosen.)
 */
export function validateDraft(type: SubmissionType, content: Content): DraftCheck {
  const words = submissionWords(type, content);
  const limit = RULES.WORD_LIMIT[type];
  if (words > limit) return { ok: false, code: "TOO_LONG", words, message: `At most ${limit} words (you have ${words}).` };
  if (type === "PRD") {
    if (field(content, "company_name").length > COMPANY_NAME_MAX) {
      return { ok: false, code: "BAD_NAME", words, message: `The company name is at most ${COMPANY_NAME_MAX} characters.` };
    }
    const ticker = field(content, "ticker").toUpperCase();
    if (ticker !== "" && !TICKER_RE.test(ticker)) {
      return { ok: false, code: "BAD_TICKER", words, message: "The ticker is exactly four letters, e.g. MLBT." };
    }
  }
  return { ok: true, words };
}

/** A locked draft is judged only if it has at least one word; an empty one counts as no submission (score 0). */
export function isJudgeable(type: SubmissionType, content: Content): boolean {
  return submissionWords(type, content) > 0;
}

/**
 * The lock is exclusive: a save is accepted only strictly before it (22:59:59 yes, 23:00:00 and 23:00:01 no).
 * Times are server times in milliseconds.
 */
export function acceptsSave(savedAt: number, lockAt: number): boolean {
  return savedAt < lockAt;
}

/** The version that is judged: the last one saved before the lock (null when none was). */
export function judgedVersion<T extends { savedAt: number }>(versions: readonly T[], lockAt: number): T | null {
  let best: T | null = null;
  for (const v of versions) if (acceptsSave(v.savedAt, lockAt) && (best === null || v.savedAt >= best.savedAt)) best = v;
  return best;
}
