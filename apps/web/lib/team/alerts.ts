// What the "Do this now" bar shows and when a team is alerted. Pure: the bar and the alerts (app/team/action-bar.tsx,
// app/team/alerts.tsx) only draw these decisions.

import type { HomePlan, HomeTask } from "./home";

/** The one thing to do next: the open task of this team that closes first (the plan lists them in closing order). */
export function nextAction(plan: HomePlan): HomeTask | null {
  return plan.now.find((t) => t.state === "todo" && t.href !== null) ?? null;
}

/** The open tasks with a deadline, which get the 5- and 1-minute alerts. */
export function alertTasks(plan: HomePlan): { key: string; title: string; due: string; href: string | null }[] {
  return plan.now.filter((t) => t.state === "todo" && t.due !== null).map((t) => ({ key: t.key, title: t.title, due: t.due!, href: t.href }));
}

export const ALERT_AT_MS = [5 * 60_000, 60_000] as const;

/**
 * Which warning to give now, if any: the most urgent threshold that the time left has reached and that was not given
 * yet (a screen opened with 50 s left gets the 1-minute warning, not both). The caller marks every reached
 * threshold as given.
 */
export function dueAlert(remainingMs: number, given: ReadonlySet<number>, thresholds: readonly number[] = ALERT_AT_MS): { threshold: number; reached: number[] } | null {
  if (remainingMs <= 0) return null;
  const reached = thresholds.filter((t) => remainingMs <= t);
  if (reached.length === 0) return null;
  const threshold = Math.min(...reached);
  return given.has(threshold) ? null : { threshold, reached };
}

export function leftText(remainingMs: number): string {
  const min = Math.ceil(remainingMs / 60_000);
  // "Under": a screen opened with 1:29 to go gets "Under 2 minutes left", never a "2 minutes" its countdown contradicts.
  return remainingMs <= 60_000 ? "Under a minute left" : `Under ${min} minutes left`;
}

export interface EventToast {
  text: string;
  tone: "info" | "good" | "warn";
  href: string | null;
  /** Worth a sound and a buzz (deadlines and big moments), or only a quiet toast. */
  loud: boolean;
}

/** What a broadcast tells a team, in a few words; null for the ones that need no toast. */
export function eventToast(kind: string, payload: Record<string, unknown>): EventToast | null {
  const round = typeof payload.round === "number" ? `Round ${payload.round}` : "A round";
  switch (kind) {
    case "problem_draw":
      return { text: "The problem cards are dealt: open yours and start your PRD.", tone: "good", href: "/team/build", loud: true };
    case "twist":
      return { text: `The twist: ${typeof payload.title === "string" ? payload.title : "read it now"}. Your PRD must answer it.`, tone: "warn", href: "/team/build", loud: true };
    case "locked":
      return payload.type === "SOLUTION"
        ? { text: "The crisis solution form is locked. Your last saved version is being judged.", tone: "info", href: "/team/rescue", loud: false }
        : { text: "The PRD form is locked. Your last saved version is being judged.", tone: "info", href: "/team/build", loud: false };
    case "prices_started":
      return { text: "PRD scores are out: see your score and your company's starting price.", tone: "good", href: "/team/build", loud: true };
    case "crisis":
      return { text: "Crisis! Every company has a crisis card and every price fell 15%. See which company you rescue.", tone: "warn", href: "/team/rescue", loud: true };
    case "solutions_published":
      return { text: "Every crisis solution is now public.", tone: "info", href: "/team/market/solutions", loud: false };
    case "scores_revealed":
      return { text: "Crisis-solution scores are out: prices have moved.", tone: "good", href: "/team/rescue", loud: true };
    case "round_open":
      return { text: `${round} is open: place your orders.`, tone: "good", href: "/team/trade", loud: false };
    case "round_cleared":
      return { text: `${round} cleared: new prices are in.`, tone: "info", href: "/team/trade/positions", loud: false };
    case "bulletin": {
      const title = typeof payload.title === "string" ? payload.title : "a new bulletin";
      const k = payload.bulletin_kind;
      if (k === "TWIST") return null; // the twist has its own broadcast
      return { text: k === "RUMOUR" ? `Rumour: ${title}` : k === "CRISIS" ? `Crisis news: ${title}` : `News: ${title}`, tone: k === "CRISIS" ? "warn" : "info", href: "/team/bulletins", loud: k === "CRISIS" };
    }
    case "leaderboard_frozen":
      return { text: "The leaderboard is frozen until the awards. Trading carries on until 04:30.", tone: "info", href: null, loud: false };
    case "closing_bell":
      return { text: "The closing bell: the market is closed. Results at the awards.", tone: "info", href: "/team/trade/positions", loud: true };
    case "settled":
      return null;
    case "paused":
      return { text: "The event is paused: the clock is frozen.", tone: "warn", href: null, loud: false };
    case "resumed":
      return { text: "The event has resumed.", tone: "good", href: null, loud: false };
    case "extended": {
      const m = typeof payload.minutes === "number" ? payload.minutes : null;
      return { text: m ? `The organisers added ${m} minutes: deadlines moved later.` : "Deadlines moved later.", tone: "info", href: null, loud: false };
    }
    default:
      return null;
  }
}
