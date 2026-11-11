// The fixed numbers of the game, in one place. Money in cents, rates in basis points.

export const RULES = {
  SHARES_PER_COMPANY: 100_000,
  RETAINED_SHARES: 60_000,
  SEED_SHARES: 5_000,
  SEED_PRICE: 1_000, // $10.00
  IPO_SHARES: 35_000,
  BASE_PRICE: 1_000, // IPO price = $10.00 × (1 + pitch tier)

  START_CASH_FINANCE: 50_000_000, // $500,000

  IPO_MAX_PER_COMPANY: 4_000,
  IPO_ROUND_TO: 10,

  LONG_LIMIT: 4_000, // per company, exchange lot (IPO + trading)
  SHORT_LIMIT: 2_000, // per company
  SHORT_EXPOSURE_LIMIT: 25_000_000, // $250,000
  RESERVE_PCT: 110, // cash reserve for a buy: qty × price × 1.10
  COLLATERAL_PCT: 150, // collateral: 150% of short value

  // Price change per round: 1% per 1,000 net shares, capped at ±10%.
  // new = old × (100,000 + clamp(net, −10,000, 10,000)) ÷ 100,000
  CLEARING_DEN: 100_000,
  NET_CAP: 10_000,

  CRISIS_PCT: 85, // −15%

  FEE_MIN: 1_000_000, // $10,000
  FEE_MAX: 3_500_000, // $35,000
  FEE_MAX_SHARES: 3_000,
  FEE_DEFAULT: 2_250_000, // $22,500 cash

  DEAL_MIN: 4_000_000, // $40,000
  DEAL_MAX: 8_000_000, // $80,000
  DEAL_BONUS: 500_000, // $5,000

  PLAN_CAP_WITHOUT_DEAL: 50,
  PLAN_BONUS_PER_POINT: 50_000, // $500
  PLAN_BONUS_MIN: -1_000_000, // −$10,000
  PLAN_BONUS_MAX: 2_500_000, // +$25,000

  CALL_EARNING: 250_000, // $2,500

  INJECTION_PENALTY: 10,

  WORD_LIMIT: { PITCH: 400, PLAN: 500, FLASH: 100, QA_ANSWER: 100 },

  FLAG_CAP_FUNDS: 3, // flag 1: ≥3 funds at the long cap
  FLAG_COSINE: { NUM: 9, DEN: 10 }, // flag 2: cosine ≥ 0.9
  FLAG_MIN_ORDERS: 5,
  FLAG_FEE: 3_300_000, // flag 3: fee ≥ $33,000
  FLAG_DEAL_PCT: 55, // flag 3: deal price ≤ 55% of post-crisis price
  FLAG_PLAN_BELOW: 50,
} as const;
