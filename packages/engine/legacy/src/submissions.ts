// Submission templates (guide Appendix B), the text the judge reads, and word limits.
// The database stores the same text (app.submission_text) and counts words the same way (app.word_count).

import { RULES } from "./rules";
import type { SubmissionType } from "./types";

export interface TemplateField {
  key: string;
  label: string;
}

export const TEMPLATES: Record<SubmissionType, readonly TemplateField[]> = {
  PITCH: [
    { key: "problem", label: "The problem" },
    { key: "solution", label: "The solution" },
    { key: "customers", label: "Customers" },
    { key: "business_model", label: "How we make money" },
    { key: "advantage", label: "Our advantage" },
    { key: "use_of_seed", label: "Use of seed money" },
  ],
  PLAN: [
    { key: "crisis", label: "The crisis" },
    { key: "new_plan", label: "The new plan" },
    { key: "money", label: "The money" },
    { key: "deal", label: "The rescue deal" },
    { key: "time_to_recovery", label: "Time to recovery" },
    { key: "risks", label: "Risks" },
    { key: "next_steps", label: "Next three steps" },
  ],
  FLASH: [{ key: "answer", label: "Our answer" }],
};

/** 3–4 capital letters (the brief says 4; its acceptance tests use AQS — see PLAN.md Q2). */
export const TICKER_RE = /^[A-Z]{3,4}$/;

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

/** Words counted against the limit: the template sections only (not the company name or ticker). */
export function submissionWords(type: SubmissionType, content: Content): number {
  return TEMPLATES[type].reduce((n, f) => n + wordCount(field(content, f.key)), 0);
}

/** The text stored with the submission and given to the judge (after anonymising and stripping). */
export function submissionText(type: SubmissionType, content: Content): string {
  const sections = TEMPLATES[type]
    .map((f) => ({ label: f.label, text: field(content, f.key) }))
    .filter((s) => s.text !== "")
    .map((s) => `${s.label}:\n${s.text}`);
  if (type === "PITCH") {
    const head = `${field(content, "company_name")} (${field(content, "ticker").toUpperCase()})`;
    return [head, ...sections].join("\n\n");
  }
  return sections.join("\n\n");
}

export type SubmissionRejection = "EMPTY" | "TOO_LONG" | "MISSING_NAME" | "BAD_TICKER";

export type SubmissionCheck =
  | { ok: true; words: number; text: string }
  | { ok: false; code: SubmissionRejection; words: number; message: string };

export function validateSubmission(type: SubmissionType, content: Content): SubmissionCheck {
  const words = submissionWords(type, content);
  const limit = RULES.WORD_LIMIT[type];
  if (words === 0) return { ok: false, code: "EMPTY", words, message: "Write something before submitting." };
  if (words > limit) return { ok: false, code: "TOO_LONG", words, message: `At most ${limit} words (you have ${words}).` };
  if (type === "PITCH") {
    const name = field(content, "company_name");
    if (name.length < 1 || name.length > 60) {
      return { ok: false, code: "MISSING_NAME", words, message: "Enter the company name (up to 60 characters)." };
    }
    if (!TICKER_RE.test(field(content, "ticker").toUpperCase())) {
      return { ok: false, code: "BAD_TICKER", words, message: "The ticker is 3 or 4 letters, e.g. AQS." };
    }
  }
  return { ok: true, words, text: submissionText(type, content) };
}
