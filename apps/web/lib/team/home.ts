// Home: what this team should do now, for its track and where the night is, what comes next, and its own holdings.
// Pure: the page reads the rows (home-data.ts) and this decides. The windows mirror the game functions' checks
// (pick_problem_card, submission_window, fee_window_open, deal_window_open, make_call, place_ipo_bid), but they are
// guidance only: the database decides every action again when it is sent.

import {
  DEADLINE_LABELS,
  LOT_TYPES,
  subroundDeadlineLabels,
  phaseIndex,
  phaseReached,
  planOf,
  value,
  type DeadlineCode,
  type LotType,
  type PhaseCode,
  type SubmissionType,
  type Track,
} from "@msim/engine";
import { clock, count, money } from "@/lib/format";

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
  /** One case for every squad: a single card was dealt and chosen at the draw, so there is no pick. */
  oneCase?: boolean;
  /** The squad has a current (on-time) submission of this type. */
  submitted: Partial<Record<SubmissionType, boolean>>;
  fee: FeeProgress | null;
  deal: DealProgress | null;
  /** Consulting: calls made and call slots, per window. */
  calls: Record<1 | 2 | 3, { made: number; total: number }>;
  /** Finance: IPO bids with a quantity. */
  ipoBids: number;
  /** Product: questions to its company with no answer yet. */
  unanswered: number;
}

/** Where a team stands in a PRIMUS event's Round 2 (crises 1–4) or Round 3 (5), from team_plan_facts. */
export interface PrimusFacts {
  /** The crisis under way: 1–4 in Round 2 (the latest revealed), 5 in Round 3; null before the first reveal. */
  k: number | null;
  /** The sub-round whose hiring is open now, or null. */
  hiringK: number | null;
  /** Writing for crisis k is open (the plan, the firm's memo, the Round 3 solution). */
  workOpen: boolean;
  /** Product: the firm hired for crisis k. */
  engagement?: { firm: string; cash: number; shares: number; escrow: "HELD" | "RELEASED" | "REFUNDED" } | null;
  /** Open offers waiting for this team's answer, and for the other side's. */
  offersMyTurn?: number;
  offersWaiting?: number;
  /** Product: the firms it can rate now. */
  rate?: { k: number; firm: string; rating: number | null }[];
  /** Product, Round 3: its place in the draft (null before the draft is set). */
  draft?: {
    pickNo: number;
    picked: boolean;
    byDefault: boolean;
    statement: { number: number; title: string } | null;
    myTurn: boolean;
    closesAt: string | null;
    ahead: number;
  } | null;
  /** Consulting: the profile has a headline. */
  profileSet?: boolean;
  /** Consulting: its clients of crisis k, and whether the memo for each is in. */
  clients?: { companyId: string; ticker: string | null; name: string | null; submitted: boolean }[];
}

