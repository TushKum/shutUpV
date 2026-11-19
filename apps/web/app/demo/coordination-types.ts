export interface FinanceTeamState {
  code: string;
  name: string;
  initialCapital: number;
  availableCapital: number;
  focus: string;
  lastAction: string;
}

export interface LiveRaiseRequest {
  id: number;
  productCode: string;
  amount: number;
  equityPct: number;
  impliedValuation: number;
  note?: string;
  status: "OPEN" | "FUNDED" | "CANCELLED";
  fundedBy?: string;
  fundedByName?: string;
  passedBy: string[];
  createdAt: string;
  closedAt?: string;
}

export interface FinanceEquityDeal {
  id: string;
  requestId: number;
  financeCode: string;
  financeName: string;
  productCode: string;
  company: string;
  ticker: string;
  sector: string;
  amountInvested: number;
  equityPct: number;
  impliedValuation: number;
  closedAt: string;
}

export interface RaiseRecord {
  id: number;
  amount: number;
  equityPct: number;
  note?: string;
  status: "BROADCASTING" | "FUNDED";
  status: "BROADCASTING" | "FUNDED" | "CANCELLED";
  fundedBy?: string;
  fundedByName?: string;
  timestamp: string;
}

export interface ProductTeamState {
  code: string;
  company: string;
  ticker: string;
  sector: string;
  pitchLine: string;
  topic: string;
  defaultR2Offer: number;
  defaultR3AuctionOffer: number;
  incomingR2Lock?: boolean;
  incomingR3Lock?: boolean;
  r1Score: number;
  r1MvpParts: string[];
  r1SubmittedAt: string | null;
  crisisCategory: string;
  crisisTitle: string;
  crisisBody: string;
  baselineContext: string;
  r3FallbackCrisisCategory: string;
  r3FallbackCrisisTitle: string;
  r3FallbackCrisisBody: string;
  r3FallbackBaseline: string;
  raisedCash: number;
  equityGivenPct: number;
  raiseHistory: RaiseRecord[];
  r2MvpParts: string[];
  r2MvpSubmittedAt: string | null;
  r3MvpParts: string[];
  r3MvpSubmittedAt: string | null;
}

export interface ConsultingSolutionPreset {
  diagnosis: string;
  recommendation: string;
  perPackMaths: string;
  timeline: string;
  risks: string;
}

export interface ConsultingTeamState {
  code: string;
  r1Score: number;
  baseValue: number;
  speciality: string;
  defaultCounterMarkupPct: number;
  defaultR3MarkupPct: number;
  r1SolutionParts: string[];
  r1SubmittedAt: string | null;
  presetSolution: ConsultingSolutionPreset;
}

export type R2DealStage =
  | "OFFERED"
  | "PROPOSAL_SENT"
  | "COUNTER_DEMANDED"
  | "DEAL_AGREED_UNLOCKED"
  | "DECLINED";

export interface R2DealRecord {
  key: string; // `${productCode}__${consultingCode}`
  productCode: string;
  consultingCode: string;
  baseValue: number;
  initialOffer: number;
  currentPrice: number;
  currentMarkupPct: number;
  stage: R2DealStage;
  pendingPrice?: number;
  pendingMarkupPct?: number;
  lockInitiatedBy: "NONE" | "PRODUCT" | "CONSULTING";
  productLockAccepted: boolean;
  consultingLockAccepted: boolean;
  lockedAt?: string;
  r2SolutionParts: string[];
  r2SolutionSubmittedAt: string | null;
  updatedAt: string;
}

export type R3IncumbentStatus =
  | "AWAITING_CONSULTANT_ASK"
  | "CONSULTANT_ASKED"
  | "ACCEPTED_LOCKED"
  | "REJECTED_REBIDDING";

export interface R3IncumbentRecord {
  key: string; // `${productCode}__${consultingCode}`
  productCode: string;
  consultingCode: string;
  baseValue: number;
  requestedPct: number;
  requestedPrice: number;
  status: R3IncumbentStatus;
  decidedAt?: string;
  removedByProduct?: boolean;
}

export interface R3AuctionDealRecord {
  key: string; // `${productCode}__${consultingCode}`
  productCode: string;
  consultingCode: string;
  baseValue: number;
  initialOffer: number;
  currentPrice: number;
  currentMarkupPct: number;
  stage: R2DealStage;
  pendingPrice?: number;
  pendingMarkupPct?: number;
  lockInitiatedBy: "NONE" | "PRODUCT" | "CONSULTING";
  productLockAccepted: boolean;
  consultingLockAccepted: boolean;
  lockedAt?: string;
}

export interface R3FinalLockRecord {
  key: string; // `${productCode}__${consultingCode}`
  productCode: string;
  consultingCode: string;
  finalPrice: number;
  markupPct: number;
  source: "INCUMBENT_ACCEPTED" | "RETURNED_TO_INCUMBENT" | "REBID_AUCTION";
  lockedAt: string;
  r3SolutionParts: string[];
  r3SolutionSubmittedAt: string | null;
}

export interface ProblemStatementState {
  id: string;
  title: string;
  sector: string;
  brief: string;
  crisisTwist: string;
  claimedBy?: string;
  claimedByName?: string;
  claimedAt?: string;
}

export interface DraftQueueEntryState {
  rank: number;
  code: string;
  company: string;
  cash: number;
  status: "CLAIMED" | "YOUR_TURN" | "UPCOMING";
  pickedStatementId?: string;
}

export interface QaItemState {
  id: number;
  team: string;
  targetCompany: string;
  q: string;
  a: string | null;
  answeredBy?: string;
  createdAt: string;
}

export interface CoordinationEvent {
  id: string;
  timestamp: string;
  actor: string;
  track: "PRODUCT" | "CONSULTING" | "FINANCE" | "SYSTEM";
  round: "R1" | "R2" | "R3" | "QA";
  summary: string;
}

export interface CoordinationState {
  version: number;
  updatedAt: string;
  products: Record<string, ProductTeamState>;
  productOrder: string[];
  consultants: Record<string, ConsultingTeamState>;
  consultantOrder: string[];
  financeTeams: FinanceTeamState[];
  raiseRequests: LiveRaiseRequest[];
  financeDeals: FinanceEquityDeal[];
  r2Deals: Record<string, R2DealRecord>;
  r3Incumbents: Record<string, R3IncumbentRecord>;
  r3AuctionDeals: Record<string, R3AuctionDealRecord>;
  r3Locks: Record<string, R3FinalLockRecord>;
  r3Statements: ProblemStatementState[];
  r3DraftQueue: DraftQueueEntryState[];
  qaItems: QaItemState[];
  events: CoordinationEvent[];
}

export type CoordinationAction =
  | { type: "RESET" }
  | {
      type: "PRODUCT_R1_UPDATE";
      productCode: string;
      company: string;
      ticker: string;
      sector: string;
      pitchLine: string;
      mvpParts: string[];
    }
  | {
      type: "PRODUCT_R1_SUBMIT";
      productCode: string;
      company: string;
      ticker: string;
      sector: string;
      pitchLine: string;
      mvpParts: string[];
    }
  | {
      type: "CONSULTING_R1_UPDATE";
      consultingCode: string;
      solutionParts: string[];
    }
  | {
      type: "CONSULTING_R1_SUBMIT";
      consultingCode: string;
      solutionParts: string[];
    }
  | {
      type: "PRODUCT_RAISE_BROADCAST";
      productCode: string;
      amount: number;
      equityPct: number;
      note?: string;
    }
  | {
      type: "PRODUCT_RAISE_CANCEL";
      productCode: string;
      requestId: number;
    }
  | {
      type: "FINANCE_CLOSE_DEAL";
      financeCode: string;
      requestId: number;
    }
  | {
      type: "FINANCE_PASS_REQUEST";
      financeCode: string;
      requestId: number;
    }
  | {
      type: "FINANCE_UNPASS_REQUEST";
      financeCode: string;
      requestId: number;
    }
  | {
      type: "R2_PRODUCT_SEND_PROPOSAL";
      productCode: string;
      consultingCode: string;
    }
  | {
      type: "R2_CONSULTING_PUSH_DEMAND";
      productCode: string;
      consultingCode: string;
      markupPct: number;
    }
  | {
      type: "R2_CONSULTING_ACCEPT_PROPOSAL";
      productCode: string;
      consultingCode: string;
    }
  | {
      type: "R2_PRODUCT_ACCEPT_DEMAND";
      productCode: string;
      consultingCode: string;
    }
  | {
      type: "R2_PRODUCT_DECLINE_DEMAND";
      productCode: string;
      consultingCode: string;
    }
  | {
      type: "R2_SEND_LOCK_REQUEST";
      productCode: string;
      consultingCode: string;
      initiatedBy: "PRODUCT" | "CONSULTING";
    }
  | {
      type: "R2_ACCEPT_LOCK_REQUEST";
      productCode: string;
      consultingCode: string;
      acceptedBy: "PRODUCT" | "CONSULTING";
      bypassCashCheck?: boolean;
    }
  | {
      type: "R2_DECLINE_LOCK_REQUEST";
      productCode: string;
      consultingCode: string;
      declinedBy: "PRODUCT" | "CONSULTING";
    }
  | {
      type: "R2_CONSULTING_SAVE_SOLUTION";
      productCode: string;
      consultingCode: string;
      parts: string[];
    }
  | {
      type: "R2_CONSULTING_SUBMIT_SOLUTION";
      productCode: string;
      consultingCode: string;
      parts: string[];
    }
  | {
      type: "R2_PRODUCT_SAVE_MVP";
      productCode: string;
      parts: string[];
    }
  | {
      type: "R2_PRODUCT_SUBMIT_MVP";
      productCode: string;
      parts: string[];
    }
  | {
      type: "R3_CONSULTING_ASK_INCUMBENT";
      productCode: string;
      consultingCode: string;
      increasePct: number;
    }
  | {
      type: "R3_PRODUCT_ACCEPT_INCUMBENT";
      productCode: string;
      consultingCode: string;
    }
  | {
      type: "R3_PRODUCT_REMOVE_INCUMBENT";
      productCode: string;
      consultingCode: string;
    }
  | {
      type: "R3_PRODUCT_RETURN_TO_INCUMBENT";
      productCode: string;
      consultingCode: string;
    }
  | {
      type: "R3_PRODUCT_SEND_REBID";
      productCode: string;
      consultingCode: string;
    }
  | {
      type: "R3_CONSULTING_PUSH_AUCTION_DEMAND";
      productCode: string;
      consultingCode: string;
      markupPct: number;
    }
  | {
      type: "R3_PRODUCT_ACCEPT_AUCTION_DEMAND";
      productCode: string;
      consultingCode: string;
    }
  | {
      type: "R3_SEND_AUCTION_LOCK";
      productCode: string;
      consultingCode: string;
      initiatedBy: "PRODUCT" | "CONSULTING";
    }
  | {
      type: "R3_ACCEPT_AUCTION_LOCK";
      productCode: string;
      consultingCode: string;
      acceptedBy: "PRODUCT" | "CONSULTING";
    }
  | {
      type: "R3_PICK_STATEMENT";
      productCode: string;
      statementId: string;
    }
  | {
      type: "R3_SIMULATE_NEXT_DRAFT_PICK";
    }
  | {
      type: "R3_CONSULTING_SAVE_SOLUTION";
      productCode: string;
      consultingCode: string;
      parts: string[];
    }
  | {
      type: "R3_CONSULTING_SUBMIT_SOLUTION";
      productCode: string;
      consultingCode: string;
      parts: string[];
    }
  | {
      type: "R3_PRODUCT_SAVE_MVP";
      productCode: string;
      parts: string[];
    }
  | {
      type: "R3_PRODUCT_SUBMIT_MVP";
      productCode: string;
      parts: string[];
    }
  | {
      type: "QA_POST_QUESTION";
      team: string;
      targetCompany: string;
      q: string;
    }
  | {
      type: "QA_ANSWER_QUESTION";
      questionId: number;
      answeredBy: string;
      a: string;
    };

export function pairKey(productCode: string, consultingCode: string): string {
  return `${productCode}__${consultingCode}`;
}

export function nowIst(): string {
  return (
    new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }) + " IST"
  );
}

