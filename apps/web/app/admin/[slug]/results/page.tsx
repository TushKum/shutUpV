import type { Metadata } from "next";
import { AWARD_CODES, AWARD_LABELS, type AwardCode } from "@msim/engine";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import { rpc } from "@/lib/rpc";
import { supabaseServer } from "@/lib/supabase/server";
import { bp, clock, money } from "@/lib/format";
import { Badge, Notice, Panel, Table, Td } from "@/components/ui/ui";

export const metadata: Metadata = { title: "Results" };

interface BoardRow {
  team_id: string;
  code: string;
  name?: string;
  r1: number;
  r2: number;
  r3: number;
  total: number;
  rank: number | null;
  return_bp?: number;
  eligible?: boolean;
}

// Results: the leaderboard as staff see it (live, including after the 03:30 freeze when teams no longer can), then the
// settled results and the awards. Ranks: total, then Round 2, then Round 1, then the exact return.
export default async function ResultsPage({ params }: PageProps<"/admin/[slug]/results">) {
  const { slug } = await params;
  const event = await loadAdminEvent(slug);
  const status = await loadEventStatus(event.id);
  const sb = await supabaseServer();
  const [board, awards, companies, teams] = await Promise.all([
    rpc("leaderboard", { p_event: event.id }),
    sb.from("awards").select("code, team_id, company_id, metric").eq("event_id", event.id),
    sb.from("companies").select("id, ticker").eq("event_id", event.id),
    sb.from("teams").select("id, code").eq("event_id", event.id),
  ]);
  if (!board.ok) throw new Error(`leaderboard: ${board.message}`);
  const rows = (board.data?.rows ?? []) as BoardRow[];
  const final = board.data?.final === true;
  const code = new Map((teams.data ?? []).map((t) => [t.id, t.code]));
  const ticker = new Map((companies.data ?? []).map((c) => [c.id, c.ticker]));
  const byAward = new Map<AwardCode, { team: string; ticker: string | null; metric: Record<string, unknown> }[]>();
  for (const a of awards.data ?? []) {
    const list = byAward.get(a.code as AwardCode) ?? [];
    list.push({ team: code.get(a.team_id) ?? "?", ticker: a.company_id ? (ticker.get(a.company_id) ?? null) : null, metric: (a.metric ?? {}) as Record<string, unknown> });
    byAward.set(a.code as AwardCode, list);
  }

  return (
    <div className="space-y-6">
      <Panel
        title={final ? "Final results" : "Leaderboard"}
        actions={
          final ? (
            <Badge tone="green">Settled</Badge>
          ) : status.leaderboard_frozen ? (
            <Badge tone="amber">Frozen for teams since 03:30</Badge>
          ) : (
            <Badge tone="blue">Live</Badge>
          )
        }
      >
        <p className="text-sm text-slate-600">
          {final
            ? "Total = Round 1 + Round 2 + Round 3 points (out of 300). Ties: higher Round 2, then higher Round 1, then the higher exact return. Disqualified teams are not ranked."
            : "The total so far: Round 1 points from 23:30, Round 2 points from 02:45, Round 3 points at current market prices from 02:15. Teams see it until 03:30; from then until the awards only staff do."}
        </p>
        <div className="mt-3 max-h-[36rem] overflow-y-auto">
          <Table head={["Rank", "Team", "R1", "R2", "R3", "Total", ...(final ? ["Return"] : [])]} empty="No teams.">
            {rows.map((r) => (
              <tr key={r.team_id} className={r.eligible === false ? "opacity-60" : ""}>
                <Td mono>{r.rank ?? "—"}</Td>
                <Td mono className="font-semibold">
                  {r.code} {r.name ? <span className="font-sans font-normal text-slate-600">{r.name}</span> : null}
                  {r.eligible === false ? <Badge tone="red">Disqualified</Badge> : null}
                </Td>
                <Td mono>{r.r1}</Td>
                <Td mono>{r.r2}</Td>
                <Td mono>{r.r3}</Td>
                <Td mono className="font-semibold">{r.total}</Td>
                {final ? <Td mono>{r.return_bp === undefined ? "—" : bp(r.return_bp)}</Td> : null}
              </tr>
            ))}
          </Table>
        </div>
      </Panel>

      <Panel title="Awards">
        {byAward.size === 0 ? (
          <Notice>The awards are decided at settlement (04:30) and revealed on the big screen at 05:15.</Notice>
        ) : (
          <ul className="divide-y divide-slate-100">
            {AWARD_CODES.map((c) => {
              const list = byAward.get(c);
              if (!list?.length) return null;
              return (
                <li key={c} className="flex flex-wrap items-baseline gap-3 py-2 text-sm">
                  <span className="w-48 font-semibold text-slate-900">{AWARD_LABELS[c]}</span>
                  <span className="font-mono">{list.map((a) => (a.ticker ? `${a.team} (${a.ticker})` : a.team)).join(", ")}</span>
                  <span className="text-slate-500">{metricText(c, list[0]!.metric)}</span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">Exact ties share an award. The best company is shared by the team that built it and the team that rescued it.</p>
        {status.phase === "SETTLEMENT" ? <p className="mt-1 text-xs text-slate-500">Checked at {clock(status.server_time, true)}: the fairness officer decides every flag before the awards.</p> : null}
      </Panel>
    </div>
  );
}

function metricText(code: AwardCode, m: Record<string, unknown>): string {
  const n = (k: string) => (typeof m[k] === "number" ? (m[k] as number) : null);
  if (code === "BEST_COMPANY" && n("rise_bp") !== null) return `${bp(n("rise_bp")!)} from ${money(n("post_crisis"))} to ${money(n("closing"))}`;
  if (code === "BEST_INVESTOR" && n("return_bp") !== null) return `${bp(n("return_bp")!)} return`;
  if (n("score") !== null) return `score ${n("score")}`;
  if (n("total") !== null) return `${n("total")} points`;
  return "";
}