export interface HomeFacts {
  /** The event's format: a PRIMUS event plays Rounds 2 and 3 as crises, hiring and the draft. */
  format?: "CLASSIC" | "PRIMUS";
  primus?: PrimusFacts | null;
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
  released: Partial<Record<SubmissionType, boolean>>;
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
  /** Words for the state chip when the usual ones do not fit (say, "Waiting for your turn"). */
  stateLabel?: string;
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
const PROBLEM = "/team/squad/problem";
const PITCH = "/team/squad/pitch";
const PLAN = "/team/squad/plan";
const FLASH = "/team/squad/flash";
const MEMO = "/team/squad/memo";
const RESCUE = "/team/rescue";
const CALLS = "/team/calls";
const TRADE = "/team/trade";
const IPO = "/team/trade/ipo";
/** Each submission's own form. */
const FORM: Record<"PITCH" | "PLAN" | "FLASH", string> = { PITCH, PLAN, FLASH };
const CRISIS_ROOM = "/team/crisis";
const FIRMS = "/team/firms";
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

/** A PRIMUS event's sub-round deadlines of these kinds (k = 1–5; there is no REVEAL_5). */
function subroundCodes(kinds: string[]): DeadlineCode[] {
  return [1, 2, 3, 4, 5].flatMap((k) => kinds.map((d) => `${d}_${k}`)).filter((c) => c !== "REVEAL_5") as DeadlineCode[];
}

/** Deadlines that concern each track (FLASH_TIER is a price event, not something a team does). */
export const TRACK_DEADLINES: Record<Track, readonly DeadlineCode[]> = {
  PRODUCT: ["PROBLEM_PICK", "PITCH", "FEE", "DEAL", "PLAN", "FLASH_BULLETIN", "FLASH", ...subroundCodes(["REVEAL", "HIRE", "DUE", "RATE"]), "DRAFT"],
  CONSULTING: ["PROBLEM_PICK", "PITCH", "CALL_1", "FEE", "DEAL_BONUS", "DEAL", "PLAN", "CALL_2", "FLASH_BULLETIN", "FLASH", "CALL_3", ...subroundCodes(["HIRE", "DUE"])],
  FINANCE: ["IPO_BIDS", "DEAL", "FLASH_BULLETIN", ...subroundCodes(["REVEAL"])],
};

const UPCOMING_TITLES: Record<DeadlineCode, string> = {
  ...subroundDeadlineLabels(),
  PROBLEM_PICK: "Problem card pick closes",
  PITCH: "PRD due",
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
      return track === "FINANCE" ? null : PROBLEM;
    case "PITCH":
    case "PLAN":
    case "FLASH":
      return track === "FINANCE" ? null : FORM[code];
    case "CALL_1":
    case "CALL_2":
    case "CALL_3":
      return track === "CONSULTING" ? CALLS : null;
    case "IPO_BIDS":
      return track === "FINANCE" ? IPO : null;
    case "FEE":
    case "DEAL_BONUS":
    case "DEAL":
      return RESCUE;
    case "FLASH_BULLETIN":
    case "FLASH_TIER":
      return "/team/bulletins";
    default: // PRIMUS sub-rounds: the crisis room
      return track === "FINANCE" ? null : CRISIS_ROOM;
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
      return !!f.released.PITCH;
    case "IPO_BIDS":
      return phaseIndex(f.phase) > phaseIndex("IPO") || f.ipoAllocated;
    case "DEAL_BONUS":
    case "DEAL":
    case "PLAN":
      return phaseIndex(f.phase) > phaseIndex("RESCUE_2");
    case "CALL_2":
    case "FLASH":
    case "FLASH_TIER":
      return !!f.released.FLASH;
    case "FLASH_BULLETIN":
      return f.flashBulletinPublished;
    case "CALL_3":
      return f.marketClosed;
    default:
      return false;
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
      return !!f.released.PLAN && open && !f.released.FLASH;
    case "FLASH":
      return f.flashBulletinPublished && !f.released.FLASH && open;
    case "CALL_3":
      return !!f.released.FLASH && open && !f.marketClosed;
    case "FLASH_BULLETIN":
    case "FLASH_TIER":
      return false;
    default: // PRIMUS sub-rounds
      return open && (f.phase === "PRESSURE" || f.phase === "SATURATION");
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

function task(
  f: HomeFacts,
  code: DeadlineCode | null,
  t: Omit<HomeTask, "due" | "dueLabel" | "linkLabel"> & { linkLabel?: string; dueLabel?: string },
): HomeTask {
  const due = code ? deadlineAt(f, code) : null;
  return {
    ...t,
    linkLabel: t.href ? (t.linkLabel ?? LINK_LABELS[t.href] ?? "Open") : null,
    due,
    dueLabel: code ? (t.dueLabel ?? DEADLINE_LABELS[code]) : null,
  };
}

const LINK_LABELS: Record<string, string> = {
  [SQUAD]: "Open Squad",
  [PROBLEM]: "Open the problem cards",
  [PITCH]: "Open the PRD",
  [MEMO]: "Open the crisis memo",
  [PLAN]: "Open the rescue plan",
  [CRISIS_ROOM]: "Open the crisis room",
  [FIRMS]: "See the firms",
  [FLASH]: "Open the flash answer",
  [IPO]: "Open IPO bids",
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
    PITCH: writes ? "Write and submit your PRD" : "Help with the PRD",
    PLAN: "Write and submit the rescue plan",
    FLASH: "Answer the flash news",
  };
  const about = {
    PITCH: "Company name, a 3–4 letter ticker and the seven PRD sections, up to 800 words.",
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
  return task(f, type, { key: type, title: titles[type], detail, href: FORM[type], state });
}

/** Round 1 Consultancy: the crisis memo, written by the Consulting team alone and due with the PRD. */
function memoTask(f: HomeFacts): HomeTask {
  const at = clock(deadlineAt(f, "PITCH"));
  const submitted = f.progress.submitted.MEMO;
  return task(f, "PITCH", {
    key: "MEMO",
    title: "Write and submit your crisis memo",
    detail: submitted
      ? `Submitted. You can resubmit until ${at}; the last version on time is judged.`
      : `Read the case and recommend one way out, in six sections and up to 500 words. Its score sets your firm's reputation bonus. Due ${at}.`,
    href: MEMO,
    state: submitted ? "done" : "todo",
  });
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

// ───────────────────────────── PRIMUS Rounds 2 and 3 ─────────────────────────────

const stars = (n: number) => `${n} ${n === 1 ? "star" : "stars"}`;
const feeText = (cash: number, shares: number) =>
  shares === 0 ? money(cash) : cash === 0 ? `${count(shares)} shares` : `${money(cash)} + ${count(shares)} shares`;
/** "crisis 2" or "Round 3", inside a sentence. */
const crisisWords = (k: number) => (k === 5 ? "Round 3" : `crisis ${k}`);

/**
 * A PRIMUS event's tasks in Round 2 (each crisis: hire a firm, write, rate) and Round 3 (the draft, hire, the
 * solution). The windows mirror app.hiring_subround, app.subround_open and rate_firm; the database decides again.
 * Returns the tasks with the deadline each one answers (so "coming up" does not repeat it).
 */
export function primusTasks(f: HomeFacts): { code: DeadlineCode | null; task: HomeTask }[] {
  const p = f.primus;
  if (f.format !== "PRIMUS" || !p || (f.phase !== "PRESSURE" && f.phase !== "SATURATION")) return [];
  const out: { code: DeadlineCode | null; task: HomeTask }[] = [];
  const add = (code: DeadlineCode | null, t: Parameters<typeof task>[2]) => out.push({ code, task: task(f, code, t) });
  const k = p.k;
  const hire = p.hiringK !== null ? (`HIRE_${p.hiringK}` as DeadlineCode) : null;
  const due = k !== null ? (`DUE_${k}` as DeadlineCode) : null;

  if (f.track === "PRODUCT") {
    // Round 3 starts with the draft.
    if (f.phase === "SATURATION" && p.draft) {
      const d = p.draft;
      if (d.picked) {
        add(null, {
          key: "DRAFT",
          title: "Your problem statement",
          detail: d.statement
            ? `You work on statement ${d.statement.number}: ${d.statement.title}${d.byDefault ? " (given to you: no pick in time)" : ""}.`
            : "Your statement is set.",
          href: CRISIS_ROOM,
          state: "done",
        });
      } else if (d.myTurn) {
        out.push({
          code: "DRAFT",
          task: {
            key: "DRAFT",
            title: "Your pick: choose a problem statement",
            detail: "Pick now. If your 20 seconds run out, you get the statement with the fewest companies.",
            href: CRISIS_ROOM,
            linkLabel: "Pick a statement",
            due: d.closesAt,
            dueLabel: "Your pick ends",
            state: "todo",
          },
        });
      } else {
        add("DRAFT", {
          key: "DRAFT",
          title: "The draft: wait for your pick",
          detail: `${d.ahead === 1 ? "1 company picks" : `${count(d.ahead)} companies pick`} before you (the lowest score so far goes first). Read the statements while you wait.`,
          href: CRISIS_ROOM,
          state: "waiting",
          stateLabel: "Waiting for your turn",
        });
      }
    }
    if (k !== null && hire && p.hiringK === k) {
      const closes = clock(deadlineAt(f, hire));
      const e = p.engagement;
      if (e) {
        add(hire, {
          key: "HIRE",
          title: "Hire a consulting firm",
          detail: `You hired ${e.firm} for ${feeText(e.cash, e.shares)}. The fee is kept safe until the due time: the firm gets it only if it sends its memo.`,
          href: CRISIS_ROOM,
          state: "done",
        });
      } else if ((p.offersMyTurn ?? 0) > 0) {
        add(hire, {
          key: "HIRE",
          title: "Answer the firm's counter-offer",
          detail: `A firm changed your offer. Accept, decline or counter before hiring closes at ${closes}.`,
          href: CRISIS_ROOM,
          state: "todo",
        });
      } else if ((p.offersWaiting ?? 0) > 0) {
        add(hire, {
          key: "HIRE",
          title: "Hire a consulting firm",
          detail: `Offer sent. The firm has until ${closes} to answer; you can make offers to other firms too.`,
          href: CRISIS_ROOM,
          state: "waiting",
          stateLabel: "Waiting for the firm",
        });
      } else {
        add(hire, {
          key: "HIRE",
          title: "Hire a consulting firm",
          detail: `Choose a firm and offer it cash, shares or both${k === 5 ? " (worth 5–20% of your cash)" : ""}. Its memo helps your ${k === 5 ? "solution" : "plan"} score higher. Hiring closes at ${closes}.`,
          href: CRISIS_ROOM,
          linkLabel: "Choose a firm",
          state: "todo",
        });
      }
    }
    if (k !== null && due && p.workOpen) {
      const type = planOf(k);
      const at = clock(deadlineAt(f, due));
      const sent = !!f.progress.submitted[type];
      add(due, {
        key: "PLAN_K",
        title: k === 5 ? "Write and submit your solution" : `Write and submit your plan for crisis ${k}`,
        detail: sent
          ? `Submitted. You can send a better version until ${at}; the last one on time is judged.`
          : k === 5
            ? `Up to 600 words: how you solve your problem statement. Your hired firm can write it with you. Due ${at}.`
            : `Up to 500 words: how your company gets through this crisis. Due ${at}. No plan scores 0 and your price falls.`,
        href: CRISIS_ROOM,
        linkLabel: k === 5 ? "Write the solution" : "Write the plan",
        state: sent ? "done" : "todo",
      });
    }
    for (const r of p.rate ?? []) {
      const code = `RATE_${r.k}` as DeadlineCode;
      add(code, {
        key: `RATE_${r.k}`,
        title: `Rate your firm for ${crisisWords(r.k)}`,
        detail:
          r.rating === null
            ? `Give ${r.firm} 1 to 5 stars for its help. No rating counts as 3 stars.`
            : `You gave ${r.firm} ${stars(r.rating)}. You can change it until ${clock(deadlineAt(f, code))}.`,
        href: CRISIS_ROOM,
        linkLabel: "Rate the firm",
        state: r.rating === null ? "todo" : "done",
      });
    }
  }

  if (f.track === "CONSULTING") {
    const clients = p.clients ?? [];
    if (p.profileSet === false) {
      add(null, {
        key: "PROFILE",
        title: "Fill in your firm's profile",
        detail: "Companies read it to choose a firm. Add a headline, what you are good at and your asking fee.",
        href: CRISIS_ROOM,
        linkLabel: "Fill in the profile",
        state: "todo",
      });
    }
    if (hire && p.hiringK === k) {
      const closes = clock(deadlineAt(f, hire));
      const mine = p.offersMyTurn ?? 0;
      if (mine > 0) {
        add(hire, {
          key: "OFFERS",
          title: mine === 1 ? "Answer 1 offer" : `Answer ${count(mine)} offers`,
          detail: `${mine === 1 ? "A company wants" : "Companies want"} to hire you. Accept, decline or counter by ${closes}. You can take 2 clients per crisis (${clients.length} so far).`,
          href: CRISIS_ROOM,
          linkLabel: "See the offers",
          state: "todo",
        });
      } else if (clients.length < 2) {
        const countered = (p.offersWaiting ?? 0) > 0;
        add(hire, {
          key: "OFFERS",
          title: countered ? "Your counter-offer is with the company" : "Wait for offers",
          detail: countered
            ? `The company has until ${closes} to accept, decline or counter.`
            : `No offer to answer right now. Companies can send you offers until ${closes}.`,
          href: CRISIS_ROOM,
          state: countered ? "waiting" : "info",
          ...(countered ? { stateLabel: "Waiting for the company" } : {}),
        });
      }
    }
    if (k !== null && due && p.workOpen) {
      const at = clock(deadlineAt(f, due));
      for (const c of clients) {
        const who = c.ticker ?? c.name ?? "your client";
        add(due, {
          key: `ADVICE_${c.companyId}`,
          title: `Write your advice memo for ${who}`,
          detail: c.submitted
            ? `Sent. You can send a better version until ${at}.`
            : `Up to 500 words of advice for your client's ${k === 5 ? "problem statement" : "crisis"}. Your fee is paid only if the memo is in by ${at}.${k === 5 ? " You can also edit the solution with your client." : ""}`,
          href: `${CRISIS_ROOM}#client-${c.companyId}`,
          linkLabel: "Write the memo",
          state: c.submitted ? "done" : "todo",
        });
      }
    }
  }

  if (f.track === "FINANCE") {
    if (f.phase === "PRESSURE" && k !== null) {
      add(null, {
        key: "CARDS",
        title: `Read the crisis ${k} cards`,
        detail: "Every company got a new crisis card and every price fell 5%. See who hired which firm before you trade.",
        href: CRISIS_ROOM,
        state: "info",
      });
    }
    if (f.phase === "SATURATION") {
      add(null, {
        key: "CARDS",
        title: "Round 3: fresh capital and the draft",
        detail: "Every fund received half its starting capital again. Companies that share a problem statement compete: watch the draft, then invest.",
        href: CRISIS_ROOM,
        state: "info",
      });
    }
  }
  return out;
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
    // The card is picked while the company is built: once the PRDs are being read it is no longer a task.
    if (windowOpen(f, "PROBLEM_PICK") && !p.oneCase && !phaseReached(f.phase, "READING")) {
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
          href: PROBLEM,
          state: p.problemPicked ? "done" : f.track === "PRODUCT" ? "todo" : "info",
        }),
      );
    }
    if (windowOpen(f, "PITCH")) {
      if (f.track === "CONSULTING") now.push(memoTask(f));
      add("PITCH", submissionTask(f, "PITCH"));
    }
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
          detail: "Every company's PRD is public now. IPO prices are released at the IPO.",
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
          href: IPO,
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

