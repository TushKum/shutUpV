// What the "Do this now" bar shows and when a team is alerted. Pure: the bar and the alerts (app/team/action-bar.tsx,
// app/team/alerts.tsx) only draw these decisions.

import type { Track } from "@msim/engine";
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
  return remainingMs <= 60_000 ? "Under a minute left" : `${min} minutes left`;
}

export interface EventToast {
  text: string;
  tone: "info" | "good" | "warn";
  href: string | null;
  /** Worth a sound and a buzz (deadlines and big moments), or only a quiet toast. */
  loud: boolean;
}

/** What a broadcast tells a team, in a few words; null for the ones that need no toast. */
export function eventToast(kind: string, payload: Record<string, unknown>, track: Track): EventToast | null {
  const round = typeof payload.round === "number" ? `Round ${payload.round}` : "A round";
  switch (kind) {
    case "round_cleared":
      return { text: `${round} cleared: new prices are in.`, tone: "info", href: track === "FINANCE" ? "/team/trade/positions" : "/team/market", loud: false };
    case "round_open":
      return track === "FINANCE" ? { text: `${round} is open: place your orders.`, tone: "good", href: "/team/trade", loud: false } : null;
    case "bulletin": {
      const title = typeof payload.title === "string" ? payload.title : "a new bulletin";
      const flash = payload.bulletin_kind === "FLASH";
      return { text: flash ? `Flash news: ${title}` : `News: ${title}`, tone: flash ? "warn" : "info", href: "/team/bulletins", loud: flash };
    }
    case "crisis":
      return { text: "Crisis! Every company has a crisis card and every price fell 15%.", tone: "warn", href: track === "FINANCE" ? "/team/market" : "/team/rescue", loud: true };
    case "verdicts":
      return { text: "Scores released: prices have moved.", tone: "info", href: "/team/market", loud: true };
    case "ipo_allocated":
      return track === "FINANCE" ? { text: "IPO shares allocated: check your positions.", tone: "good", href: "/team/trade/positions", loud: false } : null;
    case "squad_draw":
      // Finance has no squad workspace: it meets its squad in the chat.
      return { text: "The squads are drawn: meet your squad.", tone: "good", href: track === "FINANCE" ? "/team/chat" : "/team/squad", loud: true };
    case "closing_bell":
      return { text: "The market is closed. Results at the awards.", tone: "info", href: null, loud: true };
    case "paused":
      return { text: "The event is paused: the clock is frozen.", tone: "warn", href: null, loud: false };
    case "resumed":
      return { text: "The event has resumed.", tone: "good", href: null, loud: false };
    default:
      return null;
  }
}
