// Home: what this team should do now, for its track and where the night is, what comes next, and its own holdings.
// Pure: the page reads the rows (home-data.ts) and this decides. The windows mirror the game functions' checks
// (pick_problem_card, submission_window, fee_window_open, deal_window_open, make_call, place_ipo_bid), but they are
// guidance only: the database decides every action again when it is sent.

import {
  DEADLINE_LABELS,
  LOT_TYPES,
  phaseIndex,
  phaseReached,
  value,
  type DeadlineCode,
  type LotType,
  type PhaseCode,
  type SubmissionType,
  type Track,
} from "@msim/engine";
import { clock, count } from "@/lib/format";

export interface HomeDeadline {
  code: DeadlineCode;
  at: string;
}

export interface FeeProgress {
  /** Terms have been put forward (by either team). */
  proposed: boolean;
  productConfirmed: boolean;
  consultingConfirmed: boolean;
  executed: boolean;
  isDefault: boolean;
}

export interface DealProgress {
  amountSet: boolean;
  priceSet: boolean;
  signed: Record<Track, boolean>;
  executed: boolean;
}

export interface HomeProgress {
  problemPicked: boolean;
  /** The squad has a current (on-time) submission of this type. */
  submitted: Record<SubmissionType, boolean>;
  fee: FeeProgress | null;
  deal: DealProgress | null;
  /** Consulting: calls made and call slots, per window. */
  calls: Record<1 | 2 | 3, { made: number; total: number }>;
  /** Finance: IPO bids with a quantity. */
  ipoBids: number;
  /** Product: questions to its company with no answer yet. */
  unanswered: number;
}

export interface HomeFacts {
  track: Track;
  phase: PhaseCode;
  paused: boolean;
  pausedAt: string | null;
  /** The server's clock, in ms. */
  nowMs: number;
  drawn: boolean;
  crisisApplied: boolean;
  ipoAllocated: boolean;
  marketClosed: boolean;
  flashBulletinPublished: boolean;
  released: Record<SubmissionType, boolean>;
  deadlines: readonly HomeDeadline[];
  /** Planned start of each phase. */
  phaseStarts: Partial<Record<PhaseCode, string>>;
  openRound: { number: number; closes_at: string } | null;
  nextRound: { number: number; opens_at: string } | null;
  progress: HomeProgress;
}

/** todo: this team has something to do; waiting: it has done its part, a partner has not; done; info: nothing to press. */
export type TaskState = "todo" | "waiting" | "done" | "info";

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
  /** The next deadlines that concern this team and whose windows are not open yet, soonest first. */
  next: UpcomingItem[];
  /** A sentence for when there is nothing to do now. */
  idle: string;
}

const SQUAD = "/team/squad";
const RESCUE = "/team/rescue";
const CALLS = "/team/calls";
const TRADE = "/team/trade";
const QA = "/team/qa";
const BOOK = "/team/market/book";

const between = (p: PhaseCode, from: PhaseCode, to: PhaseCode) => phaseIndex(p) >= phaseIndex(from) && phaseIndex(p) <= phaseIndex(to);

export function deadlineAt(f: Pick<HomeFacts, "deadlines">, code: DeadlineCode): string | null {
  return f.deadlines.find((d) => d.code === code)?.at ?? null;
}

/**
 * Has the deadline passed by the server clock? As app.deadline_passed: a missing deadline has not, and while the
 * event is paused a deadline after the pause began has not (it moves later on resume).
 */
export function deadlinePassed(f: Pick<HomeFacts, "deadlines" | "paused" | "pausedAt" | "nowMs">, code: DeadlineCode): boolean {
  const at = deadlineAt(f, code);
  if (!at) return false;
  const t = new Date(at).getTime();
  if (f.paused && f.pausedAt && t > new Date(f.pausedAt).getTime()) return false;
  return f.nowMs > t;
}