  for (const t of primusTasks(f)) {
    if (t.code) shown.add(t.code);
    now.push(t.task);
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
    if (code === "PROBLEM_PICK" && f.progress.oneCase) continue; // one case for every squad: no pick
    if (code === "PROBLEM_PICK" && phaseReached(f.phase, "READING")) continue;
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
  if (f.format === "PRIMUS" && f.phase === "PRESSURE") {
    const k = f.primus?.k ?? null;
    if (k === null) {
      const first = deadlineAt(f, "REVEAL_1");
      return `Round 2 is four crises. The first crisis card arrives${first ? ` at ${clock(first)}` : " soon"}.`;
    }
    const next = k < 4 ? deadlineAt(f, `REVEAL_${k + 1}` as DeadlineCode) : null;
    return `Crisis ${k} of 4: nothing to press right now. ${next ? `The next crisis card arrives at ${clock(next)}.` : "Round 3 comes next."}`;
  }
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
  /** Null before the company has a ticker (the squad's own company before its PRD). */
  ticker: string | null;
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
  /** Sum of the priced lines (cents); null when no line has a price yet. */
  total: number | null;
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
        ticker: c?.ticker ?? null,
        name: c?.name ?? "Your squad's company",
        lot: h.lot,
        lotLabel: LOT_LABELS[h.lot],
        qty: h.qty,
        price,
        value: v,
      };
    })
    .sort((a, b) => (a.ticker ?? "").localeCompare(b.ticker ?? "") || lotOrder(a.lot) - lotOrder(b.lot));
  return { lines, total: lines.length > unpriced ? total : null, unpriced, closing };
}