const SEED_PRODUCTS: ProductTeamState[] = [
  {
    code: "XP01",
    company: "AquaCare",
    ticker: "QAAC",
    sector: "SECTOR 01 · FMCG & CONSUMER",
    pitchLine:
      "Zero-sugar electrolyte hydration pouch under ₹20 built for Indian school tiffins and hot transit.",
    topic: "FMCG · Functional Hydration & School Tiffin Packs",
    defaultR2Offer: 40000,
    defaultR3AuctionOffer: 40000,
    incomingR2Lock: false,
    incomingR3Lock: false,
    r1Score: 68,
    r1MvpParts: Array(7).fill(""),
    r1SubmittedAt: null,
    crisisCategory: "CRISIS CARD #7 · GST TAX & MARGIN SHOCK",
    crisisTitle: "GST rises from 12% to 18% while retailers demand higher shelf margin",
    crisisBody:
      "The GST on AquaCare's functional beverage category rises from 12% to 18% from next month. Retail distribution chains refuse to absorb the tax hike and demand an extra 3% shelf margin to keep the packs at eye level.",
    baselineContext:
      "Product topic baseline: ₹20 MRP pack, ₹12 COGS, ₹2.60 channel margin, break-even at 40,000 packs/month. Both XP01 and your consulting team receive this exact crisis to solve together.",
    r3FallbackCrisisCategory: "ROUND 3 CRISIS #11 · NATIONAL RETAILER DELISTING & COPYCAT WAR",
    r3FallbackCrisisTitle: "Largest modern-trade chain delists AquaCare for a private-label clone at ₹14",
    r3FallbackCrisisBody:
      "India's largest supermarket chain (38% of AquaCare's urban volume) launches its own ₹14 school hydration pack copying AquaCare's formula and demands a ₹1.5 Cr slotting fee within 14 days to keep AquaCare on shelves.",
    r3FallbackBaseline:
      "Post-Round 2 baseline: ₹21 pack price, ₹13.20 unit cost, 55,000 packs/month volume. Both XP01 and your consulting team must solve this Round 3 crisis together.",
    raisedCash: 0,
    equityGivenPct: 0,
    raiseHistory: [],
    r2MvpParts: Array(6).fill(""),
    r2MvpSubmittedAt: null,
    r3MvpParts: Array(6).fill(""),
    r3MvpSubmittedAt: null,
  },
  {
    code: "XP04",
    company: "FreshPack Foods",
    ticker: "FRPK",
    sector: "SECTOR 01 · FMCG & CONSUMER",
    pitchLine: "Ambient 90-day ready-to-eat regional meal pouches under ₹45 for hostel & student living.",
    topic: "D2C FoodTech · Ready-to-Eat Meal Pouches",
    defaultR2Offer: 38000,
    defaultR3AuctionOffer: 40000,
    incomingR2Lock: false,
    incomingR3Lock: false,
    r1Score: 74,
    r1MvpParts: Array(7).fill(""),
    r1SubmittedAt: "22:42:10 IST",
    crisisCategory: "CRISIS CARD #5 · PACKAGING BAN & RECALL",
    crisisTitle: "State ban on multi-layer plastic pouches forces immediate packaging switch",
    crisisBody:
      "A state plastic-waste directive bans multi-layer retort pouches within 30 days. Simultaneously, one batch failed a seal-integrity test in hot transit and must be recalled from 1,200 stores.",
    baselineContext:
      "Product topic baseline: ₹45 MRP pouch, ₹26 COGS, 90-day shelf life requirement. Both XP04 and your consulting team receive this exact crisis to solve together.",
    r3FallbackCrisisCategory: "ROUND 3 CRISIS #14 · COLD-CHAIN COLLAPSE & QUICK-COMMERCE EXCLUSIVITY",
    r3FallbackCrisisTitle: "Two quick-commerce platforms demand 32% take-rate or dark-store removal",
    r3FallbackCrisisBody:
      "Blinkit and Zepto account for 64% of FreshPack's daily orders. Both platforms simultaneously raise dark-store commissions from 18% to 32% and require category exclusivity within 10 days.",
    r3FallbackBaseline:
      "Post-Round 2 baseline: ₹48 MRP pouch, ₹27.50 unit cost, ₹12 Cr annual run-rate. Both XP04 and your consulting team must solve this Round 3 crisis together.",
    raisedCash: 45000,
    equityGivenPct: 4,
    raiseHistory: [],
    r2MvpParts: Array(6).fill(""),
    r2MvpSubmittedAt: null,
    r3MvpParts: Array(6).fill(""),
    r3MvpSubmittedAt: null,
  },
  {
    code: "XP09",
    company: "GridWise Energy",
    ticker: "GRID",
    sector: "SECTOR 03 · HEALTHTECH & CLEANTECH",
    pitchLine: "Room-level prepaid hostel & campus smart sub-meters cutting peak AC waste by 30%.",
    topic: "CleanTech · Smart Hostel & Campus Micro-Meters",
    defaultR2Offer: 42000,
    defaultR3AuctionOffer: 45000,
    incomingR2Lock: true,
    incomingR3Lock: true,
    r1Score: 79,
    r1MvpParts: Array(7).fill(""),
    r1SubmittedAt: "22:48:30 IST",
    crisisCategory: "CRISIS CARD #3 · CHIP SHORTAGE & TARIFF HIKE",
    crisisTitle: "Import duty on telemetry modules jumps 22% amid 8-week supplier lead-time spike",
    crisisBody:
      "The imported IoT metering chipset faces an immediate 22% customs duty hike and an 8-week shipment delay from Shenzhen, threatening GridWise's guaranteed campus installation SLAs.",
    baselineContext:
      "Product topic baseline: ₹3,200 hardware unit + ₹180/mo SaaS fee, 35% gross hardware margin. Both XP09 and your consulting team receive this exact crisis to solve together.",
    r3FallbackCrisisCategory: "ROUND 3 CRISIS #09 · DISCOM REGULATORY BLOCK & FIRMWARE BREACH",
    r3FallbackCrisisTitle: "State electricity board halts private sub-metering after a campus billing dispute",
    r3FallbackCrisisBody:
      "Two state electricity utilities issue an interim stay on third-party hostel sub-meters unless certified under a new BIS smart-grid standard within 45 days, freezing ₹8.5 Cr of signed campus deployments.",
    r3FallbackBaseline:
      "Post-Round 2 baseline: ₹3,400 hardware unit + ₹200/mo SaaS, 42 campuses live. Both XP09 and your consulting team must solve this Round 3 crisis together.",
    raisedCash: 82000,
    equityGivenPct: 5,
    raiseHistory: [],
    r2MvpParts: Array(6).fill(""),
    r2MvpSubmittedAt: null,
    r3MvpParts: Array(6).fill(""),
    r3MvpSubmittedAt: null,
  },
  {
    code: "XP12",
    company: "Nova Nutrition",
    ticker: "NOVA",
    sector: "SECTOR 03 · HEALTHTECH & CLEANTECH",
    pitchLine: "Daily single-serve protein & micronutrient sachets tailored for Indian vegetarians.",
    topic: "HealthTech · Personalised Protein & Micronutrient Sachets",
    defaultR2Offer: 35000,
    defaultR3AuctionOffer: 35000,
    incomingR2Lock: false,
    incomingR3Lock: false,
    r1Score: 71,
    r1MvpParts: Array(7).fill(""),
    r1SubmittedAt: "22:35:05 IST",
    crisisCategory: "CRISIS CARD #9 · INGREDIENT SPIKE & LABELLING ORDER",
    crisisTitle: "Whey isolate costs jump 26% while FSSAI mandates immediate claim removal",
    crisisBody:
      "Global whey isolate prices surge 26% in one quarter while FSSAI requires front-of-pack clinical claims to be removed within 21 days, threatening Nova Nutrition's retail rollout.",
    baselineContext:
      "Product topic baseline: ₹60 MRP sachet, ₹35 COGS, 58% repeat subscription rate. Both XP12 and your consulting team receive this exact crisis to solve together.",
    r3FallbackCrisisCategory: "ROUND 3 CRISIS #16 · FSSAI LABELLING MANDATE & WHEY SPIKE",
    r3FallbackCrisisTitle: "Whey isolate costs jump 28% while FSSAI bans 'clinical recovery' claims",
    r3FallbackCrisisBody:
      "Global whey isolate prices surge 28% quarter-on-quarter just as FSSAI orders removal of 'clinical recovery' front-of-pack claims within 21 days, putting ₹4.2 Cr of packaged inventory at risk.",
    r3FallbackBaseline:
      "Post-Round 2 baseline: ₹65 sachet, ₹38 COGS, 62% repeat subscription rate. Both XP12 and your consulting team must solve this Round 3 crisis together.",
    raisedCash: 52000,
    equityGivenPct: 5,
    raiseHistory: [],
    r2MvpParts: Array(6).fill(""),
    r2MvpSubmittedAt: null,
    r3MvpParts: Array(6).fill(""),
    r3MvpSubmittedAt: null,
  },
  {
    code: "XP15",
    company: "Orbit Health",
    ticker: "ORBI",
    sector: "SECTOR 03 · HEALTHTECH & CLEANTECH",
    pitchLine: "₹299 doorstep preventive metabolic diagnostic kits for Tier-2 and Tier-3 households.",
    topic: "HealthTech · Home Preventive Diagnostic Kits",
    defaultR2Offer: 45000,
    defaultR3AuctionOffer: 42000,
    incomingR2Lock: true,
    incomingR3Lock: false,
    r1Score: 84,
    r1MvpParts: Array(7).fill(""),
    r1SubmittedAt: "22:50:19 IST",
    crisisCategory: "CRISIS CARD #2 · REAGENT TARIFF & LAB AUDIT",
    crisisTitle: "Imported diagnostic reagent duty rises 18% alongside stricter NABL checks",
    crisisBody:
      "A sudden 18% customs duty on imported blood-test reagents and mandatory NABL cold-chain compliance push Orbit Health's per-kit cost past its advertised ₹299 diagnostic bundle.",
    baselineContext:
      "Product topic baseline: ₹299 test kit, ₹168 lab + logistics cost, 44% gross margin. Both XP15 and your consulting team receive this exact crisis to solve together.",
    r3FallbackCrisisCategory: "ROUND 3 CRISIS #19 · DIAGNOSTIC COMPLIANCE & LOGISTICS FREEZE",
    r3FallbackCrisisTitle: "Cold-chain courier strike stalls 60% of Tier-2 diagnostic sample pickups",
    r3FallbackCrisisBody:
      "A regional cold-chain courier strike cuts sample collection capacity by 60% just as hospital chains launch a bundled ₹249 preventive checkup in Orbit Health's top 8 cities.",
    r3FallbackBaseline:
      "Post-Round 2 baseline: ₹299 kit, ₹162 unit cost, 18,000 kits/month. Both XP15 and your consulting team must solve this Round 3 crisis together.",
    raisedCash: 61000,
    equityGivenPct: 4,
    raiseHistory: [],
    r2MvpParts: Array(6).fill(""),
    r2MvpSubmittedAt: null,
    r3MvpParts: Array(6).fill(""),
    r3MvpSubmittedAt: null,
  },
  {
    code: "XP18",
    company: "MintFlow Pay",
    ticker: "MINT",
    sector: "SECTOR 02 · FINTECH & PAYMENTS",
    pitchLine: "Automated UPI invoice reconciliation and 7-day working-capital float for kiranas.",
    topic: "FinTech · Kirana Working-Capital & UPI Reconciliation",
    defaultR2Offer: 48000,
    defaultR3AuctionOffer: 48000,
    incomingR2Lock: false,
    incomingR3Lock: true,
    r1Score: 86,
    r1MvpParts: Array(7).fill(""),
    r1SubmittedAt: "22:51:04 IST",
    crisisCategory: "CRISIS CARD #4 · SETTLEMENT DELAY & NBFC SQUEEZE",
    crisisTitle: "Co-lending credit facility cut 35% as UPI settlements slip to T+2",
    crisisBody:
      "MintFlow's partner NBFC tightens small-merchant working-capital limits by 35% ahead of festive stocking while settlement lags push kiranas back to informal cash lenders.",
    baselineContext:
      "Product topic baseline: 1.7% blended take-rate, 19,000 active kiranas, ₹4.1 Cr monthly GMV. Both XP18 and your consulting team receive this exact crisis to solve together.",
    r3FallbackCrisisCategory: "ROUND 3 CRISIS #22 · NBFC LIQUIDITY SQUEEZE & SETTLEMENT DELAY",
    r3FallbackCrisisTitle: "Partner NBFC cuts credit line 40% as merchant settlements slip to T+3",
    r3FallbackCrisisBody:
      "MintFlow's primary lending partner slices its co-lending facility by 40% ahead of festive stocking while payment gateway settlement delays push small merchants toward cash competitors.",
    r3FallbackBaseline:
      "Post-Round 2 baseline: 1.8% blended take-rate, 24,000 active kiranas, ₹4.8 Cr monthly GMV. Both XP18 and your consulting team must solve this Round 3 crisis together.",
    raisedCash: 74000,
    equityGivenPct: 4,
    raiseHistory: [],
    r2MvpParts: Array(6).fill(""),
    r2MvpSubmittedAt: null,
    r3MvpParts: Array(6).fill(""),
    r3MvpSubmittedAt: null,
  },
  {
    code: "XP21",
    company: "Luma Living",
    ticker: "LUMA",
    sector: "SECTOR 01 · FMCG & CONSUMER",
    pitchLine: "Zero-plastic soluble home and hostel cleaning pods replacing liquid detergent bottles.",
    topic: "FMCG · Compostable Home & Hostel Cleaning Pods",
    defaultR2Offer: 35000,
    defaultR3AuctionOffer: 35000,
    incomingR2Lock: false,
    incomingR3Lock: false,
    r1Score: 72,
    r1MvpParts: Array(7).fill(""),
    r1SubmittedAt: "22:38:11 IST",
    crisisCategory: "CRISIS CARD #6 · SURFACTANT IMPORT SHOCK",
    crisisTitle: "Plant-based surfactant costs climb 24% while modern trade cuts shelf space",
    crisisBody:
      "Imported bio-surfactant prices surge 24% overnight just as national supermarket buyers demand an extra 4% introductory promotional rebate.",
    baselineContext:
      "Product topic baseline: ₹99 12-pod pack, ₹54 COGS, 38% repeat reorder rate. Both XP21 and your consulting team receive this exact crisis to solve together.",
    r3FallbackCrisisCategory: "ROUND 3 CRISIS #25 · SURFACTANT TARIFF & SHELF SQUEEZE",
    r3FallbackCrisisTitle: "Bio-surfactant supplier hikes prices 25% ahead of national chain renewal",
    r3FallbackCrisisBody:
      "Luma Living's primary green surfactant vendor raises contract prices 25% just before annual modern-trade renewal negotiations across 450 supermarkets.",
    r3FallbackBaseline:
      "Post-Round 2 baseline: ₹99 12-pod pack, ₹56 COGS, 38% repeat rate. Both XP21 and your consulting team must solve this Round 3 crisis together.",
    raisedCash: 40000,
    equityGivenPct: 5,
    raiseHistory: [],
    r2MvpParts: Array(6).fill(""),
    r2MvpSubmittedAt: null,
    r3MvpParts: Array(6).fill(""),
    r3MvpSubmittedAt: null,
  },
  {
    code: "XP24",
    company: "VitaCart",
    ticker: "VITA",
    sector: "SECTOR 01 · FMCG & CONSUMER",
    pitchLine: "High-protein millet breakfast bowls shipped fresh through urban quick-commerce.",
    topic: "D2C FoodTech · Cold-Pressed Millet Breakfast Bowls",
    defaultR2Offer: 45000,
    defaultR3AuctionOffer: 45000,
    incomingR2Lock: false,
    incomingR3Lock: false,
    r1Score: 80,
    r1MvpParts: Array(7).fill(""),
    r1SubmittedAt: "22:45:00 IST",
    crisisCategory: "CRISIS CARD #8 · DARK-STORE COMMISSION HIKE",
    crisisTitle: "Quick-commerce apps raise commission from 18% to 29% across Tier-1 hubs",
    crisisBody:
      "Quick-commerce accounts for 62% of VitaCart's daily sales; an 11-point fee jump wipes out contribution margin unless pack architecture and channels pivot.",
    baselineContext:
      "Product topic baseline: ₹75 MRP bowl, ₹41 COGS, 28,000 bowls/month. Both XP24 and your consulting team receive this exact crisis to solve together.",
    r3FallbackCrisisCategory: "ROUND 3 CRISIS #27 · MILLET INPUT SPIKE & DELIVERY FEE",
    r3FallbackCrisisTitle: "Grain procurement costs jump 19% alongside quick-commerce ad-spend floor",
    r3FallbackCrisisBody:
      "Seasonal millet shortages lift raw material costs by 19% while dark-store platforms enforce mandatory sponsored-slot minimums to stay in top search results.",
    r3FallbackBaseline:
      "Post-Round 2 baseline: ₹78 bowl MRP, ₹42 COGS, 32,000 bowls/month. Both XP24 and your consulting team must solve this Round 3 crisis together.",
    raisedCash: 55000,
    equityGivenPct: 4,
    raiseHistory: [],
    r2MvpParts: Array(6).fill(""),
    r2MvpSubmittedAt: null,
    r3MvpParts: Array(6).fill(""),
    r3MvpSubmittedAt: null,
  },
  {
    code: "XP27",
    company: "SolarNest",
    ticker: "SOLR",
    sector: "SECTOR 03 · HEALTHTECH & CLEANTECH",
    pitchLine: "Plug-and-play balcony solar micro-inverter kits for Indian urban apartments.",
    topic: "CleanTech · Modular Balcony Micro-Inverter Kits",
    defaultR2Offer: 50000,
    defaultR3AuctionOffer: 52000,
    incomingR2Lock: true,
    incomingR3Lock: true,
    r1Score: 89,
    r1MvpParts: Array(7).fill(""),
    r1SubmittedAt: "22:55:42 IST",
    crisisCategory: "CRISIS CARD #10 · PANEL DUTY & INSTALLATION BACKLOG",
    crisisTitle: "Solar cell safeguard duty rises 20% amid certified technician shortage",
    crisisBody:
      "A 20% import safeguard tariff on high-efficiency cells and a 5-week installer backlog threaten SolarNest's prepaid apartment-complex contracts.",
    baselineContext:
      "Product topic baseline: ₹18,500 kit, ₹11,900 BOM + install cost, 36% gross margin. Both XP27 and your consulting team receive this exact crisis to solve together.",
    r3FallbackCrisisCategory: "ROUND 3 CRISIS #29 · SAFEGUARD DUTY & WARRANTY CLAIM SPIKE",
    r3FallbackCrisisTitle: "20% import duty on cells hits while monsoon surge triggers inverter returns",
    r3FallbackCrisisBody:
      "A 20% cell tariff compresses hardware margins just as an early monsoon surge causes an 8% warranty replacement spike on first-generation balcony kits.",
    r3FallbackBaseline:
      "Post-Round 2 baseline: ₹18,500 kit, ₹12,100 landed cost, 1,400 installs/quarter. Both XP27 and your consulting team must solve this Round 3 crisis together.",
    raisedCash: 96000,
    equityGivenPct: 5,
    raiseHistory: [],
    r2MvpParts: Array(6).fill(""),
    r2MvpSubmittedAt: null,
    r3MvpParts: Array(6).fill(""),
    r3MvpSubmittedAt: null,
  },
  {
    code: "XP30",
    company: "KisanLink",
    ticker: "KISN",
    sector: "SECTOR 01 · FMCG & CONSUMER",
    pitchLine: "Modular farm-gate solar cold-storage pods slashing harvest spoilage by 45%.",
    topic: "AgriTech · Farm-Gate Cold Storage Micro-Pods",
    defaultR2Offer: 32000,
    defaultR3AuctionOffer: 32000,
    incomingR2Lock: false,
    incomingR3Lock: false,
    r1Score: 70,
    r1MvpParts: Array(7).fill(""),
    r1SubmittedAt: "22:31:50 IST",
    crisisCategory: "CRISIS CARD #12 · DIESEL FREIGHT SPIKE",
    crisisTitle: "Cold-van diesel tariffs jump 21% during peak harvest procurement",
    crisisBody:
      "Regional transport unions raise refrigerated freight rates by 21% while spoilage penalties tighten across Tier-2 mandi buyers.",
    baselineContext:
      "Product topic baseline: ₹2.40/kg storage fee, 82% pod utilisation required for break-even. Both XP30 and your consulting team receive this exact crisis to solve together.",
    r3FallbackCrisisCategory: "ROUND 3 CRISIS #31 · DIESEL SURGE & MANDI PAYMENT LAG",
    r3FallbackCrisisTitle: "Diesel freight rises 22% while regional mandi buyers stretch payout to 45 days",
    r3FallbackCrisisBody:
      "Rising refrigerated transport costs and delayed mandi receivables strain KisanLink's working capital right as peak summer harvest volumes arrive.",
    r3FallbackBaseline:
      "Post-Round 2 baseline: ₹2.50/kg fee, 84% pod utilisation. Both XP30 and your consulting team must solve this Round 3 crisis together.",
    raisedCash: 38000,
    equityGivenPct: 4,
    raiseHistory: [],
    r2MvpParts: Array(6).fill(""),
    r2MvpSubmittedAt: null,
    r3MvpParts: Array(6).fill(""),
    r3MvpSubmittedAt: null,
  },
];

