// The Q&A board: questions per company, each with its answers. Every question and answer is public; who asked is
// never shown (the asker column is not even readable by teams), and an answer is attributed to the company's ticker
// (PLAN decision 20). Finance teams post questions (post_question: 1–1,000 characters, from Reading until the
// close); the Product team answers questions about its own company (answer_question: 1–100 words, until the
// close). These checks are guidance for the forms; the database checks again. Pure.

import { RULES, phaseReached, wordCount, type PhaseCode, type Track } from "@msim/engine";
import { count } from "@/lib/format";

export const QUESTION_MAX_CHARS = 1000;
export const ANSWER_MAX_WORDS = RULES.WORD_LIMIT.QA_ANSWER;
export const ANSWER_MAX_CHARS = 1500;
export const QUESTIONS_PER_PAGE = 25;

/** Characters as the database counts them (code points), after trimming. */
export const chars = (s: string) => [...s.trim()].length;

export type Check = { ok: true } | { ok: false; message: string };

export function questionCheck(body: string): Check & { chars: number } {
  const n = chars(body);
  if (n === 0) return { ok: false, chars: n, message: "Write a question first." };
  if (n > QUESTION_MAX_CHARS) return { ok: false, chars: n, message: `Questions are at most ${count(QUESTION_MAX_CHARS)} characters (this one has ${count(n)}).` };
  return { ok: true, chars: n };
}

export function answerCheck(body: string): Check & { words: number } {
  const words = wordCount(body.trim());
  if (words === 0) return { ok: false, words, message: "Write an answer first." };
  if (words > ANSWER_MAX_WORDS) return { ok: false, words, message: `Answers are at most ${ANSWER_MAX_WORDS} words (this one has ${count(words)}).` };
  if (chars(body) > ANSWER_MAX_CHARS) return { ok: false, words, message: `Answers are at most ${count(ANSWER_MAX_CHARS)} characters.` };
  return { ok: true, words };
}

export type BoardState = "NOT_YET" | "OPEN" | "CLOSED";

/** The board opens with the pitch book (Reading) and closes at the close; answers close then too. */
export function boardState(phase: PhaseCode): BoardState {
  if (!phaseReached(phase, "READING")) return "NOT_YET";
  return phaseReached(phase, "CLOSE") ? "CLOSED" : "OPEN";
}

/** Who may do what on the board, by track (the database decides again). */
export function boardRole(track: Track): "ASK" | "ANSWER" | "READ" {
  return track === "FINANCE" ? "ASK" : track === "PRODUCT" ? "ANSWER" : "READ";
}

export interface QuestionRow {
  id: string;
  company_id: string;
  body: string;
  created_at: string;
}

export interface AnswerRow {
  id: string;
  question_id: string;
  company_id: string;
  body: string;
  word_count: number;
  created_at: string;
}

export interface Thread {
  question: QuestionRow;
  /** Oldest first. */
  answers: AnswerRow[];
}

const time = (s: string) => new Date(s).getTime();

/** Questions in the given order, each with its answers (oldest first). */
export function threads(questions: readonly QuestionRow[], answers: readonly AnswerRow[]): Thread[] {
  const by = new Map<string, AnswerRow[]>();
  for (const a of answers) {
    const list = by.get(a.question_id) ?? [];
    list.push(a);
    by.set(a.question_id, list);
  }
  return questions.map((q) => ({
    question: q,
    answers: (by.get(q.id) ?? []).sort((a, b) => time(a.created_at) - time(b.created_at) || (a.id < b.id ? -1 : 1)),
  }));
}

/** Questions with no answer yet, oldest first (the order to answer them in). */
export function unanswered(questions: readonly QuestionRow[], answers: readonly Pick<AnswerRow, "question_id">[]): QuestionRow[] {
  const answered = new Set(answers.map((a) => a.question_id));
  return questions.filter((q) => !answered.has(q.id)).sort((a, b) => time(a.created_at) - time(b.created_at) || (a.id < b.id ? -1 : 1));
}

// ───────────────────────────── The filter in the address ─────────────────────────────

export interface QaQuery {
  /** A ticker, or null for every company. */
  company: string | null;
  page: number;
}

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

export function parseQaQuery(sp: SearchParams): QaQuery {
  const page = first(sp.page);
  const n = /^\d{1,6}$/.test(page) ? Number(page) : 1;
  const company = first(sp.company).toUpperCase();
  return { company: /^[A-Z]{3,4}$/.test(company) ? company : null, page: n >= 1 ? n : 1 };
}

export function qaHref(base: string, q: QaQuery, patch: Partial<QaQuery> = {}): string {
  const changed = "company" in patch && patch.company !== q.company;
  const next = { ...q, ...patch, page: patch.page ?? (changed ? 1 : q.page) };
  const params = new URLSearchParams();
  if (next.company) params.set("company", next.company);
  if (next.page > 1) params.set("page", String(next.page));
  const s = params.toString();
  return s ? `${base}?${s}` : base;
}
