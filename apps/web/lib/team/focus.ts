// Focus mode: while a round is on, a team sees only that round. The night is split into five stages (before the
// game, the three rounds of the case pack, and the results); each stage shows a friendly name, one line on what is
// happening, and only the sections the team's track needs in it. Everything else stays out of sight until its round.
// Pure: the layout passes the phase and the track.

import type { PhaseCode, Track } from "@msim/engine";
import { TEAM_SECTIONS, type TeamSection } from "./sections";

export type Stage = "BEFORE" | "ROUND_1" | "ROUND_2" | "ROUND_3" | "RESULTS";

const STAGE_OF: Record<PhaseCode, Stage> = {
  SETUP: "BEFORE",
  CHECKIN: "BEFORE",
  BRIEFING: "BEFORE",
  SQUAD_DRAW: "ROUND_1",
  BUILD: "ROUND_1",
  READING: "ROUND_1",
  IPO: "ROUND_1",
  ROUNDS_1_4: "ROUND_1",
  CRISIS: "ROUND_2",
  RESCUE_1: "ROUND_2",
  BREAK: "ROUND_2",
  RESCUE_2: "ROUND_2",
  PLANS_PUBLISHED: "ROUND_3",
  VERDICTS: "ROUND_3",
  ROUNDS_13_21: "ROUND_3",
  CLOSE: "ROUND_3",
  SETTLEMENT: "RESULTS",
  APPEALS: "RESULTS",
  AWARDS: "RESULTS",
};

export const stageOf = (phase: PhaseCode): Stage => STAGE_OF[phase];

export interface StageInfo {
  /** 1–3 for the rounds, null before and after. */
  round: 1 | 2 | 3 | null;
  title: string;
  emoji: string;
  /** Tailwind classes for the banner: background gradient and text. */
  theme: string;
}

export const STAGES: Record<Stage, StageInfo> = {
  BEFORE: { round: null, title: "Get ready", emoji: "👋", theme: "from-slate-700 to-slate-900" },
  ROUND_1: { round: 1, title: "Build & launch", emoji: "🚀", theme: "from-sky-500 to-indigo-600" },
  ROUND_2: { round: 2, title: "Crisis & rescue", emoji: "🚨", theme: "from-orange-500 to-rose-600" },
  ROUND_3: { round: 3, title: "News & the finish", emoji: "📰", theme: "from-violet-500 to-fuchsia-600" },
  RESULTS: { round: null, title: "Results", emoji: "🏆", theme: "from-amber-400 to-orange-500" },
};

/** Each step of the night in plain words: its name and what is happening, for everyone. */
export const STEPS: Record<PhaseCode, { name: string; what: string }> = {
  SETUP: { name: "Getting ready", what: "The game has not started yet. Sit tight!" },
  CHECKIN: { name: "Check in", what: "Make sure your whole team is here and signed in." },
  BRIEFING: { name: "Briefing", what: "Listen to the organisers explain the game." },
  SQUAD_DRAW: { name: "Meet your squad", what: "The lottery puts you in a squad with two other teams." },
  BUILD: { name: "Build your company", what: "Squads read the case and write their pitch." },
  READING: { name: "Read & ask", what: "Everyone reads the pitches and asks the companies questions." },
  IPO: { name: "Buy first shares", what: "Investment funds bid for the companies' first shares." },
  ROUNDS_1_4: { name: "Trading time", what: "Funds buy and sell shares. Prices move every round." },
  CRISIS: { name: "Crisis!", what: "Something bad has happened to every company. Prices fell 15%." },
  RESCUE_1: { name: "Rescue mission", what: "Agree the fee and the rescue deal, and write the rescue plan." },
  BREAK: { name: "Short break", what: "Take a breather. The rescue continues soon." },
  RESCUE_2: { name: "Rescue mission", what: "Finish the rescue deal and the rescue plan before the deadline." },
  PLANS_PUBLISHED: { name: "Read the plans", what: "Every rescue plan is public. Scores come next." },
  VERDICTS: { name: "Judges' verdicts", what: "The judges' scores move every company's price." },
  ROUNDS_13_21: { name: "Breaking news & final trading", what: "Big news arrives. Answer it, then the last trading rounds." },
  CLOSE: { name: "Market closed", what: "Trading is over. The closing prices are being set." },
  SETTLEMENT: { name: "Counting the money", what: "Every team's final value is being worked out." },
  APPEALS: { name: "Last checks", what: "Final checks before the winners are announced." },
  AWARDS: { name: "Awards!", what: "The game is over. Well played!" },
};

