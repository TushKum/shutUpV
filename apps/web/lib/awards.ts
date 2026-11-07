// The awards in words, for the team portal, the control panel and the projector. Pure.

import { AWARD_CODES, type AwardCode } from "@msim/engine";
import { bp, money } from "@/lib/format";

export interface AwardRow {
  code: string;
  team_id: string;
  company_id: string | null;
  metric: Record<string, unknown> | null;
}

export interface AwardLine {
  code: AwardCode;
  /** "A101", or "A101 (CMP)" for the best company. */
  winners: string[];
  metric: string;
}

/** What won the award, in words: a rise, a return, a score or a total. */
export function awardMetricText(code: AwardCode, m: Record<string, unknown> | null): string {
  const x = m ?? {};
  const n = (k: string) => (typeof x[k] === "number" ? (x[k] as number) : null);
  if (code === "BEST_COMPANY" && n("rise_bp") !== null) return `${bp(n("rise_bp")!)} from ${money(n("post_crisis"))} to ${money(n("closing"))}`;
  if (code === "BEST_INVESTOR" && n("return_bp") !== null) return `${bp(n("return_bp")!)} return`;
  if (n("score") !== null) return `score ${n("score")}`;
  if (n("total") !== null) return `${n("total")} points`;
  return "";
}

/** One line per award given, in the order of the ceremony; team codes and tickers from the maps. */
export function awardLines(rows: readonly AwardRow[], codes: ReadonlyMap<string, string>, tickers: ReadonlyMap<string, string | null>): AwardLine[] {
  const out: AwardLine[] = [];
  for (const c of AWARD_CODES) {
    const list = rows.filter((r) => r.code === c);
    if (!list.length) continue;
    out.push({
      code: c,
      winners: list.map((a) => {
        const team = codes.get(a.team_id) ?? "?";
        const t = a.company_id ? (tickers.get(a.company_id) ?? null) : null;
        return t ? `${team} (${t})` : team;
      }),
      metric: awardMetricText(c, list[0]!.metric),
    });
  }
  return out;
}
