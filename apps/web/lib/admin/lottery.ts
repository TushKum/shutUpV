// The lottery as the control panel shows it: the stored draw (squads, dealt cards, picks, coverage, crisis cards)
// turned into the published lottery record, and the independent check of that record with the engine. Pure: the
// rows come from lottery-data.ts (or a test).

import { checkLotteryRecord, verifyCommitment, type LotteryRecord, type Track } from "@msim/engine";

export interface LotteryRows {
  commitment: string;
  /** The secret seed (event_secrets), staff only. */
  seed: string;
  dice: string;
  teams: { id: string; code: string; track: Track }[];
  problemCards: { id: string; number: number; sector: string; title: string }[];
  squads: {
    number: number;
    product_team_id: string;
    consulting_team_id: string;
    finance_team_id: string;
    dealt_card_ids: string[];
    chosen_card_id: string | null;
    chosen_by_default: boolean;
  }[];
  coverage: { consultant_team_id: string; company_id: string }[];
  companies: { id: string; product_team_id: string; ticker: string | null; crisis_card_id: string | null }[];
  /** The crisis deck, once the crisis has been applied (null before: the crisis draw has not happened). */
  crisisCards: { id: string; category: string; number: number }[] | null;
}

export interface SquadView {
  number: number;
  product: string;
  consulting: string;
  finance: string;
  /** The three dealt cards in dealt order (the first is the default pick). */
  dealt: { number: number | null; title: string }[];
  chosen: { number: number | null; title: string } | null;
  chosenByDefault: boolean;
  /** The consultant's two covered companies: Product team code and ticker (once claimed). */
  covers: { product: string; ticker: string | null }[];
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function index(rows: LotteryRows) {
  const teamCode = new Map(rows.teams.map((t) => [t.id, t.code]));
  const card = new Map(rows.problemCards.map((c) => [c.id, c]));
  const company = new Map(rows.companies.map((c) => [c.id, c]));
  const code = (id: string) => teamCode.get(id) ?? "?";
  /** Covered companies of a consultant, sorted by Product team code (coverage has no order). */
  const covers = (consultantId: string) =>
    rows.coverage
      .filter((c) => c.consultant_team_id === consultantId)
      .map((c) => company.get(c.company_id))
      .map((c) => ({ product: c ? code(c.product_team_id) : "?", ticker: c?.ticker ?? null }))
      .sort((a, b) => byCode(a.product, b.product));
  return { code, card, covers };
}

/** The squads table, in squad-number order. */
export function squadViews(rows: LotteryRows): SquadView[] {
  const { code, card, covers } = index(rows);
  const show = (id: string) => {
    const c = card.get(id);
    return c ? { number: c.number, title: c.title } : { number: null, title: "Unknown card" };
  };
  return [...rows.squads]
    .sort((a, b) => a.number - b.number)
    .map((s) => ({
      number: s.number,
      product: code(s.product_team_id),
      consulting: code(s.consulting_team_id),
      finance: code(s.finance_team_id),
      dealt: s.dealt_card_ids.map(show),
      chosen: s.chosen_card_id ? show(s.chosen_card_id) : null,
      chosenByDefault: s.chosen_by_default,
      covers: covers(s.consulting_team_id),
    }));
}

/**
 * The lottery record (the format `pnpm verify-lottery` checks) built from what the database stored. It contains the
 * secret seed. The crisis deck and the crisis cards are included once the crisis has been applied.
 */
export function buildLotteryRecord(rows: LotteryRows): LotteryRecord {
  const { code, card, covers } = index(rows);
  const track = (t: Track) =>
    rows.teams
      .filter((x) => x.track === t)
      .map((x) => x.code)
      .sort(byCode);
  const cardNumber = (id: string) => String(card.get(id)?.number ?? "?");
  const squads = [...rows.squads].sort((a, b) => a.number - b.number);
  const record: LotteryRecord = {
    seed: rows.seed,
    dice: rows.dice,
    commitment: rows.commitment,
    teams: { product: track("PRODUCT"), consulting: track("CONSULTING"), finance: track("FINANCE") },
    problemCards: [...rows.problemCards].sort((a, b) => a.number - b.number).map((c) => String(c.number)),
    squads: squads.map((s) => ({
      number: s.number,
      product: code(s.product_team_id),
      consulting: code(s.consulting_team_id),
      finance: code(s.finance_team_id),
      cards: s.dealt_card_ids.map(cardNumber),
      covers: covers(s.consulting_team_id).map((c) => c.product),
    })),
  };
  if (rows.crisisCards) {
    const crisis = new Map(rows.crisisCards.map((c) => [c.id, c]));
    const companyOfProduct = new Map(rows.companies.map((c) => [c.product_team_id, c]));
    record.crisisDeck = [...rows.crisisCards]
      .sort((a, b) => byCode(a.category, b.category) || a.number - b.number)
      .map((c) => ({ category: c.category, number: c.number }));
    record.crises = squads.map((s) => {
      const drawn = crisis.get(companyOfProduct.get(s.product_team_id)?.crisis_card_id ?? "");
      return { squad: s.number, card: drawn ? `${drawn.category} #${drawn.number}` : "none" };
    });
  }
  return record;
}

export interface DrawCheck {
  /** SHA-256 of the stored seed equals the published commitment. */
  seedMatches: boolean;
  /** Every difference between the stored draw and a fresh draw by the engine (empty: the draw is verified). */
  problems: string[];
}

/** Recomputes the draw with the engine from the stored seed, dice, team codes and problem cards. */
export function checkDraw(record: LotteryRecord): DrawCheck {
  const seedMatches = verifyCommitment(record.seed, record.commitment);
  try {
    return { seedMatches, problems: checkLotteryRecord(record) };
  } catch (err) {
    return { seedMatches, problems: [`the engine could not redo the draw: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

/** The 64-hex commitment the organisers publish the day before; null if the text is not one. */
export function normaliseCommitment(text: string): string | null {
  const c = text.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(c) ? c : null;
}

/** File name of the downloaded record. */
export const recordFileName = (slug: string) => `lottery-record-${slug}.json`;
