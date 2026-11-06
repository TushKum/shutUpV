// The fixed numbers of the game, in one place. Money and prices in cents, rates in basis points.

export const RULES = {
  SHARES_PER_COMPANY: 100_000, // for display (market value); there is no supply limit

  // Round 1: starting share price = $10.00 + $0.10 × (PRD score − 50).
  START_BASE: 1_000, // $10.00
  START_PER_POINT: 10, // $0.10

  // The crisis: every price × 0.85.
  CRISIS_PCT: 85,

  // Round 2: price × (1 + 0.5% × (crisis score − 50)), i.e. 50 basis points per point.
  REVEAL_BP_PER_POINT: 50,

  // Round 3.
  START_CASH: 10_000_000, // $100,000 per team
  HOLD_LIMIT: 5_000, // shares of any one company, owned plus pending buys
  RESERVE_PCT: 110, // a buy reserves qty × price × 1.10
  // Clearing: 1% per 1,000 net shares, capped at ±10%: new = old × (100,000 + clamp(net, −10,000, 10,000)) ÷ 100,000.
  CLEARING_DEN: 100_000,
  NET_CAP: 10_000,
  ROUNDS: 9,
  CLOSE_ROUNDS: [8, 9] as readonly number[], // the market price at the close is the average of these clearings

  // Round 3 points = 50 + 2.5 × return %, kept between 0 and 100, rounded half-up.
  R3_BASE_POINTS: 50,

  // The AI judges: three readings, the median counts.
  JUDGE_RUNS: 3,
  INJECTION_PENALTY: 10,

  WORD_LIMIT: { PRD: 800, SOLUTION: 500 },
  QA_QUESTION_CHARS: 300,
  QA_ANSWER_WORDS: 150,
  QA_ANSWER_CHARS: 1_500,

  // Collusion flags.
  FLAG_LARGE_POSITION: 4_000, // flag 2: at least this many shares in a company that closed below the average cost
  FLAG_CAP_TEAMS: 5, // flag 3: at least this many teams reaching the limit on one company in one round
} as const;