const SEED_CONSULTANTS: ConsultingTeamState[] = [
  {
    code: "XC01",
    r1Score: 82,
    baseValue: 40000,
    speciality: "Pricing Turnarounds, GST Structuring & FMCG Margins",
    defaultCounterMarkupPct: 10,
    defaultR3MarkupPct: 15,
    r1SolutionParts: Array(6).fill(""),
    r1SubmittedAt: null,
    presetSolution: {
      diagnosis:
        "The 12% → 18% GST jump adds ₹1.07/pack tax burden while the 3% retailer margin demand adds ₹0.60/pack—wiping out ₹1.67/pack of contribution margin unless SKU architecture changes.",
      recommendation:
        "Re-architect the core SKU from a single ₹20 pouch to a ₹22 'Electrolyte+ Mini-Pack' (10% lighter volume, same hydration dose) while shifting 30% of volume to direct school-canteen bulk boxes.",
      perPackMaths:
        "New MRP ₹22.00 · Net realisation after 18% GST ₹18.64 · COGS ₹10.40 (re-sized pouch) · Retailer margin ₹3.10 (protected) · Net contribution ₹5.14/pack · Break-even drops to 34,000 packs/mo.",
      timeline:
        "Week 1: Lock Pune foil supplier for revised pack size. Week 2: Pilot ₹22 pack in 40 Tier-1 stores & sign 15 school canteens. Week 3–4: National distributor rollover.",
      risks:
        "If urban parents resist the ₹22 price point, launch a ₹99 5-pack value bundle (₹19.80/pack effective) for modern trade & quick-commerce.",
    },
  },
  {
    code: "XC02",
    r1Score: 76,
    baseValue: 35000,
    speciality: "Kirana Channel Economics & Value-Pack Redesign",
    defaultCounterMarkupPct: 0,
    defaultR3MarkupPct: 0,
    r1SolutionParts: Array(6).fill(""),
    r1SubmittedAt: "22:40:12 IST",
    presetSolution: {
      diagnosis:
        "General-trade stores drop impulse beverage SKUs the moment GST pushes retailer payout below ₹2.80 per pack.",
      recommendation:
        "Launch a ₹15 compact school-pack at higher gross margin while bundling 10-pack family pouches directly for kirana billing slabs.",
      perPackMaths:
        "Compact pack MRP ₹15.00 · Net after 18% GST ₹12.71 · COGS ₹7.20 · Retailer cut ₹2.30 · Net contribution ₹3.21/pack · Break-even at 36,000 packs/mo.",
      timeline:
        "Week 1: Re-tool pouch fill weight. Week 2: Ship 10-pack kirana bundles in 2 pilot districts. Week 3–4: Expand across regional distributors.",
      risks:
        "Distributor inventory resistance eased by offering 7-day credit on introductory bundle cartons.",
    },
  },
  {
    code: "XC04",
    r1Score: 78,
    baseValue: 36000,
    speciality: "Supply Chain Optimization & Retail Distribution",
    defaultCounterMarkupPct: 0,
    defaultR3MarkupPct: 0,
    r1SolutionParts: Array(6).fill(""),
    r1SubmittedAt: "22:41:55 IST",
    presetSolution: {
      diagnosis:
        "Unchanged MRP under 18% GST plus higher retailer demands compresses contribution margin below working-capital break-even within 45 days.",
      recommendation:
        "Consolidate regional co-packers to cut COGS by 11% and offer retailers volume-linked quarterly rebates instead of flat upfront shelf margins.",
      perPackMaths:
        "MRP ₹20.00 · Net after 18% GST ₹16.95 · New COGS ₹10.65 · Channel margin ₹2.60 + ₹0.40 rebate · Net contribution ₹3.30/pack · Break-even at 38,500 packs/mo.",
      timeline:
        "Week 1: Renegotiate toll-manufacturing contract. Week 2: Roll out tiered distributor slab. Week 3–4: Replenish top 300 outlets.",
      risks:
        "Single co-packer concentration risk mitigated by retaining secondary supplier at 20% standby volume.",
    },
  },
  {
    code: "XC07",
    r1Score: 88,
    baseValue: 46000,
    speciality: "High-Margin D2C Positioning & Crisis Recovery",
    defaultCounterMarkupPct: 20,
    defaultR3MarkupPct: 15,
    r1SolutionParts: Array(6).fill(""),
    r1SubmittedAt: "22:53:09 IST",
    presetSolution: {
      diagnosis:
        "Retailers hold pricing leverage because 85% of revenue depends on general trade; the GST hike exposes weak channel diversification.",
      recommendation:
        "Reposition into a dual-tier MVP: keep an entry ₹20 sachet in kiranas while launching a ₹149 weekly school-hydration subscription box direct to parents via WhatsApp & D2C.",
      perPackMaths:
        "D2C 7-pack at ₹149 (₹21.28/pack) eliminates ₹2.90 distributor cut; blended gross margin rises from 27% to 41% within 6 weeks.",
      timeline:
        "Week 1: Launch WhatsApp subscription MVP flow. Week 2: Partner with 25 parent communities. Week 3–4: Rebalance retail allocation to top-performing stores.",
      risks:
        "Higher D2C delivery cost offset by restricting subscriptions to multi-pack weekly drops.",
    },
  },
  {
    code: "XC09",
    r1Score: 86,
    baseValue: 45000,
    speciality: "Modern-Trade Negotiation & Tax-Shield SKU Strategy",
    defaultCounterMarkupPct: 10,
    defaultR3MarkupPct: 0,
    r1SolutionParts: Array(6).fill(""),
    r1SubmittedAt: "22:47:20 IST",
    presetSolution: {
      diagnosis:
        "Passing the full 6% GST increase onto consumers without re-framing the SKU triggers a 22% volume drop in price-sensitive school markets.",
      recommendation:
        "Reclassify core hydration powder under fortified nutrition mix while launching institutional school-tiffin contracts that bypass modern-trade listing fees.",
      perPackMaths:
        "Institutional 20-pack box at ₹340 (₹17/pack) removes retail shelf fees; blended contribution climbs to ₹5.40/pack at 31,000 packs/mo break-even.",
      timeline:
        "Week 1: File fortified nutrition compliance & sample boxes. Week 2: Onboard 20 school nutrition vendors. Week 3–4: Re-price modern trade to ₹23 premium pack.",
      risks:
        "Institutional receivables cycle managed via 50% advance milestone invoices.",
    },
  },
  {
    code: "XC12",
    r1Score: 74,
    baseValue: 32000,
    speciality: "Cost Restructuring & Packaging Value Engineering",
    defaultCounterMarkupPct: 15,
    defaultR3MarkupPct: 10,
    r1SolutionParts: Array(6).fill(""),
    r1SubmittedAt: "22:36:40 IST",
    presetSolution: {
      diagnosis:
        "Combined tax and trade-margin shock cuts monthly operating cash flow by ₹6.8 lakh unless packaging and ingredient costs are re-engineered.",
      recommendation:
        "Switch to mono-material recyclable pouches (−₹1.20/pack) and introduce a ₹15 compact trial SKU alongside a ₹25 family pack.",
      perPackMaths:
        "Blended realization ₹19.10 net of GST · Blended COGS ₹10.50 · Trade margin ₹3.00 · Net contribution ₹5.60/unit.",
      timeline:
        "Week 1: Approve mono-material pouch print plates. Week 2: Test stability. Week 3–4: Dispatch dual-SKU assortment.",
      risks:
        "Transition inventory overlap managed via 15-day clearance discount on legacy stock.",
    },
  },
  {
    code: "XC15",
    r1Score: 84,
    baseValue: 42000,
    speciality: "Quick-Commerce Margin Defense & Trade Rebates",
    defaultCounterMarkupPct: 10,
    defaultR3MarkupPct: 10,
    r1SolutionParts: Array(6).fill(""),
    r1SubmittedAt: "22:44:15 IST",
    presetSolution: {
      diagnosis:
        "Simultaneous GST hike and retailer shelf-margin demands reduce contribution per pouch below ₹2.20 unless channel mix shifts.",
      recommendation:
        "Move 40% of urban demand to prepaid 8-pack bundles on quick-commerce while restructuring kirana payout into sell-through volume slabs.",
      perPackMaths:
        "8-pack bundle at ₹168 (₹21/pack) preserves 39% gross margin after 18% GST and delivery fees; break-even at 33,000 packs/mo.",
      timeline:
        "Week 1: Ship multi-pack cartons to top 40 dark stores. Week 2–4: Roll out slabbed distributor scheme nationally.",
      risks:
        "Dark-store listing fee inflation offset via co-funded festive combo listings.",
    },
  },
  {
    code: "XC18",
    r1Score: 79,
    baseValue: 38000,
    speciality: "Procurement Consolidation & Regional Co-Packing",
    defaultCounterMarkupPct: 0,
    defaultR3MarkupPct: 0,
    r1SolutionParts: Array(6).fill(""),
    r1SubmittedAt: "22:39:05 IST",
    presetSolution: {
      diagnosis:
        "Fragmented co-packers add ₹1.45/unit in waste and freight overhead, magnifying the 18% GST compression.",
      recommendation:
        "Lock a single western-corridor co-packer for 80% base volume (−12% unit COGS) and pass a modest ₹1 price adjustment on flagship pouches.",
      perPackMaths:
        "MRP ₹21.00 · Net after 18% GST ₹17.80 · COGS ₹10.55 · Trade margin ₹2.95 · Net contribution ₹4.30/pack.",
      timeline:
        "Week 1: Execute master toll-packing contract. Week 2: Re-print MRP stickers. Week 3–4: Restock priority Tier-1/2 retail belts.",
      risks:
        "Single-site disruption mitigated via 20% standby capacity in Gujarat.",
    },
  },
  {
    code: "XC21",
    r1Score: 90,
    baseValue: 50000,
    speciality: "Enterprise Turnaround, Brand Repricing & Institutional B2B",
    defaultCounterMarkupPct: 15,
    defaultR3MarkupPct: 15,
    r1SolutionParts: Array(6).fill(""),
    r1SubmittedAt: "22:57:02 IST",
    presetSolution: {
      diagnosis:
        "Retailers extract extra shelf margin only because the brand lacks high-visibility institutional pull.",
      recommendation:
        "Sign 50 school and sports-academy hydration contracts upfront to guarantee 45% baseline volume, then enforce firm ₹23 MRP across general trade.",
      perPackMaths:
        "Blended realization ₹19.80 net of GST · COGS ₹10.20 · Institutional + retail blended contribution ₹6.10/pack.",
      timeline:
        "Week 1: Close first 15 academy contracts. Week 2: Launch ₹23 premium pack. Week 3–4: Scale B2B replenishment cadence.",
      risks:
        "B2B payment cycles hedged with 30-day automated UPI mandate billing.",
    },
  },
  {
    code: "XC24",
    r1Score: 72,
    baseValue: 30000,
    speciality: "Lean Unit-Cost Engineering & Tier-2 Rollouts",
    defaultCounterMarkupPct: 0,
    defaultR3MarkupPct: 0,
    r1SolutionParts: Array(6).fill(""),
    r1SubmittedAt: "22:30:18 IST",
    presetSolution: {
      diagnosis:
        "High urban retail slotting costs make absorbing the 6% GST jump impossible without trimming packaging overhead.",
      recommendation:
        "Adopt lightweight refill sachets for Tier-2 kiranas (−₹1.50 COGS) and offer a 1-free-per-dozen trade incentive instead of permanent margin hikes.",
      perPackMaths:
        "MRP ₹20.00 · Net after 18% GST ₹16.95 · COGS ₹10.10 · Effective trade payout ₹2.85 · Net contribution ₹4.00/pack.",
      timeline:
        "Week 1: Finalise sachet tooling. Week 2: Pilot in 120 Tier-2 outlets. Week 3–4: Scale across regional stockists.",
      risks:
        "Lower shelf presence offset by compact countertop dispenser boxes.",
    },
  },
];

