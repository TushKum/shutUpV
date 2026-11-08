// Bulletins in the control panel: the composer's kinds and checks (the twist has its own path: written under Content,
// published at 22:15; the crisis bulletin comes from the game), the list order, the state of the twist and the Q&A
// board for moderation. Pure.

import { phaseReached, type PhaseCode } from "@msim/engine";
import type { Parsed } from "./content";

export type BulletinKind = "GENERAL" | "TWIST" | "CRISIS" | "RUMOUR" | "FAIRNESS" | "SYSTEM";

export const BULLETIN_KIND_LABELS: Record<BulletinKind, string> = {
  GENERAL: "General",
  TWIST: "Twist",
  CRISIS: "Crisis",
  RUMOUR: "Rumour",
  FAIRNESS: "Fairness",
  SYSTEM: "System",
};

/** What the composer can publish (publish_bulletin refuses the others). */
export const COMPOSER_KINDS = ["GENERAL", "RUMOUR", "FAIRNESS"] as const satisfies readonly BulletinKind[];
export type ComposerKind = (typeof COMPOSER_KINDS)[number];

export const TITLE_MAX = 140;
export const BODY_MAX = 4000;

export const RUMOUR_TOO_EARLY = "Rumours start during Round 2 (the rescue).";

export function bulletinFromForm(
  input: { kind: unknown; title: unknown; body: unknown },
  phase?: PhaseCode,
): Parsed<{ kind: ComposerKind; title: string; body: string }> {
  const kind = typeof input.kind === "string" ? input.kind : "";
  if (kind === "TWIST") return { ok: false, message: "Write the twist under Content; it goes out at the twist time set on Event timing." };
  if (!(COMPOSER_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, message: `Choose a kind: ${COMPOSER_KINDS.map((k) => BULLETIN_KIND_LABELS[k]).join(", ")}.` };
  }
  if (kind === "RUMOUR" && phase && !phaseReached(phase, "RESCUE")) return { ok: false, message: RUMOUR_TOO_EARLY };
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.replace(/\r\n/g, "\n").trim() : "";
  if (!title) return { ok: false, message: "A bulletin needs a title." };
  if ([...title].length > TITLE_MAX) return { ok: false, message: `The title is at most ${TITLE_MAX} characters.` };
  if ([...body].length > BODY_MAX) return { ok: false, message: `The body is at most ${BODY_MAX.toLocaleString("en-US")} characters.` };
  return { ok: true, value: { kind: kind as ComposerKind, title, body } };
}

export interface BulletinRow {
  id: string;
  kind: BulletinKind;
  title: string;
  body: string;
  published_at: string | null;
  created_at: string;
}

/** Newest first: a published bulletin by its publication time, a draft by when it was written. */
export function sortBulletins<T extends BulletinRow>(rows: readonly T[]): T[] {
  const at = (b: BulletinRow) => new Date(b.published_at ?? b.created_at).getTime();
  return [...rows].sort((a, b) => at(b) - at(a) || (a.id < b.id ? 1 : -1));
}

export interface TwistState {
  bulletin: BulletinRow | null;
  published: boolean;
  /** Why the organiser cannot publish it now (null: the button is live). */
  blocked: string | null;
}

/** The twist: one per event, written before the night, published once (at 22:15 by the clock, or by hand). */
export function twistState(rows: readonly BulletinRow[], drawn: boolean): TwistState {
  const twist = rows.find((b) => b.kind === "TWIST") ?? null;
  if (!twist) return { bulletin: null, published: false, blocked: "No twist has been written: write it under Content." };
  if (twist.published_at) return { bulletin: twist, published: true, blocked: "The twist has already been published." };
  if (!drawn) return { bulletin: twist, published: false, blocked: "The twist is published after the problem cards are dealt." };
  return { bulletin: twist, published: false, blocked: null };
}

// ───────────────────────────── Q&A board ─────────────────────────────

export interface QuestionRow {
  id: string;
  company_id: string;
  asker_team_id: string;
  body: string;
  hidden: boolean;
  created_at: string;
}

export interface AnswerRow {
  id: string;
  question_id: string;
  body: string;
  created_at: string;
}

export interface QaThread {
  id: string;
  ticker: string;
  asker: string;
  founder: string;
  body: string;
  hidden: boolean;
  createdAt: string;
  answers: { id: string; body: string; createdAt: string }[];
}

/** Every question, newest first, with its answers (oldest first), the company's ticker and both team codes. */
export function qaThreads(
  questions: readonly QuestionRow[],
  answers: readonly AnswerRow[],
  companies: readonly { id: string; ticker: string | null; founder_team_id: string }[],
  teams: readonly { id: string; code: string }[],
): QaThread[] {
  const code = new Map(teams.map((t) => [t.id, t.code]));
  const company = new Map(companies.map((c) => [c.id, c]));
  const byQuestion = new Map<string, AnswerRow[]>();
  for (const a of answers) byQuestion.set(a.question_id, [...(byQuestion.get(a.question_id) ?? []), a]);
  return [...questions]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || (a.id < b.id ? 1 : -1))
    .map((q) => {
      const c = company.get(q.company_id);
      return {
        id: q.id,
        ticker: c?.ticker ?? "—",
        asker: code.get(q.asker_team_id) ?? "—",
        founder: c ? (code.get(c.founder_team_id) ?? "—") : "—",
        body: q.body,
        hidden: q.hidden,
        createdAt: q.created_at,
        answers: (byQuestion.get(q.id) ?? [])
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((a) => ({ id: a.id, body: a.body, createdAt: a.created_at })),
      };
    });
}
