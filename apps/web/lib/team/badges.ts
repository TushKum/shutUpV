// Badges: small achievements a team collects during the night, shown on its Home. Each track has its own set; a
// badge is earned from facts the team can already see about itself (public.team_badge_facts) and its value now.
// Badges change nothing in the game: no score, price or ranking depends on them. Pure, so it is unit-tested.

import { RULES, type SubmissionType, type Track } from "@msim/engine";

export interface BadgeFacts {
  track: Track;
  /** The event's format: each has its own badges. */
  format?: "CLASSIC" | "PRIMUS";
  /** PRIMUS, Product: firms hired so far (one per crisis at most). */
  hires?: number;
  /** PRIMUS, Consulting: clients so far, the 5-star ratings among them, and the ratings received. */
  clients?: number;
  fiveStars?: number;
  ratings?: number;
  ratingAvg?: number | null;
  /** The squad's on-time submissions. */
  submitted: SubmissionType[];
  /** The squad company's released final scores. */
  scores: Partial<Record<SubmissionType, number>>;
  feeAgreed: boolean;
  dealEarly: boolean;
  callsCorrect: number;
  questionsAsked: number;
  answersGiven: number;
  ipoBids: number;
  trades: number;
  companiesHeld: number;
  messages: number;
  /** The squad company's prices (integer cents), when it has one. */
  company: { ipo: number | null; market: number | null; postCrisis: number | null; closing: number | null } | null;
  /** The team's value now (cash + holdings at the current prices), integer cents; null before prices exist. */
  valueNow: number | null;
}

export interface Badge {
  key: string;
  icon: string;
  name: string;
  /** How to earn it, in one short sentence. */
  how: string;
  earned: boolean;
}

interface Rule {
  key: string;
  icon: string;
  name: string;
  how: string;
  tracks: readonly Track[];
  /** Only in this format (both when absent). */
  format?: "CLASSIC" | "PRIMUS";
  test: (f: BadgeFacts) => boolean;
}

const ALL: readonly Track[] = ["PRODUCT", "CONSULTING", "FINANCE"];
const SQUAD: readonly Track[] = ["PRODUCT", "CONSULTING"];
const price = (f: BadgeFacts) => f.company?.closing ?? f.company?.market ?? null;
const score = (f: BadgeFacts, t: SubmissionType) => f.scores[t] ?? -1;

