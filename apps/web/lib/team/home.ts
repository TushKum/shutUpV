// Home: what this team should do now, where the night is and what comes next. Every team plays the same night: write
// a PRD (21:15–23:00), ask the founders of the company it rescues and answer questions about its own (23:45–00:15),
// write a crisis solution (23:45–01:45) and trade (02:15–04:30). Pure: the page and the layout read the rows
// (home-data.ts) and this decides. The windows mirror the game functions (save_draft, post_question,
// answer_question, place_order), but they are guidance only: the database decides every action again.

import { DEADLINE_LABELS, PHASE_LABELS, type DeadlineCode, type PhaseCode } from "@msim/engine";
import { clock, count } from "@/lib/format";
import { askState, answerState, type BoardFacts } from "./qa";
import { deadlinePassed } from "./time";
import { writingOpen, type WritingFacts } from "./writing";

export interface HomeProgress {
  /** Saved versions of the team's drafts (0: nothing saved yet). */
  prdVersion: number;
  solutionVersion: number;
  /** Questions this team asked about the company it rescues. */
  asked: number;
  /** Questions about the company it built that have no answer yet. */
  unanswered: number;
  /** Its pending orders in the open round. */
  pendingOrders: number;
}

export interface HomeFacts {
  phase: PhaseCode;
  paused: boolean;
  pausedAt: string | null;
  /** The server's clock, in ms. */
  nowMs: number;
  drawnAt: string | null;
  prdsLockedAt: string | null;
  pricesStartedAt: string | null;
  crisisAppliedAt: string | null;
  solutionsLockedAt: string | null;
  scoresRevealedAt: string | null;
  marketClosedAt: string | null;
  leaderboardFrozen: boolean;
  deadlines: Partial<Record<DeadlineCode, string>>;
  /** Planned start of each phase. */
  phaseStarts: Partial<Record<PhaseCode, string>>;
  openRound: { number: number; closes_at: string } | null;
  nextRound: { number: number; opens_at: string } | null;
  builtTicker: string | null;
  rescuedTicker: string | null;
  progress: HomeProgress;
}

/** todo: this team has something to do; done: it has done it (the window is still open); info: nothing to press. */
export type TaskState = "todo" | "done" | "info";

export interface HomeTask {
  key: string;
  title: string;
  detail: string;
  /** The section that does it (null: nothing to open). */
  href: string | null;
  linkLabel: string | null;
  /** When it closes (ISO), and what closes then. */
  due: string | null;
  dueLabel: string | null;
  state: TaskState;
}

export interface UpcomingItem {
  key: string;
  title: string;
  at: string;
  href: string | null;
}

export interface HomePlan {
  /** What to do now (open windows), in the order they close. */
  now: HomeTask[];
  /** The next moments of the night that are still ahead, soonest first. */
  next: UpcomingItem[];
  /** A sentence for when there is nothing to do now. */
  idle: string;
}

const BUILD = "/team/build";
const RESCUE = "/team/rescue";
const QA = "/team/qa";
const TRADE = "/team/trade";
const BOARD = "/team/leaderboard";

const writing = (f: HomeFacts, lock: DeadlineCode): WritingFacts => ({
  phase: f.phase,
  paused: f.paused,
  pausedAt: f.pausedAt,
  nowMs: f.nowMs,
  drawnAt: f.drawnAt,
  prdsLockedAt: f.prdsLockedAt,
  crisisAppliedAt: f.crisisAppliedAt,
  solutionsLockedAt: f.solutionsLockedAt,
  lock: f.deadlines[lock] ?? null,
});

const board = (f: HomeFacts): BoardFacts => ({
  phase: f.phase,
  paused: f.paused,
  pausedAt: f.pausedAt,
  nowMs: f.nowMs,
  crisisApplied: f.crisisAppliedAt !== null,
  qaClose: f.deadlines.QA_CLOSE ?? null,
  solutionLock: f.deadlines.SOLUTION_LOCK ?? null,
});