const SEED_FINANCE_TEAMS: FinanceTeamState[] = [
  { code: "XF01", name: "Vanguard Capital", availableCapital: 500000, focus: "FMCG & High-Velocity Consumer", lastAction: "Reviewing Round 1 MVPs" },
  { code: "XF02", name: "Apex Sovereign Fund", availableCapital: 460000, focus: "FinTech & B2B Infrastructure", lastAction: "Active · Open to equity pitches" },
  { code: "XF05", name: "Crestline Ventures", availableCapital: 520000, focus: "Turnaround & Growth Equity", lastAction: "Active · Open to equity pitches" },
  { code: "XF08", name: "Ironclad Partners", availableCapital: 390000, focus: "HealthTech & CleanTech", lastAction: "Reviewing Round 1 MVPs" },
  { code: "XF11", name: "Meridian Capital", availableCapital: 440000, focus: "Multi-Sector Seed & Bridge", lastAction: "Active · Open to equity pitches" },
  { code: "XF14", name: "Northstar Equity", availableCapital: 480000, focus: "Consumer Brands & D2C", lastAction: "Active · Open to equity pitches" },
  { code: "XF17", name: "Redwood Catalyst", availableCapital: 360000, focus: "Early-Stage Working Capital", lastAction: "Reviewing Round 1 MVPs" },
  { code: "XF20", name: "Helios Growth Fund", availableCapital: 550000, focus: "CleanTech & Campus Infra", lastAction: "Active · Open to equity pitches" },
  { code: "XF23", name: "Sterling Horizon", availableCapital: 410000, focus: "AgriTech & Supply Chain", lastAction: "Reviewing Round 1 MVPs" },
  { code: "XF26", name: "Kestrel Treasury", availableCapital: 495000, focus: "Balanced Multi-Sector Pool", lastAction: "Active · Open to equity pitches" },
  { code: "XF01", name: "Vanguard Capital", initialCapital: 500000, availableCapital: 500000, focus: "FMCG & High-Velocity Consumer", lastAction: "Reviewing Round 1 MVPs" },
  { code: "XF02", name: "Apex Sovereign Fund", initialCapital: 460000, availableCapital: 460000, focus: "FinTech & B2B Infrastructure", lastAction: "Active · Open to equity pitches" },
  { code: "XF05", name: "Crestline Ventures", initialCapital: 520000, availableCapital: 520000, focus: "Turnaround & Growth Equity", lastAction: "Active · Open to equity pitches" },
  { code: "XF08", name: "Ironclad Partners", initialCapital: 390000, availableCapital: 390000, focus: "HealthTech & CleanTech", lastAction: "Reviewing Round 1 MVPs" },
  { code: "XF11", name: "Meridian Capital", initialCapital: 440000, availableCapital: 440000, focus: "Multi-Sector Seed & Bridge", lastAction: "Active · Open to equity pitches" },
  { code: "XF14", name: "Northstar Equity", initialCapital: 480000, availableCapital: 480000, focus: "Consumer Brands & D2C", lastAction: "Active · Open to equity pitches" },
  { code: "XF17", name: "Redwood Catalyst", initialCapital: 360000, availableCapital: 360000, focus: "Early-Stage Working Capital", lastAction: "Reviewing Round 1 MVPs" },
  { code: "XF20", name: "Helios Growth Fund", initialCapital: 550000, availableCapital: 550000, focus: "CleanTech & Campus Infra", lastAction: "Active · Open to equity pitches" },
  { code: "XF23", name: "Sterling Horizon", initialCapital: 410000, availableCapital: 410000, focus: "AgriTech & Supply Chain", lastAction: "Reviewing Round 1 MVPs" },
  { code: "XF26", name: "Kestrel Treasury", initialCapital: 495000, availableCapital: 495000, focus: "Balanced Multi-Sector Pool", lastAction: "Active · Open to equity pitches" },
];

const SEED_RAISE_REQUESTS: LiveRaiseRequest[] = [
  { id: 1001, productCode: "XP04", amount: 35000, equityPct: 4, impliedValuation: 875000, note: "Raising $35,000 to hire a turnaround consultant & switch to compostable retort pouches.", status: "OPEN", passedBy: [], createdAt: "23:46:10 IST" },
  { id: 1002, productCode: "XP09", amount: 45000, equityPct: 3.5, impliedValuation: 1285714, note: "42 campus pilots signed; raising $45,000 to lock top-tier consultancy on tariff mitigation.", status: "OPEN", passedBy: [], createdAt: "23:46:28 IST" },
  { id: 1003, productCode: "XP12", amount: 35000, equityPct: 5, impliedValuation: 700000, note: "58% repeat D2C retention; offering 5% equity for $35,000 crisis recovery capital.", status: "OPEN", passedBy: [], createdAt: "23:47:05 IST" },
  { id: 1004, productCode: "XP15", amount: 45000, equityPct: 4, impliedValuation: 1125000, note: "44% gross margin diagnostic kits; raising $45,000 for Round 2 consulting & domestic reagent pivot.", status: "OPEN", passedBy: [], createdAt: "23:47:22 IST" },
  { id: 1005, productCode: "XP18", amount: 50000, equityPct: 3, impliedValuation: 1666667, note: "19,000 active kiranas; offering 3% equity for $50,000 to bridge NBFC credit squeeze.", status: "OPEN", passedBy: [], createdAt: "23:47:50 IST" },
  { id: 1006, productCode: "XP21", amount: 30000, equityPct: 4.5, impliedValuation: 666667, note: "Zero-plastic hostel cleaning pods; raising $30,000 to fund consultancy & surfactant sourcing.", status: "OPEN", passedBy: [], createdAt: "23:48:11 IST" },
  { id: 1007, productCode: "XP24", amount: 40000, equityPct: 4, impliedValuation: 1000000, note: "28,000 monthly bowls; raising $40,000 to diversify beyond quick-commerce commissions.", status: "OPEN", passedBy: [], createdAt: "23:48:39 IST" },
  { id: 1008, productCode: "XP27", amount: 60000, equityPct: 5, impliedValuation: 1200000, note: "Highest R1 CleanTech score (89/100); offering 5% equity for $60,000 turnaround war chest.", status: "OPEN", passedBy: [], createdAt: "23:49:04 IST" },
  { id: 1009, productCode: "XP30", amount: 32000, equityPct: 5, impliedValuation: 640000, note: "Modular farm-gate cold pods; raising $32,000 for freight cost restructuring.", status: "OPEN", passedBy: [], createdAt: "23:49:18 IST" },
];

const SEED_STATEMENTS: ProblemStatementState[] = [
  {
    id: "PS-01",
    title: "Cold-Chain Last-Mile Dairy & Fresh Produce Loss",
    sector: "FMCG & AgriTech",
    brief: "28% of perishable dairy and fresh-cut packs spoil between Tier-2 hubs and kirana shelves during 44°C summers.",
    crisisTwist: "Diesel cold-van freight rates spike 24% overnight while local municipalities restrict daytime delivery trucks.",
  },
  {
    id: "PS-02",
    title: "Micro-Working Capital for Unorganised Kirana Stores",
    sector: "FinTech",
    brief: "Small shopkeepers pay 36% APR to informal lenders to restock fast-moving inventory before festival peaks.",
    crisisTwist: "NBFC liquidity tightens and UPI merchant settlement delays stretch from T+0 to T+3 days.",
  },
  {
    id: "PS-03",
    title: "Affordable Preventive Diagnostics for Tier-3 Households",
    sector: "HealthTech",
    brief: "Families delay blood and metabolic screenings until hospitalisation because lab visits cost a day's wages.",
    crisisTwist: "Diagnostic reagent import duties jump 18% and NABL accreditation audits tighten across regional labs.",
    claimedBy: "XP14",
    claimedByName: "Luma Living",
    claimedAt: "02:18:10 IST",
  },
  {
    id: "PS-04",
    title: "Zero-Plastic Refill Stations for College & Office Campuses",
    sector: "CleanTech & FMCG",
    brief: "Campuses generate 40,000 single-use bottles monthly; students want hygienic ₹10 flavoured hydration refills.",
    crisisTwist: "A state single-use packaging levy takes effect in 14 days while water-filter cartridge costs jump 30%.",
  },
  {
    id: "PS-05",
    title: "Verified Part-Time Shift & Skill Escrow for College Students",
    sector: "FinTech & EdTech",
    brief: "Local businesses struggle with 55% no-show rates on weekend shifts while students face delayed gig payouts.",
    crisisTwist: "Platform gig-worker welfare cess adds 4% per transaction and two competing job boards slash fees to zero.",
  },
  {
    id: "PS-06",
    title: "Smart Hostel Electricity & Peak-Load Sub-Metering",
    sector: "CleanTech",
    brief: "Campus hostels waste 32% of AC electricity due to flat-rate billing with zero room-level visibility.",
    crisisTwist: "State utility board mandates new BIS certification within 45 days and telemetry chip lead times double.",
  },
  {
    id: "PS-07",
    title: "Quick-Commerce Dark-Store Shelf-Life & Waste Optimizer",
    sector: "FMCG & SaaS",
    brief: "10-minute delivery dark stores write off 9% of fresh inventory weekly due to poor hyperlocal demand forecasting.",
    crisisTwist: "Quick-commerce platforms hike brand commission rates from 18% to 30% and enforce 48-hour expiry return penalties.",
    claimedBy: "XP08",
    claimedByName: "VitaCart",
    claimedAt: "02:20:45 IST",
  },
  {
    id: "PS-08",
    title: "Low-Cost Diabetic & High-Protein Everyday Staples",
    sector: "HealthTech & FMCG",
    brief: "Urban families want everyday atta and snack mixes with verified low-GI labels under ₹80/pack.",
    crisisTwist: "FSSAI bans front-of-pack clinical claims without third-party trials and lentil/whey inputs surge 22%.",
  },
  {
    id: "PS-09",
    title: "Campus E-Cycle Battery Swapping & Micro-Transit Pods",
    sector: "CleanTech & Mobility",
    brief: "Large university campuses lack affordable zero-emission last-mile commuting between hostels and academic blocks.",
    crisisTwist: "Thermal-safety firmware audit freezes 30% of swap lockers while lithium cell import duties jump 15%.",
  },
  {
    id: "PS-10",
    title: "Instant GST Invoice Discounting for Small D2C Suppliers",
    sector: "FinTech",
    brief: "Tier-2 packaging and ingredient vendors wait 60–90 days for supermarket receivables, choking daily production.",
    crisisTwist: "Co-lending NBFC cuts credit limits 35% and RBI tightens short-tenure digital factoring disclosures.",
  },
  {
    id: "PS-11",
    title: "Compostable Cold-Insulated Pouches for Online Meat & Dairy",
    sector: "CleanTech & FMCG",
    brief: "E-grocery brands face strict state bans on EPS foam boxes and foil-laminated cold pouches.",
    crisisTwist: "Bio-polymer resin prices surge 24% and transit heatwaves raise spoilage claims by 11%.",
  },
  {
    id: "PS-12",
    title: "Automated Shift & Overtime Payroll Compliance for Small Factories",
    sector: "FinTech & SaaS",
    brief: "SME workshops lose 14% of staff monthly due to manual attendance disputes and delayed PF/ESIC remittances.",
    crisisTwist: "Biometric hardware lead times double and a rival payroll app launches a zero-fee free tier.",
  },
];

const SEED_DRAFT_QUEUE: DraftQueueEntryState[] = [
  { rank: 1, code: "XP14", company: "Luma Living", cash: 12000, status: "CLAIMED", pickedStatementId: "PS-03" },
  { rank: 2, code: "XP08", company: "VitaCart", cash: 24000, status: "CLAIMED", pickedStatementId: "PS-07" },
  { rank: 3, code: "XP01", company: "AquaCare", cash: 36000, status: "YOUR_TURN" },
  { rank: 4, code: "XP04", company: "FreshPack Foods", cash: 45000, status: "UPCOMING" },
  { rank: 5, code: "XP12", company: "Nova Nutrition", cash: 52000, status: "UPCOMING" },
  { rank: 6, code: "XP15", company: "Orbit Health", cash: 61000, status: "UPCOMING" },
  { rank: 7, code: "XP18", company: "MintFlow Pay", cash: 74000, status: "UPCOMING" },
  { rank: 8, code: "XP09", company: "GridWise Energy", cash: 82000, status: "UPCOMING" },
  { rank: 9, code: "XP27", company: "SolarNest", cash: 96000, status: "UPCOMING" },
  { rank: 10, code: "XP30", company: "KisanLink", cash: 115000, status: "UPCOMING" },
];

