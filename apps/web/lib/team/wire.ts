// The Wire Feed: a newest-first terminal log of what just became public, for the funds' Trade page (and anyone who
// opens it): each released score with the price move it causes, the moment the rescue plans go public, and every
// bulletin. Only what every team can already read (released scores, published plans, published bulletins).
// Pure, so it is unit-tested; wire-data.ts reads the rows.

import type { SubmissionType } from "@msim/engine";

export interface WireScore {
  ticker: string | null;
  type: SubmissionType;
  score: number | null;
  tierBp: number | null;
  releasedAt: string;
}
export interface WireBulletin {
  kind: string;
  title: string;
  publishedAt: string;
}

export interface WireItem {
  key: string;
  at: string;
  /** SCORE (green up / red down), PLANS, NEWS. */
  kind: "SCORE" | "PLANS" | "NEWS";
  tone: "up" | "down" | "flat" | "info";
  text: string;
  href: string | null;
}

const TYPE_LABEL: Record<SubmissionType, string> = { PITCH: "pitch", PLAN: "rescue plan", FLASH: "flash answer" };
const pct = (bp: number) => `${bp > 0 ? "+" : bp < 0 ? "−" : "±"}${(Math.abs(bp) / 100).toFixed(bp % 100 === 0 ? 0 : 1)}%`;

export function wireFeed(input: { scores: readonly WireScore[]; bulletins: readonly WireBulletin[]; plansPublishedAt: string | null }, limit = 20): WireItem[] {
  const items: WireItem[] = [];
  for (const s of input.scores) {
    if (!s.ticker) continue;
    const tier = s.tierBp ?? 0;
    items.push({
      key: `s-${s.ticker}-${s.type}`,
      at: s.releasedAt,
      kind: "SCORE",
      tone: tier > 0 ? "up" : tier < 0 ? "down" : "flat",
      text: `${s.ticker} ${TYPE_LABEL[s.type]} scored ${s.score ?? "—"} → price ${pct(tier)}`,
      href: `/team/market/${s.ticker}`,
    });
  }
  if (input.plansPublishedAt) {
    items.push({ key: "plans", at: input.plansPublishedAt, kind: "PLANS", tone: "info", text: "Every rescue plan is now public: read them before the verdicts", href: "/team/market/book?type=PLAN" });
  }
  for (const b of input.bulletins) {
    items.push({ key: `b-${b.publishedAt}-${b.title}`, at: b.publishedAt, kind: "NEWS", tone: b.kind === "CRISIS" ? "down" : "info", text: `${b.kind}: ${b.title}`, href: "/team/bulletins" });
  }
  // Newest first; at the same moment, scores before news, then by text so every screen shows the same order.
  const rank = { SCORE: 0, PLANS: 1, NEWS: 2 } as const;
  items.sort((a, b) => b.at.localeCompare(a.at) || rank[a.kind] - rank[b.kind] || a.text.localeCompare(b.text));
  return items.slice(0, limit);
}