const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

/** The open windows of this team, soonest to close first. */
export function nowTasks(f: HomeFacts): HomeTask[] {
  const out: HomeTask[] = [];
  const p = f.progress;
  if (writingOpen("PRD", writing(f, "PRD_LOCK"))) {
    out.push({
      key: "PRD",
      title: f.builtTicker ? `Write your PRD for ${f.builtTicker}` : "Write your PRD",
      detail:
        p.prdVersion > 0
          ? "Saved as you type. Keep improving it: the version saved before the lock is the one judged (there is no submit button)."
          : "Read your problem card and start writing: nine parts, at most 800 words; it saves as you type.",
      href: BUILD,
      linkLabel: "Open the PRD",
      due: f.deadlines.PRD_LOCK ?? null,
      dueLabel: "locks",
      state: "todo",
    });
  }
  const b = board(f);
  if (f.rescuedTicker && askState(b) === "OPEN") {
    out.push({
      key: "ASK",
      title: p.asked > 0 ? `You asked ${f.rescuedTicker}'s founders ${plural(p.asked, "question")}` : `Ask ${f.rescuedTicker}'s founders about their company`,
      detail: "Questions are at most 300 characters. Every question and answer is public.",
      href: QA,
      linkLabel: p.asked > 0 ? "Ask another" : "Ask a question",
      due: f.deadlines.QA_CLOSE ?? null,
      dueLabel: "closes",
      state: p.asked > 0 ? "done" : "todo",
    });
  }
  if (p.unanswered > 0 && answerState(b) === "OPEN") {
    out.push({
      key: "ANSWER",
      title: `Answer ${plural(p.unanswered, "question")} about ${f.builtTicker ?? "your company"}`,
      detail: "The team rescuing your company is asking. Answers are at most 150 words.",
      href: QA,
      linkLabel: "Answer",
      due: f.deadlines.SOLUTION_LOCK ?? null,
      dueLabel: "closes",
      state: "todo",
    });
  }
  if (writingOpen("SOLUTION", writing(f, "SOLUTION_LOCK"))) {
    out.push({
      key: "SOLUTION",
      title: f.rescuedTicker ? `Write the crisis solution for ${f.rescuedTicker}` : "Write your crisis solution",
      detail:
        p.solutionVersion > 0
          ? "Saved as you type. The version saved before the lock is the one judged."
          : "Read its PRD and crisis card, then write: six parts, at most 500 words; it saves as you type.",
      href: RESCUE,
      linkLabel: "Open the solution",
      due: f.deadlines.SOLUTION_LOCK ?? null,
      dueLabel: "locks",
      state: "todo",
    });
  }
  if (f.openRound && !f.paused && !deadlinePassed(f.openRound.closes_at, f.nowMs)) {
    out.push({
      key: "TRADE",
      title: `Round ${f.openRound.number} is open: place your orders`,
      detail:
        p.pendingOrders > 0
          ? `You have ${plural(p.pendingOrders, "order")} in this round; you can edit or cancel until it closes. Every order fills at the round's clearing price.`
          : "Buy or sell any company except the one you built and the one you rescued. Every order fills at the round's clearing price.",
      href: TRADE,
      linkLabel: "Trade",
      due: f.openRound.closes_at,
      dueLabel: "closes",
      state: p.pendingOrders > 0 ? "done" : "todo",
    });
  }
  const t = (x: HomeTask) => (x.due ? new Date(x.due).getTime() : Number.POSITIVE_INFINITY);
  return out.sort((a, b2) => t(a) - t(b2));
}

