// The Q&A board (23:45–00:15): the team rescuing a company asks that company's founding team, and the founders answer.
// Every question and answer is public. Questions are up to 300 characters and close at 00:15; answers are up to 150
// words and may be written until the solution lock (01:45), so a question asked at 00:14 can still be answered. These
// checks are guidance for the forms; the database checks again. Pure.

import { RULES, wordCount, type PhaseCode } from "@msim/engine";
import { count } from "@/lib/format";
import { deadlinePassed } from "./time";

export const QUESTION_MAX_CHARS = RULES.QA_QUESTION_CHARS;
export const ANSWER_MAX_WORDS = RULES.QA_ANSWER_WORDS;
export const ANSWER_MAX_CHARS = RULES.QA_ANSWER_CHARS;
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

export type WindowState = "NOT_YET" | "OPEN" | "CLOSED";

export interface BoardFacts {
  phase: PhaseCode;
  paused: boolean;
  pausedAt: string | null;
  nowMs: number;
  crisisApplied: boolean;
  qaClose: string | null;
  solutionLock: string | null;
}

/** Asking: in Crisis & Q&A, until 00:15 (as post_question decides). */
export function askState(f: BoardFacts): WindowState {
  if (!f.crisisApplied) return "NOT_YET";
  if (f.phase !== "CRISIS_QA" || f.paused || deadlinePassed(f.qaClose, f.nowMs)) return "CLOSED";
  return "OPEN";
}

/** Answering: in Crisis & Q&A or Rescue, until 01:45 (as answer_question decides). */
export function answerState(f: BoardFacts): WindowState {
  if (!f.crisisApplied) return "NOT_YET";
  if ((f.phase !== "CRISIS_QA" && f.phase !== "RESCUE") || f.paused || deadlinePassed(f.solutionLock, f.nowMs)) return "CLOSED";
  return "OPEN";
}

export interface QuestionRow {
  id: string;
  company_id: string;
  asker_team_id: string;
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
  return { company: /^[A-Z]{4}$/.test(company) ? company : null, page: n >= 1 ? n : 1 };
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