/** Deadlines that concern each track (FLASH_TIER is a price event, not something a team does). */
export const TRACK_DEADLINES: Record<Track, readonly DeadlineCode[]> = {
  PRODUCT: ["PROBLEM_PICK", "PITCH", "FEE", "DEAL", "PLAN", "FLASH_BULLETIN", "FLASH"],
  CONSULTING: ["PROBLEM_PICK", "PITCH", "CALL_1", "FEE", "DEAL_BONUS", "DEAL", "PLAN", "CALL_2", "FLASH_BULLETIN", "FLASH", "CALL_3"],
  FINANCE: ["IPO_BIDS", "DEAL", "FLASH_BULLETIN"],
};

const UPCOMING_TITLES: Record<DeadlineCode, string> = {
  PROBLEM_PICK: "Problem card pick closes",
  PITCH: "Pitch card due",
  CALL_1: "Call 1 due",
  IPO_BIDS: "IPO bids close",
  FEE: "Advisor fee due (otherwise $22,500 cash is paid by default)",
  DEAL_BONUS: "Deal bonus cut-off ($5,000 if fully signed)",
  DEAL: "Rescue deal: last signatures",
  PLAN: "Rescue plan due",
  CALL_2: "Call 2 due",
  FLASH_BULLETIN: "Flash news bulletin",
  FLASH: "Flash answer due",
  FLASH_TIER: "Flash tier applied",
  CALL_3: "Call 3 due",
};

/** Where each deadline is worked on, per track. */
function hrefFor(track: Track, code: DeadlineCode): string | null {
  switch (code) {
    case "PROBLEM_PICK":
    case "PITCH":
    case "PLAN":
    case "FLASH":
      return track === "FINANCE" ? null : SQUAD;
    case "CALL_1":
    case "CALL_2":
    case "CALL_3":
      return track === "CONSULTING" ? CALLS : null;
    case "IPO_BIDS":
      return track === "FINANCE" ? TRADE : null;
    case "FEE":
    case "DEAL_BONUS":
    case "DEAL":
      return RESCUE;
    case "FLASH_BULLETIN":
    case "FLASH_TIER":
      return "/team/bulletins";
  }
}

/** A window that closed before its deadline (an early advance, or the price it is judged at became known). */
function closedEarly(f: HomeFacts, code: DeadlineCode): boolean {
  switch (code) {
    case "PROBLEM_PICK":
    case "FEE":
      return false;
    case "PITCH":
      return phaseIndex(f.phase) > phaseIndex("BUILD");
    case "CALL_1":
      return f.released.PITCH;
    case "IPO_BIDS":
      return phaseIndex(f.phase) > phaseIndex("IPO") || f.ipoAllocated;
    case "DEAL_BONUS":
    case "DEAL":
    case "PLAN":
      return phaseIndex(f.phase) > phaseIndex("RESCUE_2");
    case "CALL_2":
    case "FLASH":
    case "FLASH_TIER":
      return f.released.FLASH;
    case "FLASH_BULLETIN":
      return f.flashBulletinPublished;
    case "CALL_3":
      return f.marketClosed;
  }
}