const CRISIS_PLANS: readonly SubmissionType[] = ["CRISIS_1", "CRISIS_2", "CRISIS_3", "CRISIS_4"];
const RULES_LIST: readonly Rule[] = [
  { key: "TEAM_TALK", icon: "💬", name: "Team talker", how: "Send 5 messages in your squad chat.", tracks: ALL, test: (f) => f.messages >= 5 },
  // Product and Consulting: the squad's writing.
  { key: "LAUNCH", icon: "🚀", name: "Launch day", how: "Submit the PRD on time.", tracks: SQUAD, test: (f) => f.submitted.includes("PITCH") },
  { key: "STAR_PITCH", icon: "⭐", name: "Star pitch", how: "Score 80 or more on the pitch.", tracks: SQUAD, test: (f) => score(f, "PITCH") >= 80 },
  { format: "CLASSIC", key: "RESCUE_HERO", icon: "🛟", name: "Rescue hero", how: "Score 80 or more on the rescue plan.", tracks: SQUAD, test: (f) => score(f, "PLAN") >= 80 },
  { format: "CLASSIC", key: "QUICK_THINKER", icon: "⚡", name: "Quick thinker", how: "Score 70 or more on the flash answer.", tracks: SQUAD, test: (f) => score(f, "FLASH") >= 70 },
  // Product: its own company.
  { key: "GOOD_LISTENER", icon: "🙋", name: "Good listener", how: "Answer 3 investors' questions.", tracks: ["PRODUCT"], test: (f) => f.answersGiven >= 3 },
  {
    format: "CLASSIC",
    key: "COMEBACK",
    icon: "📈",
    name: "Comeback kid",
    how: "Get your share price 10% above its post-crisis price.",
    tracks: ["PRODUCT"],
    test: (f) => {
      const p = price(f);
      const low = f.company?.postCrisis ?? null;
      return p !== null && low !== null && p * 10 >= low * 11;
    },
  },
  {
    key: "VALUE_MAKER",
    icon: "💎",
    name: "Value maker",
    how: "Finish with your share price above the IPO price.",
    tracks: ["PRODUCT"],
    test: (f) => f.company?.closing != null && f.company.ipo != null && f.company.closing > f.company.ipo,
  },
  // Consulting.
  { format: "CLASSIC", key: "FAIR_FEE", icon: "💼", name: "Fair fee", how: "Agree the fee with your Product team (not the default).", tracks: ["CONSULTING"], test: (f) => f.feeAgreed },
  { key: "SHARP_EYE", icon: "🎯", name: "Sharp eye", how: "Make a correct BUY or SELL call.", tracks: ["CONSULTING"], test: (f) => f.callsCorrect >= 1 },
  { format: "CLASSIC", key: "FORTUNE_TELLER", icon: "🔮", name: "Fortune teller", how: "Make 4 correct calls.", tracks: ["CONSULTING"], test: (f) => f.callsCorrect >= 4 },
  // The rescue deal, for all three teams of the squad.
  { format: "CLASSIC", key: "EARLY_DEAL", icon: "🤝", name: "Handshake", how: "Get the rescue deal signed before the bonus deadline.", tracks: ALL, test: (f) => f.dealEarly },
  // A PRIMUS event's Rounds 2 and 3.
  { format: "PRIMUS", key: "FIRST_HIRE", icon: "🤝", name: "First hire", how: "Hire a consulting firm.", tracks: ["PRODUCT"], test: (f) => (f.hires ?? 0) >= 1 },
  { format: "PRIMUS", key: "CRISIS_TAMER", icon: "🛟", name: "Crisis tamer", how: "Score 80 or more on a crisis plan.", tracks: ["PRODUCT"], test: (f) => CRISIS_PLANS.some((t) => score(f, t) >= 80) },
  { format: "PRIMUS", key: "UNBREAKABLE", icon: "🧱", name: "Unbreakable", how: "Submit a plan for all four crises.", tracks: ["PRODUCT"], test: (f) => CRISIS_PLANS.every((t) => f.submitted.includes(t)) },
  { format: "PRIMUS", key: "PROBLEM_SOLVER", icon: "🧩", name: "Problem solver", how: "Score 80 or more on your Round 3 solution.", tracks: ["PRODUCT"], test: (f) => score(f, "SOLUTION") >= 80 },
  { format: "PRIMUS", key: "SHARP_MEMO", icon: "📝", name: "Sharp memo", how: "Score 80 or more on your Round 1 crisis memo.", tracks: ["CONSULTING"], test: (f) => score(f, "MEMO") >= 80 },
  { format: "PRIMUS", key: "FIRST_CLIENT", icon: "🤝", name: "First client", how: "Get hired by a company.", tracks: ["CONSULTING"], test: (f) => (f.clients ?? 0) >= 1 },
  { format: "PRIMUS", key: "IN_DEMAND", icon: "🔥", name: "In demand", how: "Get hired 5 times.", tracks: ["CONSULTING"], test: (f) => (f.clients ?? 0) >= 5 },
  { format: "PRIMUS", key: "FIVE_STARS", icon: "🌟", name: "Five stars", how: "Get a 5-star rating from a client.", tracks: ["CONSULTING"], test: (f) => (f.fiveStars ?? 0) >= 1 },
  {
    format: "PRIMUS",
    key: "TRUSTED",
    icon: "🏅",
    name: "Trusted adviser",
    how: "Keep an average of 4 stars or more over 3 ratings.",
    tracks: ["CONSULTING"],
    test: (f) => (f.ratings ?? 0) >= 3 && (f.ratingAvg ?? 0) >= 4,
  },
  // Finance.
  { key: "CURIOUS", icon: "❓", name: "Curious mind", how: "Ask 3 questions on the Q&A board.", tracks: ["FINANCE"], test: (f) => f.questionsAsked >= 3 },
  { key: "FIRST_BID", icon: "🛎️", name: "First bid", how: "Place a bid in the IPO.", tracks: ["FINANCE"], test: (f) => f.ipoBids >= 1 },
  { key: "FIRST_TRADE", icon: "📊", name: "First trade", how: "Get an order filled in a trading round.", tracks: ["FINANCE"], test: (f) => f.trades >= 1 },
  { key: "BASKET", icon: "🧺", name: "Basket builder", how: "Own shares in 5 different companies.", tracks: ["FINANCE"], test: (f) => f.companiesHeld >= 5 },
  {
    key: "GROWING",
    icon: "🌱",
    name: "Growing fund",
    how: "Grow your fund above $500,000.",
    tracks: ["FINANCE"],
    test: (f) => f.valueNow !== null && f.valueNow > RULES.START_CASH_FINANCE,
  },
  {
    key: "BIG_WIN",
    icon: "🏆",
    name: "Big win",
    how: "Grow your fund by 10% (to $550,000).",
    tracks: ["FINANCE"],
    test: (f) => f.valueNow !== null && f.valueNow * 10 >= RULES.START_CASH_FINANCE * 11,
  },
];