/** What a team's own job is in each stage, when it has nothing urgent to press. */
export const JOB: Record<Track, Record<Stage, string>> = {
  PRODUCT: {
    BEFORE: "You are the company. Get ready to build it!",
    ROUND_1: "Write a great pitch for your company, then answer investors' questions.",
    ROUND_2: "Save your company: agree the deal and write the rescue plan with your consultant.",
    ROUND_3: "Answer the breaking news in 100 words or less.",
    RESULTS: "See how much your company is worth.",
  },
  CONSULTING: {
    BEFORE: "You are the advisers. Get ready to help your squad!",
    ROUND_1: "Help your squad's pitch, then call BUY or SELL on the two companies you follow.",
    ROUND_2: "Agree your fee, set the deal price and co-write the rescue plan.",
    ROUND_3: "Make your last BUY or SELL calls.",
    RESULTS: "See how much your team earned.",
  },
  FINANCE: {
    BEFORE: "You are the investors. Get ready to grow $500,000!",
    ROUND_1: "Read the pitches, ask questions, bid in the IPO and trade.",
    ROUND_2: "Invest in your squad's rescue deal and keep trading.",
    ROUND_3: "Trade the news and finish with the most money.",
    RESULTS: "See your fund's final return.",
  },
};

const ROUND_PATHS: Record<Track, Record<Stage, readonly string[]>> = {
  PRODUCT: {
    BEFORE: ["", "/bulletins", "/judging"],
    ROUND_1: ["", "/squad", "/chat", "/qa", "/market", "/bulletins"],
    ROUND_2: ["", "/rescue", "/squad", "/chat", "/qa", "/market", "/bulletins"],
    ROUND_3: ["", "/squad", "/chat", "/qa", "/market", "/bulletins"],
    RESULTS: [],
  },
  CONSULTING: {
    BEFORE: ["", "/bulletins", "/judging"],
    ROUND_1: ["", "/squad", "/calls", "/chat", "/qa", "/market", "/bulletins"],
    ROUND_2: ["", "/rescue", "/squad", "/chat", "/qa", "/market", "/bulletins"],
    ROUND_3: ["", "/squad", "/calls", "/chat", "/qa", "/market", "/bulletins"],
    RESULTS: [],
  },
  FINANCE: {
    BEFORE: ["", "/bulletins", "/judging"],
    ROUND_1: ["", "/trade", "/chat", "/qa", "/market", "/bulletins"],
    ROUND_2: ["", "/rescue", "/trade", "/chat", "/qa", "/market", "/bulletins"],
    ROUND_3: ["", "/trade", "/chat", "/qa", "/market", "/bulletins"],
    RESULTS: [], // every section, for the results
  },
};

/** The section ("/squad", "" for Home) a team path belongs to. */
export function sectionOf(path: string): string {
  const m = /^\/team(\/[^/?#]+)?/.exec(path);
  return m?.[1] ?? "";
}

/**
 * The sections this team sees now, in the track's usual order. A section that the "do this now" task points to is
 * always shown, so a task never leads to a hidden page.
 */
export function focusSections(track: Track, phase: PhaseCode, taskHref: string | null = null): TeamSection[] {
  const stage = stageOf(phase);
  const all = TEAM_SECTIONS[track];
  if (stage === "RESULTS") return [...all];
  const allowed = new Set(ROUND_PATHS[track][stage]);
  if (taskHref) allowed.add(sectionOf(taskHref));
  return all.filter((s) => allowed.has(s.path));
}

/** May this page be shown now? */
export function inFocus(track: Track, phase: PhaseCode, path: string, taskHref: string | null = null): boolean {
  const section = sectionOf(path);
  return focusSections(track, phase, taskHref).some((s) => s.path === section);
}

/** The first stage (from now on) that shows this section, for "this opens in …". */
export function opensIn(track: Track, phase: PhaseCode, path: string): Stage | null {
  const order: Stage[] = ["BEFORE", "ROUND_1", "ROUND_2", "ROUND_3", "RESULTS"];
  const section = sectionOf(path);
  for (const stage of order.slice(order.indexOf(stageOf(phase)) + 1)) {
    if (stage === "RESULTS" || ROUND_PATHS[track][stage].includes(section)) return stage;
  }
  return null;
}

/** Squad workspace tabs per stage: Overview and the case always; then the round's own writing task. */
export function squadTabsFor(phase: PhaseCode): readonly string[] {
  const stage = stageOf(phase);
  const base = ["/team/squad", "/team/squad/problem"];
  if (stage === "ROUND_1") return [...base, "/team/squad/pitch"];
  if (stage === "ROUND_2") return [...base, "/team/squad/plan"];
  if (stage === "ROUND_3") return [...base, "/team/squad/plan", "/team/squad/flash"];
  return [...base, "/team/squad/pitch", "/team/squad/plan", "/team/squad/flash"];
}

/** The submissions (pitch, plan, flash) that belong to this round, for the squad overview. */
export function submissionsFor(phase: PhaseCode): ("PITCH" | "PLAN" | "FLASH")[] {
  const tabs = squadTabsFor(phase);
  return (["PITCH", "PLAN", "FLASH"] as const).filter((t) => tabs.includes(`/team/squad/${t.toLowerCase()}`));
}

/** Icons for the section buttons. */
export const SECTION_ICONS: Record<string, string> = {
  "": "🏠",
  "/squad": "🧩",
  "/rescue": "🛟",
  "/chat": "💬",
  "/calls": "📞",
  "/earnings": "💰",
  "/trade": "📈",
  "/market": "🏪",
  "/qa": "❓",
  "/ledger": "📒",
  "/bulletins": "📣",
  "/judging": "⚖️",
};
