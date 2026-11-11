// Hiring a Consulting firm, beyond the crisis room: the firm directory (search and sort), a firm's track record, and
// the one-on-one hire chat between a company and each firm it hired. Pure: the pages read the rows
// (lib/team/crisis-data.ts, lib/team/hire-data.ts) and these functions decide what they show. The database checks
// every rule again (post_hire_message only lets the two sides of an engagement write).

import type { EngagementRow } from "./crisis";

export interface DirectoryFirm {
  team_id: string;
  code: string;
  name: string;
  value_cents: number;
  clients: number;
  avg_rating: number | null;
}

export interface DirectoryProfile {
  headline: string;
  specialities: string[];
  rate_card: string;
  about: string;
  asking_cents: number;
}

export type FirmSort = "value" | "rating" | "asking" | "code";
export const FIRM_SORTS: { key: FirmSort; label: string }[] = [
  { key: "value", label: "Firm value" },
  { key: "rating", label: "Client rating" },
  { key: "asking", label: "Lowest asking fee" },
  { key: "code", label: "Code" },
];

export const parseSort = (raw: unknown): FirmSort => (FIRM_SORTS.some((s) => s.key === raw) ? (raw as FirmSort) : "value");

/** Firms whose code, name, headline, specialities, rate card or about text contain every word of the query. */
export function searchFirms<F extends DirectoryFirm>(firms: readonly F[], profiles: ReadonlyMap<string, DirectoryProfile>, query: string, sort: FirmSort): F[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (f: F) => {
    const p = profiles.get(f.team_id);
    return [f.code, f.name, p?.headline, p?.specialities.join(" "), p?.rate_card, p?.about].join(" ").toLowerCase();
  };
  const found = words.length ? firms.filter((f) => words.every((w) => hay(f).includes(w))) : [...firms];
  const asking = (f: F) => {
    const a = profiles.get(f.team_id)?.asking_cents ?? 0;
    return a > 0 ? a : Number.MAX_SAFE_INTEGER; // no asking fee set: last
  };
  const cmp: Record<FirmSort, (a: F, b: F) => number> = {
    value: (a, b) => b.value_cents - a.value_cents,
    rating: (a, b) => (b.avg_rating ?? -1) - (a.avg_rating ?? -1) || b.clients - a.clients,
    asking: (a, b) => asking(a) - asking(b),
    code: () => 0,
  };
  return found.sort((a, b) => cmp[sort](a, b) || a.code.localeCompare(b.code));
}

/** How complete a firm's profile is, out of 5 (headline, specialities, rate card, about, asking fee). */
export function profileCompleteness(p: DirectoryProfile | undefined): number {
  if (!p) return 0;
  return [p.headline, p.specialities.length > 0, p.rate_card, p.about, p.asking_cents > 0].filter(Boolean).length;
}

/** All the stars a firm's clients gave it, and how many were defaults (no rating counts as 3). */
export function ratingSummary(engagements: readonly EngagementRow[], firmId: string): { rated: number; defaults: number; stars: number[] } {
  const mine = engagements.filter((e) => e.firm_team_id === firmId && e.rating !== null);
  const stars = [1, 2, 3, 4, 5].map((r) => mine.filter((e) => e.rating === r).length);
  return { rated: mine.length, defaults: mine.filter((e) => e.rating_default).length, stars };
}

export interface HireThread {
  company_id: string;
  firm_team_id: string;
  /** The other side's team id (the firm for a company; the company's Product team for a firm). */
  partner_team_id: string;
  /** Sub-rounds in which this pair was engaged, newest first. */
  ks: number[];
}

/**
 * The hire chats this team can open: one per company–firm pair with at least one engagement. A Product team sees one
 * per firm it hired; a firm one per company that hired it. Newest engagement first.
 */
export function hireThreads(
  engagements: readonly EngagementRow[],
  companies: readonly { id: string; product_team_id: string | null }[],
  me: string,
): HireThread[] {
  const myCompany = companies.find((c) => c.product_team_id === me)?.id ?? null;
  const owner = new Map(companies.map((c) => [c.id, c.product_team_id]));
  const threads = new Map<string, HireThread>();
  for (const e of [...engagements].sort((a, b) => b.k - a.k)) {
    const asFirm = e.firm_team_id === me;
    const asCompany = myCompany !== null && e.company_id === myCompany;
    if (!asFirm && !asCompany) continue;
    const key = `${e.company_id}:${e.firm_team_id}`;
    const t = threads.get(key);
    if (t) {
      t.ks.push(e.k);
      continue;
    }
    const partner = asFirm ? owner.get(e.company_id) ?? null : e.firm_team_id;
    if (!partner) continue;
    threads.set(key, { company_id: e.company_id, firm_team_id: e.firm_team_id, partner_team_id: partner, ks: [e.k] });
  }
  return [...threads.values()];
}