/** This track's badges, earned ones first (in the list's order), then the ones still to earn. */
export function badgesFor(f: BadgeFacts): Badge[] {
  const format = f.format ?? "CLASSIC";
  const mine = RULES_LIST.filter((r) => r.tracks.includes(f.track) && (!r.format || r.format === format)).map((r) => ({
    key: r.key,
    icon: r.icon,
    name: r.name,
    how: r.how,
    earned: r.test(f),
  }));
  return [...mine.filter((b) => b.earned), ...mine.filter((b) => !b.earned)];
}

/** The row public.team_badge_facts returns, as BadgeFacts (valueNow comes from the Home's holdings). */
export function badgeFactsFromRow(
  row: {
    track: Track;
    format?: "CLASSIC" | "PRIMUS";
    hires?: number;
    clients?: number;
    five_stars?: number;
    ratings?: number;
    rating_avg?: number | string | null;
    submitted: SubmissionType[];
    scores: Partial<Record<SubmissionType, number>>;
    fee_agreed: boolean;
    deal_early: boolean;
    calls_correct: number;
    questions_asked: number;
    answers_given: number;
    ipo_bids: number;
    trades: number;
    companies_held: number;
    messages: number;
    company: { ipo_price: number | null; market_price: number | null; post_crisis_price: number | null; closing_price: number | null } | null;
  },
  valueNow: number | null,
): BadgeFacts {
  return {
    track: row.track,
    format: row.format ?? "CLASSIC",
    hires: Number(row.hires ?? 0),
    clients: Number(row.clients ?? 0),
    fiveStars: Number(row.five_stars ?? 0),
    ratings: Number(row.ratings ?? 0),
    ratingAvg: row.rating_avg === null || row.rating_avg === undefined ? null : Number(row.rating_avg),
    submitted: row.submitted ?? [],
    scores: row.scores ?? {},
    feeAgreed: row.fee_agreed,
    dealEarly: row.deal_early,
    callsCorrect: Number(row.calls_correct),
    questionsAsked: Number(row.questions_asked),
    answersGiven: Number(row.answers_given),
    ipoBids: Number(row.ipo_bids),
    trades: Number(row.trades),
    companiesHeld: Number(row.companies_held),
    messages: Number(row.messages),
    company: row.company
      ? { ipo: row.company.ipo_price, market: row.company.market_price, postCrisis: row.company.post_crisis_price, closing: row.company.closing_price }
      : null,
    valueNow,
  };
}

/**
 * The team's score now: cash + its shares at the current prices (closing prices once set), and the change since
 * its start. Start values: a fund's $500,000; a company's 60,000 shares at its IPO price + the $50,000 seed money; a
 * consultancy starts at $0, so it shows what it has earned. Its own value only: never other teams' (the rankings
 * stay hidden until the awards).
 */
export function scoreNow(
  track: Track,
  cash: number,
  holdingsTotal: number | null,
  ipoPrice: number | null,
): { value: number | null; start: number | null; changeBp: number | null } {
  const value = holdingsTotal === null ? (track === "CONSULTING" ? cash : null) : cash + holdingsTotal;
  const start =
    track === "FINANCE"
      ? RULES.START_CASH_FINANCE
      : track === "PRODUCT"
        ? ipoPrice === null
          ? null
          : RULES.RETAINED_SHARES * ipoPrice + RULES.SEED_SHARES * RULES.SEED_PRICE
        : 0;
  const changeBp = value === null || start === null || start === 0 ? null : Math.round(((value - start) * 10_000) / start);
  return { value, start, changeBp };
}