const SEED_QA: QaItemState[] = [
  { id: 10, team: "XC01", targetCompany: "XP01 · AquaCare", q: "Which suppliers are approved for AquaCare, and can we switch to paper-foil pouches before the 18% GST slab takes effect?", a: "Two approved suppliers in Pune. Paper-foil packaging is possible within three weeks, with a 4% unit-cost increase.", answeredBy: "XP01", createdAt: "00:08:12 IST" },
  { id: 9, team: "XC14", targetCompany: "XP01 · AquaCare", q: "How much of AquaCare's current distributor inventory is covered under the existing 12% tax treatment?", a: "The 18% rate applies from next month; existing inventory in transit clears under the 12% treatment.", answeredBy: "XP01", createdAt: "00:07:30 IST" },
  { id: 8, team: "XP04", targetCompany: "XP04 · FreshPack Foods", q: "Can FreshPack Foods shift 30% of its ready-to-eat pouch volume to institutional school canteens without breaking existing retail agreements?", a: "Yes—institutional and campus boxes sit outside modern-trade exclusivity clauses.", answeredBy: "XP04", createdAt: "00:06:18 IST" },
  { id: 7, team: "XC04", targetCompany: "XP01 · AquaCare", q: "What is the minimum order quantity (MOQ) for regional toll co-packers if AquaCare consolidates production to one western plant?", a: "Minimum commitment is 35,000 packs/month with a 10-day changeover window.", answeredBy: "XP01", createdAt: "00:05:44 IST" },
  { id: 6, team: "XP09", targetCompany: "XP09 · GridWise Energy", q: "How long does BIS smart-grid recertification take for GridWise Energy's hostel sub-meters?", a: "Standard testing takes 35 days; expedited lab slots cut turnaround to 21 days at a ₹1.8 lakh fee.", answeredBy: "XP09", createdAt: "00:05:02 IST" },
  { id: 5, team: "XC07", targetCompany: "XP01 · AquaCare", q: "What percentage of AquaCare's repeat purchases come from Tier-1 urban parents versus Tier-2 general trade?", a: "58% of repeat volume comes from Tier-1 urban households; 42% comes from Tier-2 kirana stores.", answeredBy: "XP01", createdAt: "00:04:19 IST" },
  { id: 4, team: "XP12", targetCompany: "XP12 · Nova Nutrition", q: "Does Nova Nutrition have pre-approved FSSAI alternative front-of-pack label templates ready for print?", a: "Yes—two compliant 'daily nutrition' label artworks are already cleared and require 7 days for pouch printing.", answeredBy: "XP12", createdAt: "00:03:51 IST" },
  { id: 3, team: "XC09", targetCompany: "XP01 · AquaCare", q: "Are modern-trade supermarket chains open to a 5-pack value bundle instead of raising shelf margins on single ₹20 pouches?", a: "Two of the three top chains confirmed willingness to pilot a ₹99 5-pack without additional slotting fees.", answeredBy: "XP01", createdAt: "00:03:11 IST" },
  { id: 2, team: "XP15", targetCompany: "XP15 · Orbit Health", q: "Can Orbit Health source diagnostic reagents from domestic Pune labs to avoid the 18% import tariff?", a: "Domestic reagent batches pass NABL standards and trim unit cost by ₹14/kit, with 14-day onboarding.", answeredBy: "XP15", createdAt: "00:02:27 IST" },
  { id: 1, team: "XC12", targetCompany: "XP04 · FreshPack Foods", q: "How many weeks of legacy multi-layer pouch stock remain in FreshPack's central warehouse?", a: "Roughly 2.5 weeks of legacy pouch stock, which can be cleared ahead of the 30-day directive.", answeredBy: "XP04", createdAt: "00:01:45 IST" },
];

export function createInitialCoordinationState(): CoordinationState {
  const products: Record<string, ProductTeamState> = {};
  const productOrder: string[] = [];
  for (const p of SEED_PRODUCTS) {
    products[p.code] = { ...p, r1MvpParts: [...p.r1MvpParts], r2MvpParts: [...p.r2MvpParts], r3MvpParts: [...p.r3MvpParts], raiseHistory: [] };
    productOrder.push(p.code);
  }

  const consultants: Record<string, ConsultingTeamState> = {};
  const consultantOrder: string[] = [];
  for (const c of SEED_CONSULTANTS) {
    consultants[c.code] = { ...c, r1SolutionParts: [...c.r1SolutionParts], presetSolution: { ...c.presetSolution } };
    consultantOrder.push(c.code);
  }

  const r2Deals: Record<string, R2DealRecord> = {};
  const stamp = "23:45:00 IST";
  // Seed initial offered deals for XC01 from all Product teams (XP01..XP30)
  for (const p of SEED_PRODUCTS) {
    const k = pairKey(p.code, "XC01");
    r2Deals[k] = {
      key: k,
      productCode: p.code,
      consultingCode: "XC01",
      baseValue: 40000,
      initialOffer: p.defaultR2Offer,
      currentPrice: p.defaultR2Offer,
      currentMarkupPct: 0,
      stage: "OFFERED",
      lockInitiatedBy: p.incomingR2Lock ? "PRODUCT" : "NONE",
      productLockAccepted: !!p.incomingR2Lock,
      consultingLockAccepted: false,
      r2SolutionParts: Array(6).fill(""),
      r2SolutionSubmittedAt: null,
      updatedAt: stamp,
    };
  }

  // Seed initial R3 open auction offers for XC01 from non-XP01 Product teams
  const r3AuctionDeals: Record<string, R3AuctionDealRecord> = {};
  for (const p of SEED_PRODUCTS) {
    if (p.code === "XP01") continue;
    const k = pairKey(p.code, "XC01");
    r3AuctionDeals[k] = {
      key: k,
      productCode: p.code,
      consultingCode: "XC01",
      baseValue: 40000,
      initialOffer: p.defaultR3AuctionOffer,
      currentPrice: p.defaultR3AuctionOffer,
      currentMarkupPct: 0,
      stage: "OFFERED",
      lockInitiatedBy: p.incomingR3Lock ? "PRODUCT" : "NONE",
      productLockAccepted: !!p.incomingR3Lock,
      consultingLockAccepted: false,
    };
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    products,
    productOrder,
    consultants,
    consultantOrder,
    financeTeams: SEED_FINANCE_TEAMS.map(f => ({ ...f })),
    raiseRequests: SEED_RAISE_REQUESTS.map(r => ({ ...r, passedBy: [...r.passedBy] })),
    financeDeals: [],
    r2Deals,
    r3Incumbents: {},
    r3AuctionDeals,
    r3Locks: {},
    r3Statements: SEED_STATEMENTS.map(s => ({ ...s })),
    r3DraftQueue: SEED_DRAFT_QUEUE.map(q => ({ ...q })),
    qaItems: SEED_QA.map(q => ({ ...q })),
    events: [
      {
        id: "seed-1",
        timestamp: "23:45:00 IST",
        actor: "PRIMUS",
        track: "SYSTEM",
        round: "R2",
        summary: "Live Product ⇄ Consulting coordination network active across all rounds.",
      },
    ],
  };
}

// ── SELECTOR HELPERS ──

export function getOrMakeProduct(state: CoordinationState, code: string): ProductTeamState {
  if (state.products[code]) return state.products[code]!;
  return {
    ...SEED_PRODUCTS[0]!,
    code,
    company: `Team ${code}`,
    ticker: code.replace(/[^A-Z]/g, "").slice(0, 4).padEnd(4, "X"),
    raisedCash: 0,
    equityGivenPct: 0,
    raiseHistory: [],
    r1MvpParts: Array(7).fill(""),
    r2MvpParts: Array(6).fill(""),
    r3MvpParts: Array(6).fill(""),
    r1SubmittedAt: null,
    r2MvpSubmittedAt: null,
    r3MvpSubmittedAt: null,
  };
}

export function getOrMakeConsultant(state: CoordinationState, code: string): ConsultingTeamState {
  if (state.consultants[code]) return state.consultants[code]!;
  return {
    ...SEED_CONSULTANTS[0]!,
    code,
    r1SolutionParts: Array(6).fill(""),
    r1SubmittedAt: null,
  };
}

export function getR2Deal(state: CoordinationState, productCode: string, consultingCode: string): R2DealRecord {
  const k = pairKey(productCode, consultingCode);
  if (state.r2Deals[k]) return state.r2Deals[k]!;
  const prod = getOrMakeProduct(state, productCode);
  const cons = getOrMakeConsultant(state, consultingCode);
  const initialOffer = consultingCode === "XC01" ? prod.defaultR2Offer : cons.baseValue;
  return {
    key: k,
    productCode,
    consultingCode,
    baseValue: cons.baseValue,
    initialOffer,
    currentPrice: initialOffer,
    currentMarkupPct: 0,
    stage: "OFFERED",
    lockInitiatedBy: "NONE",
    productLockAccepted: false,
    consultingLockAccepted: false,
    r2SolutionParts: Array(6).fill(""),
    r2SolutionSubmittedAt: null,
    updatedAt: "—",
  };
}

export function getProductR2Lock(state: CoordinationState, productCode: string): R2DealRecord | null {
  for (const deal of Object.values(state.r2Deals)) {
    if (deal.productCode === productCode && deal.productLockAccepted && deal.consultingLockAccepted) {
      return deal;
    }
  }
  return null;
}

export function getConsultingR2Lock(state: CoordinationState, consultingCode: string): R2DealRecord | null {
  for (const deal of Object.values(state.r2Deals)) {
    if (deal.consultingCode === consultingCode && deal.productLockAccepted && deal.consultingLockAccepted) {
      return deal;
    }
  }
  return null;
}

export function getProductR2PendingLock(state: CoordinationState, productCode: string): R2DealRecord | null {
  for (const deal of Object.values(state.r2Deals)) {
    if (
      deal.productCode === productCode &&
      deal.lockInitiatedBy === "PRODUCT" &&
      deal.productLockAccepted &&
      !deal.consultingLockAccepted
    ) {
      return deal;
    }
  }
  return null;
}

export function getConsultingR2PendingLock(state: CoordinationState, consultingCode: string): R2DealRecord | null {
  for (const deal of Object.values(state.r2Deals)) {
    if (
      deal.consultingCode === consultingCode &&
      deal.lockInitiatedBy === "CONSULTING" &&
      deal.consultingLockAccepted &&
      !deal.productLockAccepted
    ) {
      return deal;
    }
  }
  return null;
}

export function getProductAvailableCash(state: CoordinationState, productCode: string): number {
  const prod = getOrMakeProduct(state, productCode);
  const lock = getProductR2Lock(state, productCode);
  return Math.max(0, prod.raisedCash - (lock ? lock.currentPrice : 0));
}

export function getR3IncumbentForProduct(state: CoordinationState, productCode: string): R3IncumbentRecord {
  // 1. Check explicit R3 incumbent entry
  for (const rec of Object.values(state.r3Incumbents)) {
    if (rec.productCode === productCode) return rec;
  }
  // 2. Check live R2 lock for this Product team
  const r2Lock = getProductR2Lock(state, productCode);
  const consultingCode = r2Lock ? r2Lock.consultingCode : "XC01";
  const cons = getOrMakeConsultant(state, consultingCode);
  return {
    key: pairKey(productCode, consultingCode),
    productCode,
    consultingCode,
    baseValue: cons.baseValue,
    requestedPct: 0,
    requestedPrice: cons.baseValue,
    status: "AWAITING_CONSULTANT_ASK",
  };
}

export function getR3IncumbentForConsulting(state: CoordinationState, consultingCode: string): R3IncumbentRecord {
  for (const rec of Object.values(state.r3Incumbents)) {
    if (rec.consultingCode === consultingCode) return rec;
  }
  const r2Lock = getConsultingR2Lock(state, consultingCode);
  const productCode = r2Lock ? r2Lock.productCode : "XP01";
  const cons = getOrMakeConsultant(state, consultingCode);
  return {
    key: pairKey(productCode, consultingCode),
    productCode,
    consultingCode,
    baseValue: cons.baseValue,
    requestedPct: 0,
    requestedPrice: cons.baseValue,
    status: "AWAITING_CONSULTANT_ASK",
  };
}

export function getProductR3Lock(state: CoordinationState, productCode: string): R3FinalLockRecord | null {
  for (const lock of Object.values(state.r3Locks)) {
    if (lock.productCode === productCode) return lock;
  }
  return null;
}

export function getConsultingR3Lock(state: CoordinationState, consultingCode: string): R3FinalLockRecord | null {
  for (const lock of Object.values(state.r3Locks)) {
    if (lock.consultingCode === consultingCode) return lock;
  }
  return null;
}

export function getR3AuctionDeal(
  state: CoordinationState,
  productCode: string,
  consultingCode: string
): R3AuctionDealRecord {
  const k = pairKey(productCode, consultingCode);
  if (state.r3AuctionDeals[k]) return state.r3AuctionDeals[k]!;
  const prod = getOrMakeProduct(state, productCode);
  const cons = getOrMakeConsultant(state, consultingCode);
  const initialOffer = consultingCode === "XC01" ? prod.defaultR3AuctionOffer : cons.baseValue;
  return {
    key: k,
    productCode,
    consultingCode,
    baseValue: cons.baseValue,
    initialOffer,
    currentPrice: initialOffer,
    currentMarkupPct: 0,
    stage: "OFFERED",
    lockInitiatedBy: "NONE",
    productLockAccepted: false,
    consultingLockAccepted: false,
  };
}

export function getProductClaimedStatement(
  state: CoordinationState,
  productCode: string
): ProblemStatementState | null {
  return state.r3Statements.find(s => s.claimedBy === productCode) ?? null;
}

export function getFinanceTeam(state: CoordinationState, financeCode: string): FinanceTeamState {
  const existing = state.financeTeams.find(ft => ft.code === financeCode);
  if (existing) return existing;
  return {
    code: financeCode,
    name: `Finance Desk ${financeCode}`,
    initialCapital: 500000,
    availableCapital: 500000,
    focus: "Multi-Sector Venture & Turnaround",
    lastAction: "Active · Reviewing Product MVPs",
  };
}

export function getFinancePortfolio(state: CoordinationState, financeCode: string): FinanceEquityDeal[] {
  return state.financeDeals.filter(d => d.financeCode === financeCode);
}

export function getProductMvpDisplayParts(product: ProductTeamState): {
  isLiveWritten: boolean;
  sections: { title: string; body: string }[];
} {
  const titles = [
    "01 · Idea & Problem Statement",
    "02 · Target User & Market",
    "03 · MVP Core Features",
    "04 · User Flow & Architecture",
    "05 · Business Model & Unit Maths",
    "06 · Go-To-Market & Launch",
    "07 · Risks & Success Metrics",
  ];
  const hasWritten = product.r1MvpParts.some(p => p.trim().length > 0);
  if (hasWritten) {
    return {
      isLiveWritten: true,
      sections: titles.map((title, i) => ({
        title,
        body: product.r1MvpParts[i]?.trim() || "— (Not filled in this section)",
      })),
    };
  }
  return {
    isLiveWritten: false,
    sections: [
      { title: titles[0]!, body: `${product.company} (${product.ticker}) tackles ${product.topic}. ${product.pitchLine}` },
      { title: titles[1]!, body: `Focused on high-repeat Tier-1 & Tier-2 Indian customers inside ${product.sector} with validated demand (Round 1 Score: ${product.r1Score}/100).` },
      { title: titles[2]!, body: `Version-1 MVP focuses on rapid shelf/digital deployment, core SKU standardization, and lean fulfillment without bloated secondary features.` },
      { title: titles[3]!, body: `End-to-end onboarding & replenishment workflow engineered for high repeat purchase frequency and transparent partner margins.` },
      { title: titles[4]!, body: product.baselineContext },
      { title: titles[5]!, body: `90-day pilot rollout across anchor cities/campuses targeting first 1,000+ repeat customers & top-quartile distributor turn rate.` },
      { title: titles[6]!, body: `Active Round 2 Crisis (${product.crisisCategory}): ${product.crisisTitle}. Seeking strategic capital to hire a 1:1 Consultancy turnaround partner.` },
    ],
  };
}