/** The moments still ahead tonight: deadlines, reveals and the openings, soonest first (at most `limit`). */
export function upcoming(f: HomeFacts, open: readonly HomeTask[], limit = 5): UpcomingItem[] {
  const shown = new Set(open.map((t) => t.due));
  const items: (UpcomingItem | null)[] = [
    at(f.deadlines.PROBLEM_DRAW, "PROBLEM_DRAW", "Problem cards dealt", BUILD),
    at(f.deadlines.TWIST, "TWIST", "The twist", BUILD),
    at(f.deadlines.PRD_LOCK, "PRD_LOCK", DEADLINE_LABELS.PRD_LOCK, BUILD),
    at(f.phaseStarts.REVEAL_1, "REVEAL_1", "PRD scores and starting prices", BUILD),
    at(f.phaseStarts.CRISIS_QA, "CRISIS_QA", "The crisis: the company you rescue", RESCUE),
    at(f.deadlines.QA_CLOSE, "QA_CLOSE", DEADLINE_LABELS.QA_CLOSE, QA),
    at(f.deadlines.SOLUTION_LOCK, "SOLUTION_LOCK", DEADLINE_LABELS.SOLUTION_LOCK, RESCUE),
    f.nextRound ? at(f.nextRound.opens_at, `ROUND_${f.nextRound.number}`, `Trading round ${f.nextRound.number} opens`, TRADE) : null,
    at(f.phaseStarts.MARKET, "MARKET", "Crisis-solution scores revealed", RESCUE),
    at(f.deadlines.LEADERBOARD_FREEZE, "LEADERBOARD_FREEZE", DEADLINE_LABELS.LEADERBOARD_FREEZE, BOARD),
    at(f.deadlines.MARKET_CLOSE, "MARKET_CLOSE", DEADLINE_LABELS.MARKET_CLOSE, "/team/trade/positions"),
    at(f.phaseStarts.AWARDS, "AWARDS", "The awards", BOARD),
  ];
  return items
    .filter((x): x is UpcomingItem => x !== null && !shown.has(x.at) && !deadlinePassed(x.at, f.nowMs, f))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(0, limit);
}

function at(when: string | undefined | null, key: string, title: string, href: string | null): UpcomingItem | null {
  return when ? { key, title, at: when, href } : null;
}

/** What to say when there is nothing to do now. */
export function idleText(f: HomeFacts): string {
  if (f.paused) return "The event is paused. Deadlines move later by the length of the pause.";
  const when = (iso: string | null | undefined, fallback: string) => (iso ? clock(iso) : fallback);
  switch (f.phase) {
    case "SETUP":
    case "CHECKIN":
      return "Check in with the organisers and sign in on every laptop and phone your team will use.";
    case "BRIEFING":
      return `The briefing is on. The problem cards are dealt at ${when(f.deadlines.PROBLEM_DRAW, "21:15")}.`;
    case "BUILD":
    case "JUDGING_1":
      return `Your PRD is locked and with the judges. Scores and starting prices at ${when(f.phaseStarts.REVEAL_1, "23:30")}.`;
    case "REVEAL_1":
      return `PRD scores are out: see Round 1. The crisis hits at ${when(f.phaseStarts.CRISIS_QA, "23:45")}.`;
    case "CRISIS_QA":
    case "RESCUE":
    case "JUDGING_2":
      return `Your crisis solution is locked and with the judges. Trading starts at ${when(f.phaseStarts.MARKET_BLIND, "02:15")}.`;
    case "MARKET_BLIND":
    case "MARKET":
      if (f.marketClosedAt) return "The market is closed. Results at the awards.";
      return f.nextRound ? `Between rounds: round ${f.nextRound.number} opens at ${clock(f.nextRound.opens_at)}.` : "Trading is closed between rounds.";
    case "SETTLEMENT":
      return `The market is closed and the results are being checked. The awards start at ${when(f.phaseStarts.AWARDS, "05:15")}.`;
    case "AWARDS":
      return "The results are out: see the leaderboard.";
    default:
      return `${PHASE_LABELS[f.phase]}.`;
  }
}

export function homePlan(f: HomeFacts): HomePlan {
  const now = nowTasks(f);
  return { now, next: upcoming(f, now), idle: idleText(f) };
}