/** Is the window of this deadline's work open now (as the game function would judge it)? */
export function windowOpen(f: HomeFacts, code: DeadlineCode): boolean {
  const open = !deadlinePassed(f, code);
  switch (code) {
    case "PROBLEM_PICK":
      return f.drawn && open;
    case "PITCH":
      return f.drawn && open && between(f.phase, "SQUAD_DRAW", "BUILD");
    case "CALL_1":
      return f.drawn && open && !f.released.PITCH;
    case "IPO_BIDS":
      return f.phase === "IPO" && !f.paused && !f.ipoAllocated && open;
    case "FEE":
      return phaseReached(f.phase, "CRISIS") && f.crisisApplied && open;
    case "DEAL":
    case "DEAL_BONUS":
      return between(f.phase, "CRISIS", "RESCUE_2") && f.crisisApplied && !deadlinePassed(f, "DEAL") && open;
    case "PLAN":
      return f.drawn && open && between(f.phase, "CRISIS", "RESCUE_2");
    case "CALL_2":
      return f.released.PLAN && open && !f.released.FLASH;
    case "FLASH":
      return f.flashBulletinPublished && !f.released.FLASH && open;
    case "CALL_3":
      return f.released.FLASH && open && !f.marketClosed;
    case "FLASH_BULLETIN":
    case "FLASH_TIER":
      return false;
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

function task(f: HomeFacts, code: DeadlineCode | null, t: Omit<HomeTask, "due" | "dueLabel" | "linkLabel"> & { linkLabel?: string }): HomeTask {
  const due = code ? deadlineAt(f, code) : null;
  return {
    ...t,
    linkLabel: t.href ? (t.linkLabel ?? LINK_LABELS[t.href] ?? "Open") : null,
    due,
    dueLabel: code ? DEADLINE_LABELS[code] : null,
  };
}

const LINK_LABELS: Record<string, string> = {
  [SQUAD]: "Open Squad",
  [RESCUE]: "Open Rescue",
  [CALLS]: "Open Calls",
  [TRADE]: "Open Trade",
  [QA]: "Open Q&A",
  [BOOK]: "Read the pitch book",
};

function feeTask(f: HomeFacts, mine: "productConfirmed" | "consultingConfirmed"): HomeTask {
  const fee = f.progress.fee;
  const at = clock(deadlineAt(f, "FEE"));
  const partner = mine === "productConfirmed" ? "Consulting" : "Product";
  let state: TaskState = "todo";
  let detail = `Agree a fee of $10,000–$35,000 (cash and/or up to 3,000 shares) with your ${partner} partner; both teams confirm. Without it, $22,500 cash is paid by default at ${at}.`;
  if (fee?.executed) {
    state = "done";
    detail = fee.isDefault ? "The default fee of $22,500 was paid." : "Agreed and paid.";
  } else if (fee?.proposed && fee[mine]) {
    state = "waiting";
    detail = `You confirmed; waiting for your ${partner} partner to confirm by ${at}.`;
  } else if (fee?.proposed) {
    detail = `Terms are on the table: check them and confirm by ${at}, or propose others.`;
  }
  return task(f, "FEE", { key: "FEE", title: "Agree the advisor fee", detail, href: RESCUE, state });
}

const SIGNERS: Record<Track, string> = { PRODUCT: "Product", CONSULTING: "Consulting", FINANCE: "Finance" };

function dealTask(f: HomeFacts): HomeTask {
  const deal = f.progress.deal;
  const me = f.track;
  const at = clock(deadlineAt(f, "DEAL"));
  const bonusOpen = me === "CONSULTING" && !deadlinePassed(f, "DEAL_BONUS");
  const title = me === "CONSULTING" ? "Broker the rescue deal" : me === "FINANCE" ? "Set the deal amount and sign" : "Sign the rescue deal";
  let state: TaskState = "todo";
  let detail: string;
  if (deal?.executed) {
    state = "done";
    detail = "Signed by all three teams and executed.";
  } else if (deal?.signed[me]) {
    state = "waiting";
    const others = (["PRODUCT", "CONSULTING", "FINANCE"] as const).filter((t) => !deal.signed[t]).map((t) => SIGNERS[t]);
    detail = `You signed; waiting for ${others.join(" and ")} by ${at}. Any edit resets every signature.`;
  } else if (me === "CONSULTING" && !deal?.priceSet) {
    detail = "Propose the price per share (50%–100% of the post-crisis price); your Finance partner sets the amount, then all three sign.";
  } else if (me === "FINANCE" && !deal?.amountSet) {
    detail = "Set the amount ($40,000–$80,000); your Consulting partner proposes the price, then all three sign.";
  } else if (deal?.amountSet && deal.priceSet) {
    detail = `Check the terms and sign by ${at}.`;
  } else {
    detail = "Consulting proposes the price and Finance sets the amount; then all three teams sign.";
  }
  if (bonusOpen && !deal?.executed) detail += ` Fully signed by ${clock(deadlineAt(f, "DEAL_BONUS"))} earns you the $5,000 deal bonus.`;
  const t = task(f, bonusOpen && !deal?.executed ? "DEAL_BONUS" : "DEAL", { key: "DEAL", title, detail, href: RESCUE, state });
  return t;
}

function submissionTask(f: HomeFacts, type: "PITCH" | "PLAN" | "FLASH"): HomeTask {
  const submitted = f.progress.submitted[type];
  const at = clock(deadlineAt(f, type));
  const writes = f.track === "PRODUCT" || type !== "PITCH";
  const titles = {
    PITCH: writes ? "Write and submit your pitch card" : "Help with the pitch card",
    PLAN: "Write and submit the rescue plan",
    FLASH: "Answer the flash news",
  };
  const about = {
    PITCH: "Company name, a 3–4 letter ticker and the six template sections, up to 400 words.",
    PLAN: `Up to 500 words, written by your Product and Consulting teams together. A late plan scores 0; without a fully signed deal at ${clock(deadlineAt(f, "DEAL"))} the score is capped at 50.`,
    FLASH: "Up to 100 words, answering the bulletin.",
  };
  let detail: string;
  let state: TaskState;
  if (submitted) {
    state = "done";
    detail = `Submitted. ${writes ? "You can resubmit" : "It can be resubmitted"} until ${at}; the last version on time is judged.`;
  } else if (!writes) {
    state = "info";
    detail = `Your Product partner writes and submits it by ${at}; you can read the draft in the squad workspace.`;
  } else {
    state = "todo";
    detail = `${about[type]} Due ${at}.`;
  }
  return task(f, type, { key: type, title: titles[type], detail, href: SQUAD, state });
}

function callTask(f: HomeFacts, n: 1 | 2 | 3): HomeTask {
  const code = `CALL_${n}` as const;
  const { made, total } = f.progress.calls[n];
  const done = total > 0 && made >= total;
  const baseline = { 1: "the IPO price", 2: "the price after the plan tier", 3: "the price after the flash tier" }[n];
  return task(f, code, {
    key: code,
    title: `Make call ${n} on your two companies`,
    detail: done
      ? `Made (${made} of ${total}); you can change them until ${clock(deadlineAt(f, code))}.`
      : `BUY or SELL against ${baseline}: ${made} of ${total} made. A missing call counts as wrong; each correct call earns $2,500.`,
    href: CALLS,
    state: done ? "done" : "todo",
  });
}

/** What this team should do now and next. */
export function homePlan(f: HomeFacts): HomePlan {
  const now: HomeTask[] = [];
  const shown = new Set<DeadlineCode>();
  const add = (code: DeadlineCode, t: HomeTask) => {
    shown.add(code);
    now.push(t);
  };
  const qaOpen = phaseReached(f.phase, "READING") && !phaseReached(f.phase, "CLOSE");
  const p = f.progress;

  if (f.track === "PRODUCT" || f.track === "CONSULTING") {
    if (windowOpen(f, "PROBLEM_PICK")) {
      add(
        "PROBLEM_PICK",
        task(f, "PROBLEM_PICK", {
          key: "PROBLEM_PICK",
          title: f.track === "PRODUCT" ? "Pick your problem card" : "Your Product partner picks the problem card",
          detail: p.problemPicked
            ? `Picked. ${f.track === "PRODUCT" ? "You can change it" : "It can be changed"} until ${clock(deadlineAt(f, "PROBLEM_PICK"))}.`
            : f.track === "PRODUCT"
              ? `Choose one of the three cards dealt to your squad by ${clock(deadlineAt(f, "PROBLEM_PICK"))}; otherwise the first card is assigned.`
              : "You can read the three cards dealt to your squad.",
          href: SQUAD,
          state: p.problemPicked ? "done" : f.track === "PRODUCT" ? "todo" : "info",
        }),
      );
    }
    if (windowOpen(f, "PITCH")) add("PITCH", submissionTask(f, "PITCH"));
  }

  if (f.track === "CONSULTING") {
    if (windowOpen(f, "CALL_1")) add("CALL_1", callTask(f, 1));
    if (windowOpen(f, "CALL_2")) add("CALL_2", callTask(f, 2));
    if (windowOpen(f, "CALL_3")) add("CALL_3", callTask(f, 3));
  }

  if (f.track === "FINANCE") {
    if (f.phase === "READING") {
      now.push(
        task(f, null, {
          key: "READ",
          title: "Read the pitch book",
          detail: "Every company's pitch card is public now. IPO prices are released at the IPO.",
          href: BOOK,
          state: "info",
        }),
      );
    }
    if (windowOpen(f, "IPO_BIDS")) {
      add(
        "IPO_BIDS",
        task(f, "IPO_BIDS", {
          key: "IPO_BIDS",
          title: "Place IPO bids",
          detail:
            p.ipoBids > 0
              ? `${plural(p.ipoBids, "bid")} placed; you can change them until ${clock(deadlineAt(f, "IPO_BIDS"))}.`
              : "Up to 4,000 shares per company (not your own squad's), within your cash at IPO prices.",
          href: TRADE,
          state: p.ipoBids > 0 ? "done" : "todo",
        }),
      );
    }
    if (f.openRound && !f.paused) {
      now.push({
        key: "ROUND",
        title: `Trade: round ${f.openRound.number} is open`,
        detail: "Orders can be placed, edited or cancelled until the round closes; every order fills at the round's new price.",
        href: TRADE,
        linkLabel: LINK_LABELS[TRADE]!,
        due: f.openRound.closes_at,
        dueLabel: `Round ${f.openRound.number} closes`,
        state: "todo",
      });
    }
  }

  if (f.track !== "FINANCE" && windowOpen(f, "FEE")) add("FEE", feeTask(f, f.track === "PRODUCT" ? "productConfirmed" : "consultingConfirmed"));
  if (windowOpen(f, "DEAL")) {
    shown.add("DEAL_BONUS");
    add("DEAL", dealTask(f));
  }
  if (f.track !== "FINANCE") {
    if (windowOpen(f, "PLAN")) add("PLAN", submissionTask(f, "PLAN"));
    if (windowOpen(f, "FLASH")) add("FLASH", submissionTask(f, "FLASH"));
  }

  if (qaOpen && f.track === "PRODUCT") {
    now.push(
      task(f, null, {
        key: "QA",
        title: "Answer questions about your company",
        detail: p.unanswered > 0 ? `${plural(p.unanswered, "question")} without an answer yet. Answers are up to 100 words and public.` : "No question is waiting for an answer.",
        href: QA,
        state: p.unanswered > 0 ? "todo" : "info",
      }),
    );
  }
  if (qaOpen && f.track === "FINANCE") {
    now.push(
      task(f, null, {
        key: "QA",
        title: "Ask questions on the Q&A board",
        detail: "Questions are public and shown without your team; the company answers on the board.",
        href: QA,
        state: "info",
      }),
    );
  }

  // Soonest deadline first; items without a deadline (the Q&A board, reading) last.
  const order: Record<TaskState, number> = { todo: 0, waiting: 1, done: 2, info: 3 };
  now.sort((a, b) => {
    if (a.due && b.due) return new Date(a.due).getTime() - new Date(b.due).getTime() || order[a.state] - order[b.state];
    if (a.due || b.due) return a.due ? -1 : 1;
    return order[a.state] - order[b.state];
  });

  const next: UpcomingItem[] = [];
  if (!f.drawn && f.phaseStarts.SQUAD_DRAW && f.nowMs < new Date(f.phaseStarts.SQUAD_DRAW).getTime()) {
    next.push({ key: "SQUAD_DRAW", title: "Squad draw: your squad and company", at: f.phaseStarts.SQUAD_DRAW, href: null });
  }
  for (const code of TRACK_DEADLINES[f.track]) {
    const at = deadlineAt(f, code);
    if (!at || shown.has(code) || deadlinePassed(f, code) || closedEarly(f, code)) continue;
    next.push({ key: code, title: UPCOMING_TITLES[code], at, href: hrefFor(f.track, code) });
  }
  if (f.track === "FINANCE" && f.nextRound && !f.openRound) {
    next.push({ key: "NEXT_ROUND", title: `Round ${f.nextRound.number} opens`, at: f.nextRound.opens_at, href: TRADE });
  }
  next.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return { now, next: next.slice(0, 5), idle: idleText(f) };
}

/** What the night holds when nothing needs doing now. */
function idleText(f: HomeFacts): string {
  const at = (p: PhaseCode) => (f.phaseStarts[p] ? ` at ${clock(f.phaseStarts[p])}` : "");
  if (f.phase === "AWARDS") return "Awards: the rankings are revealed now, on the big screen.";
  if (phaseReached(f.phase, "CLOSE")) return `Trading has closed. Scores are computed at settlement; rankings are revealed at the awards${at("AWARDS")}.`;
  if (!f.drawn) {
    return phaseReached(f.phase, "SQUAD_DRAW")
      ? "Waiting for the squad draw. Your squad, company and tasks appear here once it is drawn."
      : `Check in and listen to the briefing. The squad draw is${at("SQUAD_DRAW")}; your squad, company and tasks appear here after it.`;
  }
  if (f.paused) return "The event is paused. Deadlines move later by the length of the pause.";
  return "Nothing needs doing right now. Watch the bulletins and the market.";
}

// ───────────────────────────── Holdings ─────────────────────────────

export const LOT_LABELS: Record<LotType, string> = {
  RETAINED: "Retained (locked)",
  SQUAD: "Squad lot",
  EXCHANGE: "Exchange",
  SHORT: "Short",
  FEE: "Fee shares",
};

export interface HoldingRow {
  company_id: string;
  lot: LotType;
  qty: number;
}

export interface PricedCompany {
  id: string;
  ticker: string | null;
  name: string | null;
  /** Integer cents. */
  market_price: number | null;
  closing_price: number | null;
}

export interface HoldingLine {
  key: string;
  companyId: string;
  ticker: string;
  name: string;
  lot: LotType;
  lotLabel: string;
  /** Shares held (for a short: shares owed). */
  qty: number;
  /** Price used (closing price once fixed, otherwise the market price), integer cents. */
  price: number | null;
  /** qty × price; negative for a short. Null before the company has a price. */
  value: number | null;
}

export interface HoldingsView {
  lines: HoldingLine[];
  /** Sum of the priced lines (cents). */
  total: number;
  /** Lines without a price yet (before the IPO). */
  unpriced: number;
  /** Prices are the closing prices (the market has closed). */
  closing: boolean;
}

/** One line per company and lot with shares, valued at the current price (a short is a liability). */
export function holdingsView(holdings: readonly HoldingRow[], companies: readonly PricedCompany[]): HoldingsView {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const lotOrder = (l: LotType) => LOT_TYPES.indexOf(l);
  let total = 0;
  let unpriced = 0;
  let closing = false;
  const lines = holdings
    .filter((h) => h.qty !== 0)
    .map((h): HoldingLine => {
      const c = byId.get(h.company_id);
      const price = c?.closing_price ?? c?.market_price ?? null;
      if (c?.closing_price != null) closing = true;
      const v = price === null ? null : (h.lot === "SHORT" ? -1 : 1) * value(h.qty, price);
      if (v === null) unpriced++;
      else total += v;
      return {
        key: `${h.company_id}:${h.lot}`,
        companyId: h.company_id,
        ticker: c?.ticker ?? "—",
        name: c?.name ?? "Your squad's company",
        lot: h.lot,
        lotLabel: LOT_LABELS[h.lot],
        qty: h.qty,
        price,
        value: v,
      };
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker) || lotOrder(a.lot) - lotOrder(b.lot));
  return { lines, total, unpriced, closing };
}