// ── PURE REDUCER ──

function pushEvent(
  events: CoordinationEvent[],
  actor: string,
  track: CoordinationEvent["track"],
  round: CoordinationEvent["round"],
  summary: string
): CoordinationEvent[] {
  const evt: CoordinationEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: nowIst(),
    actor,
    track,
    round,
    summary,
  };
  return [evt, ...events].slice(0, 40);
}

function ensureProductInMap(state: CoordinationState, code: string): {
  products: Record<string, ProductTeamState>;
  productOrder: string[];
  product: ProductTeamState;
} {
  if (state.products[code]) {
    return { products: state.products, productOrder: state.productOrder, product: state.products[code]! };
  }
  const created = getOrMakeProduct(state, code);
  return {
    products: { ...state.products, [code]: created },
    productOrder: [...state.productOrder, code],
    product: created,
  };
}

function ensureConsultantInMap(state: CoordinationState, code: string): {
  consultants: Record<string, ConsultingTeamState>;
  consultantOrder: string[];
  consultant: ConsultingTeamState;
} {
  if (state.consultants[code]) {
    return { consultants: state.consultants, consultantOrder: state.consultantOrder, consultant: state.consultants[code]! };
  }
  const created = getOrMakeConsultant(state, code);
  return {
    consultants: { ...state.consultants, [code]: created },
    consultantOrder: [...state.consultantOrder, code],
    consultant: created,
  };
}

