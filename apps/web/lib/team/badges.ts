// Badges: small achievements a team collects during the night, shown on its Home. Each track has its own set; a
// badge is earned from facts the team can already see about itself (public.team_badge_facts) and its value now.
// Badges change nothing in the game: no score, price or ranking depends on them. Pure, so it is unit-tested.

import { RULES, type SubmissionType, type Track } from "@msim/engine";

export interface BadgeFacts {
  track: Track;
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
  test: (f: BadgeFacts) => boolean;
}

const ALL: readonly Track[] = ["PRODUCT", "CONSULTING", "FINANCE"];
const SQUAD: readonly Track[] = ["PRODUCT", "CONSULTING"];
const price = (f: BadgeFacts) => f.company?.closing ?? f.company?.market ?? null;
const score = (f: BadgeFacts, t: SubmissionType) => f.scores[t] ?? -1;

const RULES_LIST: readonly Rule[] = [
  { key: "TEAM_TALK", icon: "💬", name: "Team talker", how: "Send 5 messages in your squad chat.", tracks: ALL, test: (f) => f.messages >= 5 },
  // Product and Consulting: the squad's writing.
  { key: "LAUNCH", icon: "🚀", name: "Launch day", how: "Submit the pitch card on time.", tracks: SQUAD, test: (f) => f.submitted.includes("PITCH") },
  { key: "STAR_PITCH", icon: "⭐", name: "Star pitch", how: "Score 80 or more on the pitch.", tracks: SQUAD, test: (f) => score(f, "PITCH") >= 80 },
  { key: "RESCUE_HERO", icon: "🛟", name: "Rescue hero", how: "Score 80 or more on the rescue plan.", tracks: SQUAD, test: (f) => score(f, "PLAN") >= 80 },
  { key: "QUICK_THINKER", icon: "⚡", name: "Quick thinker", how: "Score 70 or more on the flash answer.", tracks: SQUAD, test: (f) => score(f, "FLASH") >= 70 },
  // Product: its own company.
  { key: "GOOD_LISTENER", icon: "🙋", name: "Good listener", how: "Answer 3 investors' questions.", tracks: ["PRODUCT"], test: (f) => f.answersGiven >= 3 },
  {
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
  { key: "FAIR_FEE", icon: "💼", name: "Fair fee", how: "Agree the fee with your Product team (not the default).", tracks: ["CONSULTING"], test: (f) => f.feeAgreed },
  { key: "SHARP_EYE", icon: "🎯", name: "Sharp eye", how: "Make a correct BUY or SELL call.", tracks: ["CONSULTING"], test: (f) => f.callsCorrect >= 1 },
  { key: "FORTUNE_TELLER", icon: "🔮", name: "Fortune teller", how: "Make 4 correct calls.", tracks: ["CONSULTING"], test: (f) => f.callsCorrect >= 4 },
  // The rescue deal, for all three teams of the squad.
  { key: "EARLY_DEAL", icon: "🤝", name: "Handshake", how: "Get the rescue deal signed before the bonus deadline.", tracks: ALL, test: (f) => f.dealEarly },
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
  const mine = RULES_LIST.filter((r) => r.tracks.includes(f.track)).map((r) => ({
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