export function applyCoordinationAction(
  prev: CoordinationState,
  action: CoordinationAction
): CoordinationState {
  if (action.type === "RESET") {
    const fresh = createInitialCoordinationState();
    return { ...fresh, version: prev.version + 1, updatedAt: new Date().toISOString() };
  }

  const stamp = nowIst();
  const nextVersion = prev.version + 1;
  const nowIso = new Date().toISOString();

  switch (action.type) {
    case "PRODUCT_R1_UPDATE":
    case "PRODUCT_R1_SUBMIT": {
      const { products, productOrder, product } = ensureProductInMap(prev, action.productCode);
      if (product.r1SubmittedAt) return prev;
      const isSubmit = action.type === "PRODUCT_R1_SUBMIT";
      const updated: ProductTeamState = {
        ...product,
        company: action.company || product.company,
        ticker: action.ticker || product.ticker,
        sector: action.sector || product.sector,
        pitchLine: action.pitchLine,
        topic: `${action.sector.split("·")[1]?.trim() || "Product"} · ${action.company || product.company}`,
        r1MvpParts: [...action.mvpParts],
        r1SubmittedAt: isSubmit ? stamp : null,
      };
      const nextDraftQueue = prev.r3DraftQueue.map(q =>
        q.code === action.productCode ? { ...q, company: updated.company } : q
      );
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        products: { ...products, [action.productCode]: updated },
        productOrder,
        r3DraftQueue: nextDraftQueue,
        events: isSubmit
          ? pushEvent(
              prev.events,
              action.productCode,
              "PRODUCT",
              "R1",
              `${action.productCode} submitted Round 1 Idea & MVP for ${updated.company} (${updated.ticker}).`
            )
          : prev.events,
      };
    }

    case "CONSULTING_R1_UPDATE":
    case "CONSULTING_R1_SUBMIT": {
      const { consultants, consultantOrder, consultant } = ensureConsultantInMap(prev, action.consultingCode);
      if (consultant.r1SubmittedAt) return prev;
      const isSubmit = action.type === "CONSULTING_R1_SUBMIT";
      const updated: ConsultingTeamState = {
        ...consultant,
        r1SolutionParts: [...action.solutionParts],
        r1SubmittedAt: isSubmit ? stamp : null,
      };
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        consultants: { ...consultants, [action.consultingCode]: updated },
        consultantOrder,
        events: isSubmit
          ? pushEvent(
              prev.events,
              action.consultingCode,
              "CONSULTING",
              "R1",
              `${action.consultingCode} submitted Round 1 Crisis Solution (base valuation $${updated.baseValue.toLocaleString()}).`
            )
          : prev.events,
      };
    }

    case "PRODUCT_RAISE_BROADCAST": {
      const { products, productOrder, product } = ensureProductInMap(prev, action.productCode);
      const equityRetained = Math.max(0, Number((100 - product.equityGivenPct).toFixed(2)));
      if (action.amount <= 0 || action.equityPct <= 0 || action.equityPct > equityRetained) return prev;

      const eligibleIdx = prev.financeTeams.findIndex(ft => ft.availableCapital >= action.amount);
      const chosenIdx = eligibleIdx >= 0 ? eligibleIdx : 0;
      const chosen = prev.financeTeams[chosenIdx]!;
      const reqId = prev.raiseRequests.reduce((m, r) => Math.max(m, r.id), 1000) + 1;
      const impliedValuation = Math.round(action.amount / (action.equityPct / 100));

      const nextFinanceTeams = prev.financeTeams.map((ft, idx) =>
        idx === chosenIdx
          ? {
              ...ft,
              availableCapital: Math.max(0, ft.availableCapital - action.amount),
              lastAction: `✓ Funded ${action.productCode} $${action.amount.toLocaleString()} for ${action.equityPct}% equity`,
            }
          : {
              ...ft,
              lastAction: `Filled by ${chosen.code} for ${action.productCode} · Capital intact`,
            }
      );
      const newReq: LiveRaiseRequest = {
        id: reqId,
        productCode: action.productCode,
        amount: action.amount,
        equityPct: action.equityPct,
        impliedValuation,
        note: action.note,
        status: "OPEN",
        passedBy: [],
        createdAt: stamp,
      };

      const record: RaiseRecord = {
        id: Date.now(),
        id: reqId,
        amount: action.amount,
        equityPct: action.equityPct,
        note: action.note,
        status: "FUNDED",
        fundedBy: chosen.code,
        fundedByName: chosen.name,
        status: "BROADCASTING",
        timestamp: stamp,
      };

      const nextRaised = product.raisedCash + action.amount;
      const nextFinanceTeams = prev.financeTeams.map(ft => ({
        ...ft,
        lastAction: `⚡ Live raise from ${action.productCode}: ${action.equityPct}% equity for $${action.amount.toLocaleString()}`,
      }));

      const updatedProd: ProductTeamState = {
        ...product,
        raisedCash: nextRaised,
        equityGivenPct: Number((product.equityGivenPct + action.equityPct).toFixed(2)),
        raiseHistory: [record, ...product.raiseHistory],
      };

      // Also keep R3 draft queue cash synced if team is in draft queue
      const r2Lock = getProductR2Lock(prev, action.productCode);
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        products: { ...products, [action.productCode]: updatedProd },
        productOrder,
        financeTeams: nextFinanceTeams,
        raiseRequests: [newReq, ...prev.raiseRequests],
        events: pushEvent(
          prev.events,
          action.productCode,
          "PRODUCT",
          "R2",
          `${action.productCode} (${product.company}) broadcast raise request to ALL Finance teams: $${action.amount.toLocaleString()} for ${action.equityPct}% equity.`
        ),
      };
    }

    case "PRODUCT_RAISE_CANCEL": {
      const target = prev.raiseRequests.find(
        r => r.id === action.requestId && r.productCode === action.productCode && r.status === "OPEN"
      );
      if (!target) return prev;
      const { products, productOrder, product } = ensureProductInMap(prev, action.productCode);
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        products: {
          ...products,
          [action.productCode]: {
            ...product,
            raiseHistory: product.raiseHistory.map(h =>
              h.id === action.requestId ? { ...h, status: "CANCELLED" } : h
            ),
          },
        },
        productOrder,
        raiseRequests: prev.raiseRequests.map(r =>
          r.id === action.requestId ? { ...r, status: "CANCELLED" } : r
        ),
        events: pushEvent(
          prev.events,
          action.productCode,
          "PRODUCT",
          "R2",
          `${action.productCode} cancelled open raise request ($${target.amount.toLocaleString()} for ${target.equityPct}% equity).`
        ),
      };
    }

    case "FINANCE_CLOSE_DEAL": {
      const req = prev.raiseRequests.find(r => r.id === action.requestId && r.status === "OPEN");
      if (!req) return prev;
      const { products, productOrder, product } = ensureProductInMap(prev, req.productCode);
      const equityRetained = Math.max(0, Number((100 - product.equityGivenPct).toFixed(2)));
      if (req.equityPct > equityRetained) return prev;

      const existingFinIdx = prev.financeTeams.findIndex(ft => ft.code === action.financeCode);
      const finTeam =
        existingFinIdx >= 0
          ? prev.financeTeams[existingFinIdx]!
          : getFinanceTeam(prev, action.financeCode);

      if (finTeam.availableCapital < req.amount) return prev;

      const updatedFin: FinanceTeamState = {
        ...finTeam,
        availableCapital: Math.max(0, finTeam.availableCapital - req.amount),
        lastAction: `✓ Closed deal with ${req.productCode}: $${req.amount.toLocaleString()} for ${req.equityPct}% equity`,
      };

      const nextFinanceTeams =
        existingFinIdx >= 0
          ? prev.financeTeams.map((ft, idx) =>
              idx === existingFinIdx
                ? updatedFin
                : { ...ft, lastAction: `Deal closed by ${finTeam.code} for ${req.productCode}` }
            )
          : [updatedFin, ...prev.financeTeams];

      const nextRaised = product.raisedCash + req.amount;
      const nextEquityGiven = Number((product.equityGivenPct + req.equityPct).toFixed(2));
      const hasHistoryEntry = product.raiseHistory.some(h => h.id === req.id);
      const nextHistory: RaiseRecord[] = hasHistoryEntry
        ? product.raiseHistory.map(h =>
            h.id === req.id
              ? { ...h, status: "FUNDED", fundedBy: finTeam.code, fundedByName: finTeam.name }
              : h
          )
        : [
            {
              id: req.id,
              amount: req.amount,
              equityPct: req.equityPct,
              note: req.note,
              status: "FUNDED",
              fundedBy: finTeam.code,
              fundedByName: finTeam.name,
              timestamp: stamp,
            },
            ...product.raiseHistory,
          ];

      const updatedProd: ProductTeamState = {
        ...product,
        raisedCash: nextRaised,
        equityGivenPct: nextEquityGiven,
        raiseHistory: nextHistory,
      };

      const newDeal: FinanceEquityDeal = {
        id: `deal-${req.id}-${finTeam.code}`,
        requestId: req.id,
        financeCode: finTeam.code,
        financeName: finTeam.name,
        productCode: req.productCode,
        company: product.company,
        ticker: product.ticker,
        sector: product.sector,
        amountInvested: req.amount,
        equityPct: req.equityPct,
        impliedValuation: req.impliedValuation,
        closedAt: stamp,
      };

      const r2Lock = getProductR2Lock(prev, req.productCode);
      const netCash = Math.max(0, nextRaised - (r2Lock ? r2Lock.currentPrice : 0));
      const nextDraftQueue = prev.r3DraftQueue.map(q =>
        q.code === action.productCode && netCash > 0 ? { ...q, cash: netCash } : q
        q.code === req.productCode && netCash > 0 ? { ...q, cash: netCash } : q
      );

      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        products: { ...products, [action.productCode]: updatedProd },
        products: { ...products, [req.productCode]: updatedProd },
        productOrder,
        financeTeams: nextFinanceTeams,
        raiseRequests: prev.raiseRequests.map(r =>
          r.id === req.id
            ? {
                ...r,
                status: "FUNDED",
                fundedBy: finTeam.code,
                fundedByName: finTeam.name,
                closedAt: stamp,
              }
            : r
        ),
        financeDeals: [newDeal, ...prev.financeDeals],
        r3DraftQueue: nextDraftQueue,
        events: pushEvent(
          prev.events,
          action.productCode,
          finTeam.code,
          "FINANCE",
          "R2",
          `${action.productCode} raised $${action.amount.toLocaleString()} for ${action.equityPct}% equity from ${chosen.code} (${chosen.name}).`
          `💰 DEAL CLOSED: ${finTeam.code} (${finTeam.name}) funded ${req.productCode} (${product.company}) $${req.amount.toLocaleString()} for ${req.equityPct}% equity.`
        ),
      };
    }

    case "FINANCE_PASS_REQUEST": {
      const req = prev.raiseRequests.find(r => r.id === action.requestId && r.status === "OPEN");
      if (!req || req.passedBy.includes(action.financeCode)) return prev;
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        raiseRequests: prev.raiseRequests.map(r =>
          r.id === action.requestId
            ? { ...r, passedBy: [...r.passedBy, action.financeCode] }
            : r
        ),
        events: pushEvent(
          prev.events,
          action.financeCode,
          "FINANCE",
          "R2",
          `${action.financeCode} passed on ${req.productCode}'s $${req.amount.toLocaleString()} (${req.equityPct}%) raise request.`
        ),
      };
    }

    case "FINANCE_UNPASS_REQUEST": {
      const req = prev.raiseRequests.find(r => r.id === action.requestId && r.status === "OPEN");
      if (!req) return prev;
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        raiseRequests: prev.raiseRequests.map(r =>
          r.id === action.requestId
            ? { ...r, passedBy: r.passedBy.filter(c => c !== action.financeCode) }
            : r
        ),
      };
    }

    case "R2_PRODUCT_SEND_PROPOSAL": {
      if (getProductR2Lock(prev, action.productCode) || getConsultingR2Lock(prev, action.consultingCode)) {
        return prev;
      }
      const { products, productOrder } = ensureProductInMap(prev, action.productCode);
      const { consultants, consultantOrder, consultant } = ensureConsultantInMap(prev, action.consultingCode);
      const existing = getR2Deal(prev, action.productCode, action.consultingCode);
      const k = pairKey(action.productCode, action.consultingCode);
      const updated: R2DealRecord = {
        ...existing,
        baseValue: consultant.baseValue,
        initialOffer: consultant.baseValue,
        currentPrice: consultant.baseValue,
        currentMarkupPct: 0,
        stage: "PROPOSAL_SENT",
        pendingPrice: undefined,
        pendingMarkupPct: undefined,
        lockInitiatedBy: "NONE",
        productLockAccepted: false,
        consultingLockAccepted: false,
        updatedAt: stamp,
      };
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        products,
        productOrder,
        consultants,
        consultantOrder,
        r2Deals: { ...prev.r2Deals, [k]: updated },
        events: pushEvent(
          prev.events,
          action.productCode,
          "PRODUCT",
          "R2",
          `${action.productCode} sent Round 2 proposal ($${consultant.baseValue.toLocaleString()}) to Consulting Team ${action.consultingCode}.`
        ),
      };
    }

    case "R2_CONSULTING_PUSH_DEMAND": {
      if (getProductR2Lock(prev, action.productCode) || getConsultingR2Lock(prev, action.consultingCode)) {
        return prev;
      }
      const { products, productOrder } = ensureProductInMap(prev, action.productCode);
      const { consultants, consultantOrder, consultant } = ensureConsultantInMap(prev, action.consultingCode);
      const existing = getR2Deal(prev, action.productCode, action.consultingCode);
      const k = pairKey(action.productCode, action.consultingCode);
      const baseForMarkup = existing.initialOffer || consultant.baseValue;
      const demandedPrice = Math.round(baseForMarkup * (1 + action.markupPct / 100));
      const updated: R2DealRecord = {
        ...existing,
        baseValue: consultant.baseValue,
        stage: action.markupPct === 0 ? "DEAL_AGREED_UNLOCKED" : "COUNTER_DEMANDED",
        currentPrice: action.markupPct === 0 ? demandedPrice : existing.currentPrice,
        currentMarkupPct: action.markupPct === 0 ? 0 : existing.currentMarkupPct,
        pendingPrice: action.markupPct > 0 ? demandedPrice : undefined,
        pendingMarkupPct: action.markupPct > 0 ? action.markupPct : undefined,
        // Changing price resets any older unaccepted lock request
        lockInitiatedBy: "NONE",
        productLockAccepted: false,
        consultingLockAccepted: false,
        updatedAt: stamp,
      };
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        products,
        productOrder,
        consultants,
        consultantOrder,
        r2Deals: { ...prev.r2Deals, [k]: updated },
        events: pushEvent(
          prev.events,
          action.consultingCode,
          "CONSULTING",
          "R2",
          action.markupPct > 0
            ? `${action.consultingCode} pushed +${action.markupPct}% demand ($${demandedPrice.toLocaleString()}) to ${action.productCode} (awaiting Product acceptance).`
            : `${action.consultingCode} accepted base rate ($${demandedPrice.toLocaleString()}) with ${action.productCode} (ready to lock).`
        ),
      };
    }

    case "R2_CONSULTING_ACCEPT_PROPOSAL": {
      if (getProductR2Lock(prev, action.productCode) || getConsultingR2Lock(prev, action.consultingCode)) {
        return prev;
      }
      const existing = getR2Deal(prev, action.productCode, action.consultingCode);
      const k = pairKey(action.productCode, action.consultingCode);
      const updated: R2DealRecord = {
        ...existing,
        stage: "DEAL_AGREED_UNLOCKED",
        pendingPrice: undefined,
        pendingMarkupPct: undefined,
        updatedAt: stamp,
      };
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r2Deals: { ...prev.r2Deals, [k]: updated },
        events: pushEvent(
          prev.events,
          action.consultingCode,
          "CONSULTING",
          "R2",
          `${action.consultingCode} accepted ${action.productCode}'s proposal at $${existing.currentPrice.toLocaleString()} (still unlocked until mutual Lock Request).`
        ),
      };
    }

    case "R2_PRODUCT_ACCEPT_DEMAND": {
      if (getProductR2Lock(prev, action.productCode) || getConsultingR2Lock(prev, action.consultingCode)) {
        return prev;
      }
      const existing = getR2Deal(prev, action.productCode, action.consultingCode);
      const k = pairKey(action.productCode, action.consultingCode);
      const newPrice = existing.pendingPrice ?? existing.currentPrice;
      const newPct = existing.pendingMarkupPct ?? existing.currentMarkupPct;
      const updated: R2DealRecord = {
        ...existing,
        currentPrice: newPrice,
        currentMarkupPct: newPct,
        stage: "DEAL_AGREED_UNLOCKED",
        pendingPrice: undefined,
        pendingMarkupPct: undefined,
        updatedAt: stamp,
      };
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r2Deals: { ...prev.r2Deals, [k]: updated },
        events: pushEvent(
          prev.events,
          action.productCode,
          "PRODUCT",
          "R2",
          `${action.productCode} accepted ${action.consultingCode}'s +${newPct}% deal ($${newPrice.toLocaleString()}). Deal updated (not locked yet).`
        ),
      };
    }

    case "R2_PRODUCT_DECLINE_DEMAND": {
      if (getProductR2Lock(prev, action.productCode) || getConsultingR2Lock(prev, action.consultingCode)) {
        return prev;
      }
      const existing = getR2Deal(prev, action.productCode, action.consultingCode);
      const k = pairKey(action.productCode, action.consultingCode);
      const updated: R2DealRecord = {
        ...existing,
        stage: "DECLINED",
        pendingPrice: undefined,
        pendingMarkupPct: undefined,
        lockInitiatedBy: "NONE",
        productLockAccepted: false,
        consultingLockAccepted: false,
        updatedAt: stamp,
      };
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r2Deals: { ...prev.r2Deals, [k]: updated },
        events: pushEvent(
          prev.events,
          action.productCode,
          "PRODUCT",
          "R2",
          `${action.productCode} declined ${action.consultingCode}'s price increase demand.`
        ),
      };
    }

    case "R2_SEND_LOCK_REQUEST": {
      if (getProductR2Lock(prev, action.productCode) || getConsultingR2Lock(prev, action.consultingCode)) {
        return prev;
      }
      const existing = getR2Deal(prev, action.productCode, action.consultingCode);
      if (action.initiatedBy === "PRODUCT") {
        const cash = getProductAvailableCash(prev, action.productCode);
        if (cash < existing.currentPrice) return prev;
      }
      const k = pairKey(action.productCode, action.consultingCode);
      const updated: R2DealRecord = {
        ...existing,
        lockInitiatedBy: action.initiatedBy,
        productLockAccepted: action.initiatedBy === "PRODUCT",
        consultingLockAccepted: action.initiatedBy === "CONSULTING",
        updatedAt: stamp,
      };
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r2Deals: { ...prev.r2Deals, [k]: updated },
        events: pushEvent(
          prev.events,
          action.initiatedBy === "PRODUCT" ? action.productCode : action.consultingCode,
          action.initiatedBy,
          "R2",
          `${action.initiatedBy === "PRODUCT" ? action.productCode : action.consultingCode} sent a 1:1 Lock Request to ${action.initiatedBy === "PRODUCT" ? action.consultingCode : action.productCode} at $${existing.currentPrice.toLocaleString()}.`
        ),
      };
    }

    case "R2_ACCEPT_LOCK_REQUEST": {
      if (getProductR2Lock(prev, action.productCode) || getConsultingR2Lock(prev, action.consultingCode)) {
        return prev;
      }
      const existing = getR2Deal(prev, action.productCode, action.consultingCode);
      if (action.acceptedBy === "PRODUCT" && !action.bypassCashCheck) {
        const cash = getProductAvailableCash(prev, action.productCode);
        if (cash < existing.currentPrice) return prev;
      }
      const k = pairKey(action.productCode, action.consultingCode);
      const updated: R2DealRecord = {
        ...existing,
        stage: "DEAL_AGREED_UNLOCKED",
        productLockAccepted: true,
        consultingLockAccepted: true,
        lockedAt: stamp,
        updatedAt: stamp,
      };
      // Automatically create the Round 3 Incumbent entry carrying this exact 1:1 locked pair into Round 3!
      const cons = getOrMakeConsultant(prev, action.consultingCode);
      const nextR3Incumbents: Record<string, R3IncumbentRecord> = {
        ...prev.r3Incumbents,
        [k]: {
          key: k,
          productCode: action.productCode,
          consultingCode: action.consultingCode,
          baseValue: cons.baseValue,
          requestedPct: 0,
          requestedPrice: cons.baseValue,
          status: "AWAITING_CONSULTANT_ASK",
        },
      };
      // Update draft queue cash after paying consultant
      const prod = getOrMakeProduct(prev, action.productCode);
      const remainingCash = Math.max(0, prod.raisedCash - existing.currentPrice);
      const nextDraftQueue = prev.r3DraftQueue.map(q =>
        q.code === action.productCode && prod.raisedCash > 0 ? { ...q, cash: remainingCash } : q
      );

      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r2Deals: { ...prev.r2Deals, [k]: updated },
        r3Incumbents: nextR3Incumbents,
        r3DraftQueue: nextDraftQueue,
        events: pushEvent(
          prev.events,
          action.acceptedBy === "PRODUCT" ? action.productCode : action.consultingCode,
          action.acceptedBy,
          "R2",
          `🔒 PERMANENT 1:1 LOCK: ${action.productCode} ⇄ ${action.consultingCode} locked at $${existing.currentPrice.toLocaleString()}. Shared topic crisis unlocked!`
        ),
      };
    }

    case "R2_DECLINE_LOCK_REQUEST": {
      const existing = getR2Deal(prev, action.productCode, action.consultingCode);
      if (existing.productLockAccepted && existing.consultingLockAccepted) return prev;
      const k = pairKey(action.productCode, action.consultingCode);
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r2Deals: {
          ...prev.r2Deals,
          [k]: {
            ...existing,
            lockInitiatedBy: "NONE",
            productLockAccepted: false,
            consultingLockAccepted: false,
            updatedAt: stamp,
          },
        },
        events: pushEvent(
          prev.events,
          action.declinedBy === "PRODUCT" ? action.productCode : action.consultingCode,
          action.declinedBy,
          "R2",
          `${action.declinedBy === "PRODUCT" ? action.productCode : action.consultingCode} declined pending lock request.`
        ),
      };
    }

    case "R2_CONSULTING_SAVE_SOLUTION":
    case "R2_CONSULTING_SUBMIT_SOLUTION": {
      const k = pairKey(action.productCode, action.consultingCode);
      const existing = prev.r2Deals[k];
      if (!existing || !(existing.productLockAccepted && existing.consultingLockAccepted)) return prev;
      if (existing.r2SolutionSubmittedAt) return prev;
      const isSubmit = action.type === "R2_CONSULTING_SUBMIT_SOLUTION";
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r2Deals: {
          ...prev.r2Deals,
          [k]: {
            ...existing,
            r2SolutionParts: [...action.parts],
            r2SolutionSubmittedAt: isSubmit ? stamp : null,
            updatedAt: stamp,
          },
        },
        events: isSubmit
          ? pushEvent(
              prev.events,
              action.consultingCode,
              "CONSULTING",
              "R2",
              `${action.consultingCode} submitted Round 2 Crisis Solution → delivered live to ${action.productCode}'s MVP workspace!`
            )
          : prev.events,
      };
    }

    case "R2_PRODUCT_SAVE_MVP":
    case "R2_PRODUCT_SUBMIT_MVP": {
      const { products, productOrder, product } = ensureProductInMap(prev, action.productCode);
      if (product.r2MvpSubmittedAt) return prev;
      const isSubmit = action.type === "R2_PRODUCT_SUBMIT_MVP";
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        products: {
          ...products,
          [action.productCode]: {
            ...product,
            r2MvpParts: [...action.parts],
            r2MvpSubmittedAt: isSubmit ? stamp : null,
          },
        },
        productOrder,
        events: isSubmit
          ? pushEvent(
              prev.events,
              action.productCode,
              "PRODUCT",
              "R2",
              `${action.productCode} submitted Updated Round 2 MVP incorporating their consultant's crisis solution.`
            )
          : prev.events,
      };
    }

    // ── ROUND 3 COORDINATION ──
    case "R3_CONSULTING_ASK_INCUMBENT": {
      if (getConsultingR3Lock(prev, action.consultingCode)) return prev;
      const cons = getOrMakeConsultant(prev, action.consultingCode);
      const k = pairKey(action.productCode, action.consultingCode);
      const existing = prev.r3Incumbents[k];
      if (existing && (existing.status === "ACCEPTED_LOCKED" || existing.status === "REJECTED_REBIDDING")) {
        return prev;
      }
      const requestedPrice = Math.round(cons.baseValue * (1 + action.increasePct / 100));
      const updated: R3IncumbentRecord = {
        key: k,
        productCode: action.productCode,
        consultingCode: action.consultingCode,
        baseValue: cons.baseValue,
        requestedPct: action.increasePct,
        requestedPrice,
        status: "CONSULTANT_ASKED",
      };
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r3Incumbents: { ...prev.r3Incumbents, [k]: updated },
        events: pushEvent(
          prev.events,
          action.consultingCode,
          "CONSULTING",
          "R3",
          `${action.consultingCode} sent Round 3 price ${action.increasePct === 0 ? "at base" : `+${action.increasePct}%`} ($${requestedPrice.toLocaleString()}) to ${action.productCode}.`
        ),
      };
    }

    case "R3_PRODUCT_ACCEPT_INCUMBENT": {
      if (getProductR3Lock(prev, action.productCode) || getConsultingR3Lock(prev, action.consultingCode)) {
        return prev;
      }
      const k = pairKey(action.productCode, action.consultingCode);
      const cons = getOrMakeConsultant(prev, action.consultingCode);
      const existing = prev.r3Incumbents[k];
      const finalPrice = existing ? existing.requestedPrice : cons.baseValue;
      const markupPct = existing ? existing.requestedPct : 0;

      const updatedInc: R3IncumbentRecord = {
        key: k,
        productCode: action.productCode,
        consultingCode: action.consultingCode,
        baseValue: cons.baseValue,
        requestedPct: markupPct,
        requestedPrice: finalPrice,
        status: "ACCEPTED_LOCKED",
        decidedAt: stamp,
      };
      const finalLock: R3FinalLockRecord = {
        key: k,
        productCode: action.productCode,
        consultingCode: action.consultingCode,
        finalPrice,
        markupPct,
        source: "INCUMBENT_ACCEPTED",
        lockedAt: stamp,
        r3SolutionParts: Array(6).fill(""),
        r3SolutionSubmittedAt: null,
      };
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r3Incumbents: { ...prev.r3Incumbents, [k]: updatedInc },
        r3Locks: { ...prev.r3Locks, [k]: finalLock },
        events: pushEvent(
          prev.events,
          action.productCode,
          "PRODUCT",
          "R3",
          `✓ ${action.productCode} ACCEPTED ${action.consultingCode} for Round 3 at $${finalPrice.toLocaleString()} (${markupPct === 0 ? "base" : `+${markupPct}%`}). Locked 1:1!`
        ),
      };
    }

    case "R3_PRODUCT_REMOVE_INCUMBENT": {
      if (getProductR3Lock(prev, action.productCode)) return prev;
      const k = pairKey(action.productCode, action.consultingCode);
      const cons = getOrMakeConsultant(prev, action.consultingCode);
      const existing = prev.r3Incumbents[k];
      const updatedInc: R3IncumbentRecord = {
        key: k,
        productCode: action.productCode,
        consultingCode: action.consultingCode,
        baseValue: cons.baseValue,
        requestedPct: existing?.requestedPct ?? cons.defaultR3MarkupPct,
        requestedPrice:
          existing?.requestedPrice ?? Math.round(cons.baseValue * (1 + cons.defaultR3MarkupPct / 100)),
        status: "REJECTED_REBIDDING",
        decidedAt: stamp,
        removedByProduct: true,
      };
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r3Incumbents: { ...prev.r3Incumbents, [k]: updatedInc },
        events: pushEvent(
          prev.events,
          action.productCode,
          "PRODUCT",
          "R3",
          `✕ ${action.productCode} removed ${action.consultingCode} for Round 3 re-bid. ${action.consultingCode} unlocked into the Open Auction!`
        ),
      };
    }

    case "R3_PRODUCT_RETURN_TO_INCUMBENT": {
      if (getProductR3Lock(prev, action.productCode) || getConsultingR3Lock(prev, action.consultingCode)) {
        return prev;
      }
      const k = pairKey(action.productCode, action.consultingCode);
      const cons = getOrMakeConsultant(prev, action.consultingCode);
      const existing = prev.r3Incumbents[k];
      const finalPrice = existing?.requestedPrice ?? cons.baseValue;
      const markupPct = existing?.requestedPct ?? 0;

      const updatedInc: R3IncumbentRecord = {
        key: k,
        productCode: action.productCode,
        consultingCode: action.consultingCode,
        baseValue: cons.baseValue,
        requestedPct: markupPct,
        requestedPrice: finalPrice,
        status: "ACCEPTED_LOCKED",
        decidedAt: stamp,
        removedByProduct: true,
      };
      const finalLock: R3FinalLockRecord = {
        key: k,
        productCode: action.productCode,
        consultingCode: action.consultingCode,
        finalPrice,
        markupPct,
        source: "RETURNED_TO_INCUMBENT",
        lockedAt: stamp,
        r3SolutionParts: Array(6).fill(""),
        r3SolutionSubmittedAt: null,
      };
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r3Incumbents: { ...prev.r3Incumbents, [k]: updatedInc },
        r3Locks: { ...prev.r3Locks, [k]: finalLock },
        events: pushEvent(
          prev.events,
          action.productCode,
          "PRODUCT",
          "R3",
          `↺ ${action.productCode} returned to previous Consultant ${action.consultingCode} at $${finalPrice.toLocaleString()} (locked 1:1 for Round 3).`
        ),
      };
    }

    case "R3_PRODUCT_SEND_REBID": {
      if (getProductR3Lock(prev, action.productCode) || getConsultingR3Lock(prev, action.consultingCode)) {
        return prev;
      }
      const cons = getOrMakeConsultant(prev, action.consultingCode);
      const existing = getR3AuctionDeal(prev, action.productCode, action.consultingCode);
      const k = pairKey(action.productCode, action.consultingCode);
      const updated: R3AuctionDealRecord = {
        ...existing,
        baseValue: cons.baseValue,
        initialOffer: cons.baseValue,
        currentPrice: cons.baseValue,
        currentMarkupPct: 0,
        stage: "PROPOSAL_SENT",
        lockInitiatedBy: "NONE",
        productLockAccepted: false,
        consultingLockAccepted: false,
      };
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r3AuctionDeals: { ...prev.r3AuctionDeals, [k]: updated },
        events: pushEvent(
          prev.events,
          action.productCode,
          "PRODUCT",
          "R3",
          `${action.productCode} sent Round 3 re-bid request ($${cons.baseValue.toLocaleString()}) to ${action.consultingCode}.`
        ),
      };
    }

    case "R3_CONSULTING_PUSH_AUCTION_DEMAND": {
      if (getProductR3Lock(prev, action.productCode) || getConsultingR3Lock(prev, action.consultingCode)) {
        return prev;
      }
      const cons = getOrMakeConsultant(prev, action.consultingCode);
      const existing = getR3AuctionDeal(prev, action.productCode, action.consultingCode);
      const k = pairKey(action.productCode, action.consultingCode);
      const demandedPrice = Math.round(existing.initialOffer * (1 + action.markupPct / 100));
      const updated: R3AuctionDealRecord = {
        ...existing,
        baseValue: cons.baseValue,
        stage: action.markupPct === 0 ? "DEAL_AGREED_UNLOCKED" : "COUNTER_DEMANDED",
        currentPrice: action.markupPct === 0 ? demandedPrice : existing.currentPrice,
        currentMarkupPct: action.markupPct === 0 ? 0 : existing.currentMarkupPct,
        pendingPrice: action.markupPct > 0 ? demandedPrice : undefined,
        pendingMarkupPct: action.markupPct > 0 ? action.markupPct : undefined,
        lockInitiatedBy: "NONE",
        productLockAccepted: false,
        consultingLockAccepted: false,
      };
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r3AuctionDeals: { ...prev.r3AuctionDeals, [k]: updated },
        events: pushEvent(
          prev.events,
          action.consultingCode,
          "CONSULTING",
          "R3",
          `${action.consultingCode} pushed Round 3 auction demand (+${action.markupPct}% · $${demandedPrice.toLocaleString()}) to ${action.productCode}.`
        ),
      };
    }

    case "R3_PRODUCT_ACCEPT_AUCTION_DEMAND": {
      if (getProductR3Lock(prev, action.productCode) || getConsultingR3Lock(prev, action.consultingCode)) {
        return prev;
      }
      const existing = getR3AuctionDeal(prev, action.productCode, action.consultingCode);
      const k = pairKey(action.productCode, action.consultingCode);
      const newPrice = existing.pendingPrice ?? existing.currentPrice;
      const newPct = existing.pendingMarkupPct ?? existing.currentMarkupPct;
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r3AuctionDeals: {
          ...prev.r3AuctionDeals,
          [k]: {
            ...existing,
            currentPrice: newPrice,
            currentMarkupPct: newPct,
            stage: "DEAL_AGREED_UNLOCKED",
            pendingPrice: undefined,
            pendingMarkupPct: undefined,
          },
        },
        events: pushEvent(
          prev.events,
          action.productCode,
          "PRODUCT",
          "R3",
          `${action.productCode} accepted ${action.consultingCode}'s Round 3 re-bid price ($${newPrice.toLocaleString()}).`
        ),
      };
    }

    case "R3_SEND_AUCTION_LOCK": {
      if (getProductR3Lock(prev, action.productCode) || getConsultingR3Lock(prev, action.consultingCode)) {
        return prev;
      }
      const existing = getR3AuctionDeal(prev, action.productCode, action.consultingCode);
      const k = pairKey(action.productCode, action.consultingCode);
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r3AuctionDeals: {
          ...prev.r3AuctionDeals,
          [k]: {
            ...existing,
            lockInitiatedBy: action.initiatedBy,
            productLockAccepted: action.initiatedBy === "PRODUCT",
            consultingLockAccepted: action.initiatedBy === "CONSULTING",
          },
        },
        events: pushEvent(
          prev.events,
          action.initiatedBy === "PRODUCT" ? action.productCode : action.consultingCode,
          action.initiatedBy,
          "R3",
          `${action.initiatedBy === "PRODUCT" ? action.productCode : action.consultingCode} sent Round 3 Auction Lock Request ($${existing.currentPrice.toLocaleString()}).`
        ),
      };
    }

    case "R3_ACCEPT_AUCTION_LOCK": {
      if (getProductR3Lock(prev, action.productCode) || getConsultingR3Lock(prev, action.consultingCode)) {
        return prev;
      }
      const existing = getR3AuctionDeal(prev, action.productCode, action.consultingCode);
      const k = pairKey(action.productCode, action.consultingCode);
      const finalPrice = existing.pendingPrice ?? existing.currentPrice;
      const markupPct = existing.pendingMarkupPct ?? existing.currentMarkupPct;
      const finalLock: R3FinalLockRecord = {
        key: k,
        productCode: action.productCode,
        consultingCode: action.consultingCode,
        finalPrice,
        markupPct,
        source: "REBID_AUCTION",
        lockedAt: stamp,
        r3SolutionParts: Array(6).fill(""),
        r3SolutionSubmittedAt: null,
      };
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r3AuctionDeals: {
          ...prev.r3AuctionDeals,
          [k]: {
            ...existing,
            currentPrice: finalPrice,
            currentMarkupPct: markupPct,
            stage: "DEAL_AGREED_UNLOCKED",
            productLockAccepted: true,
            consultingLockAccepted: true,
            lockedAt: stamp,
          },
        },
        r3Locks: { ...prev.r3Locks, [k]: finalLock },
        events: pushEvent(
          prev.events,
          action.acceptedBy === "PRODUCT" ? action.productCode : action.consultingCode,
          action.acceptedBy,
          "R3",
          `🔒 ROUND 3 AUCTION ALLOTMENT LOCKED: ${action.productCode} ⇄ ${action.consultingCode} at $${finalPrice.toLocaleString()} (settled after R3).`
        ),
      };
    }

    case "R3_PICK_STATEMENT": {
      // Check if team already picked or statement already taken
      if (prev.r3Statements.some(s => s.claimedBy === action.productCode)) return prev;
      const target = prev.r3Statements.find(s => s.id === action.statementId);
      if (!target || target.claimedBy) return prev;
      const prod = getOrMakeProduct(prev, action.productCode);

      const nextStatements = prev.r3Statements.map(s =>
        s.id === action.statementId
          ? { ...s, claimedBy: action.productCode, claimedByName: prod.company, claimedAt: stamp }
          : s
      );

      const curIdx = prev.r3DraftQueue.findIndex(q => q.code === action.productCode);
      const nextDraftQueue = prev.r3DraftQueue.map((q, idx) => {
        if (q.code === action.productCode) {
          return { ...q, status: "CLAIMED" as const, pickedStatementId: action.statementId };
        }
        if (curIdx >= 0 && idx === curIdx + 1 && q.status === "UPCOMING") {
          return { ...q, status: "YOUR_TURN" as const };
        }
        return q;
      });

      const r3Lock = getProductR3Lock(prev, action.productCode);
      const dispatchNote = r3Lock
        ? ` Dispatched live to Consultant Team ${r3Lock.consultingCode}!`
        : " Ready to dispatch once Consultant is locked.";

      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r3Statements: nextStatements,
        r3DraftQueue: nextDraftQueue,
        events: pushEvent(
          prev.events,
          action.productCode,
          "PRODUCT",
          "R3",
          `🔒 ${action.productCode} locked Problem Statement ${action.statementId} (${target.title}).${dispatchNote}`
        ),
      };
    }

    case "R3_SIMULATE_NEXT_DRAFT_PICK": {
      const nextTurnIdx = prev.r3DraftQueue.findIndex(q => q.status === "YOUR_TURN" && q.code !== "XP01");
      if (nextTurnIdx < 0) return prev;
      const picker = prev.r3DraftQueue[nextTurnIdx]!;
      const openPs = prev.r3Statements.find(s => !s.claimedBy);
      if (!openPs) return prev;
      const nextStatements = prev.r3Statements.map(s =>
        s.id === openPs.id
          ? { ...s, claimedBy: picker.code, claimedByName: picker.company, claimedAt: stamp }
          : s
      );
      const nextDraftQueue = prev.r3DraftQueue.map((q, idx) => {
        if (idx === nextTurnIdx) return { ...q, status: "CLAIMED" as const, pickedStatementId: openPs.id };
        if (idx === nextTurnIdx + 1 && q.status === "UPCOMING") return { ...q, status: "YOUR_TURN" as const };
        return q;
      });
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r3Statements: nextStatements,
        r3DraftQueue: nextDraftQueue,
        events: pushEvent(
          prev.events,
          picker.code,
          "PRODUCT",
          "R3",
          `${picker.code} (${picker.company}) picked & locked ${openPs.id} in least-money draft order.`
        ),
      };
    }

    case "R3_CONSULTING_SAVE_SOLUTION":
    case "R3_CONSULTING_SUBMIT_SOLUTION": {
      const k = pairKey(action.productCode, action.consultingCode);
      const lock = prev.r3Locks[k];
      if (!lock || lock.r3SolutionSubmittedAt) return prev;
      const isSubmit = action.type === "R3_CONSULTING_SUBMIT_SOLUTION";
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        r3Locks: {
          ...prev.r3Locks,
          [k]: {
            ...lock,
            r3SolutionParts: [...action.parts],
            r3SolutionSubmittedAt: isSubmit ? stamp : null,
          },
        },
        events: isSubmit
          ? pushEvent(
              prev.events,
              action.consultingCode,
              "CONSULTING",
              "R3",
              `${action.consultingCode} submitted Round 3 Crisis Solution → delivered live to ${action.productCode}'s New MVP builder!`
            )
          : prev.events,
      };
    }

    case "R3_PRODUCT_SAVE_MVP":
    case "R3_PRODUCT_SUBMIT_MVP": {
      const { products, productOrder, product } = ensureProductInMap(prev, action.productCode);
      if (product.r3MvpSubmittedAt) return prev;
      const isSubmit = action.type === "R3_PRODUCT_SUBMIT_MVP";
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        products: {
          ...products,
          [action.productCode]: {
            ...product,
            r3MvpParts: [...action.parts],
            r3MvpSubmittedAt: isSubmit ? stamp : null,
          },
        },
        productOrder,
        events: isSubmit
          ? pushEvent(
              prev.events,
              action.productCode,
              "PRODUCT",
              "R3",
              `${action.productCode} permanently submitted their New Round 3 MVP!`
            )
          : prev.events,
      };
    }

    case "QA_POST_QUESTION": {
      const nextId = prev.qaItems.reduce((m, item) => Math.max(m, item.id), 0) + 1;
      const newItem: QaItemState = {
        id: nextId,
        team: action.team,
        targetCompany: action.targetCompany,
        q: action.q.trim(),
        a: null,
        createdAt: stamp,
      };
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        qaItems: [newItem, ...prev.qaItems],
        events: pushEvent(
          prev.events,
          action.team,
          action.team.startsWith("XC") ? "CONSULTING" : action.team.startsWith("XP") ? "PRODUCT" : "FINANCE",
          "QA",
          `${action.team} posted a due-diligence question for ${action.targetCompany}.`
        ),
      };
    }

    case "QA_ANSWER_QUESTION": {
      const target = prev.qaItems.find(item => item.id === action.questionId);
      if (!target) return prev;
      return {
        ...prev,
        version: nextVersion,
        updatedAt: nowIso,
        qaItems: prev.qaItems.map(item =>
          item.id === action.questionId
            ? { ...item, a: action.a.trim(), answeredBy: action.answeredBy }
            : item
        ),
        events: pushEvent(
          prev.events,
          action.answeredBy,
          "PRODUCT",
          "QA",
          `${action.answeredBy} published an answer to Question #${action.questionId} on the public Q&A board.`
        ),
      };
    }

    default:
      return prev;
  }
}
